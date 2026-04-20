import json
import logging
import asyncio
import base64
import numpy as np
import time
import cv2
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import yt_dlp

logger = logging.getLogger("sam3_router")
router = APIRouter(tags=["sam3"])

_sam3_model = None
_yolo_model = None
_models_warmed_up = False


def _load_models():
    """Load the SAM3 model for point-based segmentation and optionally YOLO for text-prompted segmentation."""
    global _sam3_model, _yolo_model, _models_warmed_up
    import torch
    from ultralytics import SAM, YOLO

    device = 'cuda:0' if torch.cuda.is_available() else 'cpu'

    if _sam3_model is None:
        logger.info("[SAM3] Loading sam2.1_b.pt for SAM3 segmentation logic...")
        _sam3_model = SAM('sam2.1_b.pt') # Premium SAM weights
        _sam3_model.to(device)
        logger.info(f"[SAM3] Model loaded on {device}")
        
    if _yolo_model is None:
        logger.info("[SAM3] Loading yolov8s-world.pt for text-prompted segmentation...")
        _yolo_model = YOLO('yolov8s-world.pt')
        _yolo_model.to(device)
        if device.startswith('cuda'):
            _yolo_model.model.half()

    # Warm-up
    # NOTE: YOLO is in FP16 (.half()) so we must autocast to bridge the
    # FP32 input tensors generated from the uint8 dummy image.
    if not _models_warmed_up:
        import torch
        logger.info("[SAM3] Warming up CUDA kernels (dummy inference)...")
        dummy = np.zeros((320, 320, 3), dtype=np.uint8)
        use_half = device.startswith('cuda')
        if use_half:
            with torch.amp.autocast('cuda'):
                _sam3_model.predict(source=dummy, points=[10, 10], labels=[1], verbose=False)
                _yolo_model.predict(source=dummy, verbose=False)
        else:
            _sam3_model.predict(source=dummy, points=[10, 10], labels=[1], verbose=False)
            _yolo_model.predict(source=dummy, verbose=False)
        _models_warmed_up = True
        logger.info("[SAM3] Warm-up complete -- ready for interactive clicks and text prompts.")

    return _sam3_model, _yolo_model


def get_youtube_stream_url(video_id):
    """Resolve a direct seekable URL for a YouTube video (shared logic)."""
    import os as _os
    _server_dir = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
    _cookies_file = _os.path.join(_server_dir, "cookies.txt")

    base_opts = {
        'format': '18/best[height<=720]',
        'quiet': True,
        'no_warnings': True,
    }
    url = f"https://www.youtube.com/watch?v={video_id}"

    try:
        with yt_dlp.YoutubeDL(base_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if info.get('url'):
                return info['url']
    except Exception as e1:
        logger.warning(f"[SAM3] No-auth yt-dlp failed: {e1}")

    try:
        chrome_opts = {**base_opts, 'cookiesfrombrowser': ('chrome',)}
        with yt_dlp.YoutubeDL(chrome_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if info.get('url'):
                return info['url']
    except Exception as e2:
        logger.warning(f"[SAM3] Chrome cookies failed: {e2}")

    if _os.path.isfile(_cookies_file):
        cookie_opts = {**base_opts, 'cookiefile': _cookies_file}
        with yt_dlp.YoutubeDL(cookie_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            return info['url']

    raise RuntimeError(f"Cannot access video {video_id}")


def _masks_to_contours(masks_data, img_h, img_w, class_labels, confidences, box_colors):
    """Convert SAM3 binary masks to contour polygons (percentage coords)."""
    result = []
    for idx, mask_tensor in enumerate(masks_data):
        if hasattr(mask_tensor, 'cpu'):
            mask_np = mask_tensor.cpu().numpy()
        else:
            mask_np = mask_tensor

        while mask_np.ndim > 2:
            mask_np = mask_np[0]

        mask_uint8 = (mask_np > 0.5).astype(np.uint8) * 255

        contours, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue

        contour = max(contours, key=cv2.contourArea)

        epsilon = 0.012 * cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, epsilon, True)

        if len(approx) < 3:
            continue

        points_pct = []
        for pt in approx:
            x_pct = round((pt[0][0] / img_w) * 100, 1)
            y_pct = round((pt[0][1] / img_h) * 100, 1)
            points_pct.append([x_pct, y_pct])

        area_px = cv2.contourArea(contour)
        area_pct = round((area_px / (img_h * img_w)) * 100, 1)
        
        c_label = class_labels[idx] if class_labels and idx < len(class_labels) else "sam3_segment"
        c_conf = confidences[idx] if confidences and idx < len(confidences) else 1.0

        mask_entry = {
            "class": c_label,
            "confidence": c_conf,
            "contours": points_pct,
            "area_pct": area_pct,
            "color": box_colors[idx % len(box_colors)],
        }
        result.append(mask_entry)

    return result

_box_cache = {
    "keywords": None,
    "boxes": [],
    "labels": [],
    "confs": [],
    "frame_count": 0,
    "refresh_every": 1,
}

def _run_yolo_detection(yolo_m, kw_list, frame, min_conf=0.25):
    """Run YOLO-World detection, returns (boxes, labels, confs)."""
    if getattr(yolo_m, "_current_keywords", None) != kw_list:
        try:
            yolo_m.set_classes(kw_list)
            if isinstance(yolo_m.names, list):
                yolo_m.names = {i: n for i, n in enumerate(yolo_m.names)}
            yolo_m._current_keywords = kw_list
        except Exception as e:
            logger.error(f"[SAM3] YOLO set_classes failed: {e}")

    yolo_results = yolo_m.predict(source=frame, conf=min_conf, imgsz=1024, verbose=False)
    if not yolo_results or len(yolo_results[0].boxes) == 0:
        return [], [], []

    yolo_r = yolo_results[0]
    raw_names = yolo_r.names
    if isinstance(raw_names, list):
        names_dict = {i: n for i, n in enumerate(raw_names)}
    else:
        names_dict = raw_names

    valid_boxes, valid_labels, valid_confs = [], [], []
    for box in yolo_r.boxes:
        cls_id = int(box.cls[0].item())
        conf = float(box.conf[0].item())
        label = names_dict.get(cls_id, "unknown").lower()

        matched = False
        for kw in kw_list:
            kw_l = kw.lower()
            if kw_l in label or label in kw_l:
                matched = True
                break

        if matched:
            valid_boxes.append(box.xyxy[0].tolist())
            valid_labels.append(label)
            valid_confs.append(round(conf, 2))

    return valid_boxes, valid_labels, valid_confs

def _run_hybrid_sam3_pipeline(yolo_m, sam3_m, kw_list, frame, min_conf):
    """Hybrid pipeline: YOLO (cached) -> SAM3 segmentation."""
    global _box_cache
    t0 = time.time()

    keywords_changed = _box_cache["keywords"] != kw_list
    frame_due = _box_cache["frame_count"] >= _box_cache["refresh_every"]

    if keywords_changed or frame_due:
        boxes, labels, confs = _run_yolo_detection(yolo_m, kw_list, frame, min_conf)
        _box_cache["keywords"] = list(kw_list)
        _box_cache["boxes"] = boxes
        _box_cache["labels"] = labels
        _box_cache["confs"] = confs
        _box_cache["frame_count"] = 0
    else:
        boxes = _box_cache["boxes"]
        labels = _box_cache["labels"]
        confs = _box_cache["confs"]
        _box_cache["frame_count"] += 1

    if not boxes:
        _box_cache["frame_count"] += 1
        return [], [], [], time.time() - t0

    sam_results = sam3_m.predict(
        source=frame,
        bboxes=boxes,
        verbose=False
    )

    t_elapsed = time.time() - t0
    if not sam_results or sam_results[0].masks is None:
        return [], labels, confs, t_elapsed

    return sam_results[0].masks.data, labels, confs, t_elapsed

def _run_sam3_pipeline(sam3_m, frame, click_point):
    """Run SAM3 segmentation based on a click point."""
    t0 = time.time()

    sam_results = sam3_m.predict(
        source=frame,
        points=[click_point],
        labels=[1],
        verbose=False
    )

    t_elapsed = time.time() - t0
    if not sam_results or sam_results[0].masks is None:
        return [], t_elapsed

    return sam_results[0].masks.data, t_elapsed


def _extract_youtube_frame(video_id, current_time, state):
    if state.get("video_id") != video_id:
        old_cap = state.get("cap")
        if old_cap:
            old_cap.release()
        state["cap"] = None
        state["video_id"] = video_id

        stream_url = get_youtube_stream_url(video_id)
        cap = cv2.VideoCapture(stream_url, cv2.CAP_FFMPEG)
        if not cap.isOpened():
            raise RuntimeError(f"Failed to open stream for {video_id}")
        state["cap"] = cap

    cap = state.get("cap")
    if not cap or not cap.isOpened():
        return None

    cap_time = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
    if abs(cap_time - current_time) > 2.0:
        cap.set(cv2.CAP_PROP_POS_MSEC, current_time * 1000.0)

    ret, frame = cap.read()
    if not ret or frame is None:
        return None
    return frame


@router.websocket("/ws/sam3")
async def sam3_websocket(websocket: WebSocket):
    await websocket.accept()
    logger.info("[SAM3] WebSocket client connected.")

    loop = asyncio.get_event_loop()

    try:
        sam3_model, yolo_model = await loop.run_in_executor(None, _load_models)
    except Exception as e:
        logger.error(f"[SAM3] Initialization Error: {e}", exc_info=True)
        await websocket.send_json({"error": "Failed to load SAM3/YOLO models", "details": str(e)})
        await websocket.close()
        return

    yt_state = {"video_id": None, "cap": None}
    box_colors = ['#f43f5e', '#a855f7', '#14b8a6', '#f97316', '#84cc16', '#0ea5e9', '#ec4899']

    try:
        while True:
            data_str = await websocket.receive_text()
            data = json.loads(data_str)

            msg_type = data.get("type")
            click_point = data.get("point")
            keywords = data.get("keywords", [])
            conf_val = float(data.get("confidence", 0.50))

            img = None

            if msg_type == "youtube":
                video_id = data.get("videoId")
                current_time = float(data.get("currentTime", 0))

                try:
                    img = await loop.run_in_executor(
                        None, _extract_youtube_frame, video_id, current_time, yt_state
                    )
                except Exception as e:
                    logger.error(f"[SAM3] YouTube extraction failed: {e}")
                    await websocket.send_json({"error": f"YouTube stream failed: {e}", "masks": []})
                    continue

                if img is None:
                    if not click_point and not keywords:
                        continue
                    else:
                        await websocket.send_json({"masks": []})
                        continue

            elif msg_type == "base64":
                image_data = data.get("image", "")
                if "," in image_data:
                    image_data = image_data.split(",", 1)[1]
                if image_data:
                    try:
                        img_bytes = base64.b64decode(image_data)
                        img_array = np.frombuffer(img_bytes, dtype=np.uint8)
                        img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
                    except Exception as decode_err:
                        logger.error(f"[SAM3] Base64 decode failed: {decode_err}")
                        
            elif msg_type == "stop":
                old_cap = yt_state.get("cap")
                if old_cap:
                    old_cap.release()
                yt_state["cap"] = None
                yt_state["video_id"] = None
                _box_cache["keywords"] = None
                _box_cache["boxes"] = []
                _box_cache["frame_count"] = 0
                continue

            if img is None:
                await websocket.send_json({"masks": []})
                continue
            
            if click_point:
                x_px, y_px = click_point
                masks_data, elapsed = await loop.run_in_executor(
                    None, _run_sam3_pipeline, sam3_model, img, [x_px, y_px]
                )

                img_h, img_w = img.shape[:2]

                if len(masks_data) == 0:
                    await websocket.send_json({"masks": []})
                    continue

                contour_results = _masks_to_contours(
                    masks_data, img_h, img_w, None, None, box_colors
                )

                logger.info(f"[SAM3] Mask segmented at {click_point} in {elapsed:.3f}s")
                await websocket.send_json({"masks": contour_results})
                
            elif keywords:
                masks_data, labels, confs, elapsed = await loop.run_in_executor(
                    None, _run_hybrid_sam3_pipeline, yolo_model, sam3_model, keywords, img, conf_val
                )

                img_h, img_w = img.shape[:2]

                if len(masks_data) == 0:
                    await websocket.send_json({"masks": []})
                    continue

                contour_results = _masks_to_contours(
                    masks_data, img_h, img_w, labels, confs, box_colors
                )

                logger.info(f"[SAM3] {len(contour_results)} auto masks in {elapsed:.3f}s")
                await websocket.send_json({"masks": contour_results})
            else:
                await websocket.send_json({"masks": []})
                continue

    except WebSocketDisconnect:
        logger.info("[SAM3] WebSocket client disconnected.")
    except Exception as e:
        logger.error(f"[SAM3] WebSocket error: {e}", exc_info=True)
    finally:
        old_cap = yt_state.get("cap")
        if old_cap:
            old_cap.release()
