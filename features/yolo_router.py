import json
import logging
import asyncio
import base64
import numpy as np
import time
import cv2
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import yt_dlp

logger = logging.getLogger("yolo_router")
router = APIRouter(tags=["yolo"])

model = None

def get_yolo_model():
    global model
    if model is None:
        try:
            import torch
            from ultralytics import YOLO
            logger.info("[YOLO] Loading yolov8s-world.pt model (Zero-Shot)...")
            model = YOLO('yolov8s-world.pt')
            
            # Force initialize the model tensors to the GPU before any thread claims it
            device = 'cuda:0' if torch.cuda.is_available() else 'cpu'
            model.to(device)
            logger.info(f"[YOLO] Model loaded successfully on {device}.")
        except ImportError:
            logger.error("[YOLO] ultralytics not installed. Unable to load model.")
            raise
    return model

def get_youtube_stream_url(video_id):
    import os as _os
    _server_dir = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
    _cookies_file = _os.path.join(_server_dir, "cookies.txt")

    base_opts = {
        'format': '18/best[height<=720]',
        'quiet': True,
        'no_warnings': True,
    }

    url = f"https://www.youtube.com/watch?v={video_id}"

    # Attempt 1: no authentication
    try:
        with yt_dlp.YoutubeDL(base_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if info.get('url'):
                return info['url']
    except Exception as e1:
        logger.warning(f"[YOLO] No-auth yt-dlp failed: {e1}")

    # Attempt 2: Chrome browser cookies
    try:
        chrome_opts = {**base_opts, 'cookiesfrombrowser': ('chrome',)}
        with yt_dlp.YoutubeDL(chrome_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if info.get('url'):
                return info['url']
    except Exception as e2:
        logger.warning(f"[YOLO] Chrome cookies failed: {e2}")

    # Attempt 3: cookies.txt fallback
    if _os.path.isfile(_cookies_file):
        logger.info("[YOLO] Retrying with cookies.txt")
        cookie_opts = {**base_opts, 'cookiefile': _cookies_file}
        with yt_dlp.YoutubeDL(cookie_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            return info['url']

    raise RuntimeError(f"Cannot access video {video_id} -- export cookies to cookies.txt")

def get_dominant_color(img, x1, y1, x2, y2):
    """Extract the dominant color name from a bounding box region."""
    try:
        ih, iw = img.shape[:2]
        # Clamp coordinates
        x1, y1 = max(0, int(x1)), max(0, int(y1))
        x2, y2 = min(iw, int(x2)), min(ih, int(y2))
        bw, bh = x2 - x1, y2 - y1
        if bw <= 4 or bh <= 4:
            return None
        
        # Sample a tight center region (30%) to avoid edges/background
        cx = (x1 + x2) // 2
        cy = (y1 + y2) // 2
        hw = max(2, bw // 6)
        hh = max(2, bh // 6)
        crop = img[max(0, cy - hh):min(ih, cy + hh), max(0, cx - hw):min(iw, cx + hw)]
        
        if crop.size == 0 or crop.shape[0] < 2 or crop.shape[1] < 2:
            return None
        
        # Convert to HSV for color classification
        hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
        h_vals = hsv[:, :, 0].flatten().astype(float)
        s_vals = hsv[:, :, 1].flatten().astype(float)
        v_vals = hsv[:, :, 2].flatten().astype(float)
        
        h_mean = float(np.mean(h_vals))
        s_mean = float(np.mean(s_vals))
        v_mean = float(np.mean(v_vals))
        s_std = float(np.std(s_vals))
        
        # Detect striped/patterned: must have very high brightness variance
        # AND low saturation variance (rules out mixed-content like person boxes)
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        v_std = float(np.std(gray))
        if v_std > 70 and s_std < 40:
            # Also check for repeating horizontal bands (true stripes)
            row_means = np.mean(gray, axis=1)
            row_diff = np.abs(np.diff(row_means.astype(float)))
            if len(row_diff) > 2 and float(np.mean(row_diff)) > 15:
                return "striped"
        
        # Skip color if the region is too noisy/mixed (likely a complex scene)
        h_std = float(np.std(h_vals))
        if h_std > 40 and s_mean > 30:
            return None  # Too many colors mixed together
        
        # Low saturation = achromatic (black/white/gray)
        if s_mean < 30:
            if v_mean < 60:
                return "black"
            elif v_mean > 190:
                return "white"
            else:
                return "gray"
        
        # Map hue ranges to color names (OpenCV hue: 0-179)
        if h_mean < 8 or h_mean >= 165:
            return "red"
        elif h_mean < 22:
            return "orange"
        elif h_mean < 35:
            return "yellow"
        elif h_mean < 78:
            return "green"
        elif h_mean < 130:
            return "blue"
        elif h_mean < 145:
            return "purple"
        elif h_mean < 165:
            return "pink"
        
        return None
    except Exception:
        return None

@router.websocket("/ws/yolo")
async def yolo_websocket(websocket: WebSocket):
    await websocket.accept()
    logger.info("[YOLO] WebSocket client connected.")
    
    try:
        yolo_model = get_yolo_model()
    except Exception as e:
        logger.error(f"[YOLO] Critical Initialization Error: {e}", exc_info=True)
        await websocket.send_json({"error": "Failed to load YOLO model", "details": str(e)})
        await websocket.close()
        return

    active_video_id = None
    active_cap = None
    active_proxy = None
    
    try:
        while True:
            data_str = await websocket.receive_text()
            data = json.loads(data_str)
            
            msg_type = data.get("type")
            keywords = data.get("keywords", [])
            
            if msg_type == "youtube":
                video_id = data.get("videoId")
                current_time = float(data.get("currentTime", 0))
                
                # Switch streams if ID changes
                if active_video_id != video_id:
                    active_video_id = video_id
                    if active_cap:
                        active_cap.release()
                        active_cap = None
                    logger.info(f"[YOLO] Resolving YouTube stream for {video_id} directly...")
                    try:
                        loop = asyncio.get_event_loop()
                        stream_url = await loop.run_in_executor(None, get_youtube_stream_url, video_id)
                        logger.info(f"[YOLO] Resolved direct stream URL, connecting OpenCV...")
                        active_cap = await loop.run_in_executor(None, lambda: cv2.VideoCapture(stream_url, cv2.CAP_FFMPEG))
                    except Exception as e:
                        logger.error(f"[YOLO] Native extraction failed: {e}")
                        active_video_id = None
                        continue
                
                if not active_cap or not active_cap.isOpened():
                    logger.warning("[YOLO] Failed to open stream.")
                    continue
                
                # Check if user scrubbed out of sync
                cap_time = active_cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
                if abs(cap_time - current_time) > 2.0:
                     active_cap.set(cv2.CAP_PROP_POS_MSEC, current_time * 1000.0)
                
                # Grab latest frame
                ret, img = active_cap.read()
                if not ret or img is None:
                    await websocket.send_json({"boxes": []})
                    continue
                
                if not keywords:
                    await websocket.send_json({"boxes": []})
                    continue

                # Run inference inside the executor to ensure PyTorch executes on the same Thread/CUDA context
                def run_yolo_inference(target_model, target_keywords, target_img):
                    if getattr(target_model, "_current_keywords", None) != target_keywords:
                        try:
                            target_model.set_classes(target_keywords)
                            # CRITICAL: set_classes() turns model.names into a list.
                            # predict() internally calls .get() on model.names which crashes.
                            # Convert it back to a dict immediately.
                            if isinstance(target_model.names, list):
                                target_model.names = {i: n for i, n in enumerate(target_model.names)}
                            target_model._current_keywords = target_keywords
                            logger.info(f"[YOLO] Updated zero-shot classes: {target_keywords}")
                        except Exception as e:
                            logger.error(f"[YOLO] Failed to set classes {target_keywords}: {e}")
                    
                    return target_model.predict(source=target_img, verbose=False)

                loop = asyncio.get_event_loop()
                logger.info(f"[YOLO] Pushing frame to executor for {keywords}...")
                results = await loop.run_in_executor(None, run_yolo_inference, yolo_model, keywords, img)
                logger.info(f"[YOLO] Inference completed. Found {len(results[0].boxes) if results else 0} objects.")
                
                if not results:
                    await websocket.send_json({"boxes": []})
                    continue
                    
                result = results[0]
                boxes = result.boxes
                valid_boxes = []
                raw_names = result.names
                # YOLO-World set_classes() can return names as list or dict
                if isinstance(raw_names, list):
                    names_dict = {i: n for i, n in enumerate(raw_names)}
                else:
                    names_dict = raw_names
                
                for box in boxes:
                    cls_id = int(box.cls[0].item())
                    confidence = float(box.conf[0].item())
                    label = names_dict.get(cls_id, "unknown").lower()
                    
                    matched = False
                    if not keywords:
                        matched = True
                    else:
                        for kw in keywords:
                            kw = kw.lower()
                            if kw in label or label in kw:
                                matched = True
                                break
                                
                    if matched:
                        x1, y1, x2, y2 = box.xyxy[0].tolist()
                        width = x2 - x1
                        height = y2 - y1
                        img_h, img_w = img.shape[:2]
                        
                        # Extract dominant color (skip for people/human classes)
                        _NO_COLOR_CLASSES = {'person', 'man', 'woman', 'boy', 'girl', 'child', 'baby', 'people', 'human', 'face'}
                        color_name = None if label in _NO_COLOR_CLASSES else get_dominant_color(img, x1, y1, x2, y2)
                        
                        box_data = {
                            "class": label,
                            "confidence": round(confidence, 2),
                            "x_pct": round((x1 / img_w) * 100, 2),
                            "y_pct": round((y1 / img_h) * 100, 2),
                            "w_pct": round((width / img_w) * 100, 2),
                            "h_pct": round((height / img_h) * 100, 2)
                        }
                        if color_name:
                            box_data["color"] = color_name
                        valid_boxes.append(box_data)
                        
                await websocket.send_json({"boxes": valid_boxes})

            elif msg_type == "base64":
                # --- Handle native <video> frames sent as base64 JPEG ---
                image_data = data.get("image", "")
                # Strip "data:image/jpeg;base64," prefix if present
                if "," in image_data:
                    image_data = image_data.split(",", 1)[1]
                
                if not image_data or not keywords:
                    await websocket.send_json({"boxes": []})
                    continue
                
                try:
                    img_bytes = base64.b64decode(image_data)
                    img_array = np.frombuffer(img_bytes, dtype=np.uint8)
                    img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
                except Exception as decode_err:
                    logger.error(f"[YOLO] Base64 decode failed: {decode_err}")
                    await websocket.send_json({"boxes": []})
                    continue
                
                if img is None:
                    await websocket.send_json({"boxes": []})
                    continue
                
                # Run inference (same pipeline as YouTube frames)
                def run_yolo_inference_b64(target_model, target_keywords, target_img):
                    if getattr(target_model, "_current_keywords", None) != target_keywords:
                        try:
                            target_model.set_classes(target_keywords)
                            if isinstance(target_model.names, list):
                                target_model.names = {i: n for i, n in enumerate(target_model.names)}
                            target_model._current_keywords = target_keywords
                            logger.info(f"[YOLO] Updated zero-shot classes: {target_keywords}")
                        except Exception as e:
                            logger.error(f"[YOLO] Failed to set classes {target_keywords}: {e}")
                    return target_model.predict(source=target_img, verbose=False)
                
                loop = asyncio.get_event_loop()
                logger.info(f"[YOLO] Pushing base64 frame to executor for {keywords}...")
                results = await loop.run_in_executor(None, run_yolo_inference_b64, yolo_model, keywords, img)
                logger.info(f"[YOLO] Base64 inference completed. Found {len(results[0].boxes) if results else 0} objects.")
                
                if not results:
                    await websocket.send_json({"boxes": []})
                    continue
                
                result = results[0]
                boxes = result.boxes
                valid_boxes = []
                raw_names = result.names
                if isinstance(raw_names, list):
                    names_dict = {i: n for i, n in enumerate(raw_names)}
                else:
                    names_dict = raw_names
                
                for box in boxes:
                    cls_id = int(box.cls[0].item())
                    confidence = float(box.conf[0].item())
                    label = names_dict.get(cls_id, "unknown").lower()
                    
                    matched = False
                    if not keywords:
                        matched = True
                    else:
                        for kw in keywords:
                            kw = kw.lower()
                            if kw in label or label in kw:
                                matched = True
                                break
                    
                    if matched:
                        x1, y1, x2, y2 = box.xyxy[0].tolist()
                        width = x2 - x1
                        height = y2 - y1
                        img_h, img_w = img.shape[:2]
                        
                        _NO_COLOR_CLASSES = {'person', 'man', 'woman', 'boy', 'girl', 'child', 'baby', 'people', 'human', 'face'}
                        color_name = None if label in _NO_COLOR_CLASSES else get_dominant_color(img, x1, y1, x2, y2)
                        
                        box_data = {
                            "class": label,
                            "confidence": round(confidence, 2),
                            "x_pct": round((x1 / img_w) * 100, 2),
                            "y_pct": round((y1 / img_h) * 100, 2),
                            "w_pct": round((width / img_w) * 100, 2),
                            "h_pct": round((height / img_h) * 100, 2)
                        }
                        if color_name:
                            box_data["color"] = color_name
                        valid_boxes.append(box_data)
                
                await websocket.send_json({"boxes": valid_boxes})

            elif msg_type == "stop":
                 if active_cap:
                     active_cap.release()
                     active_cap = None
                 active_video_id = None
                     
    except WebSocketDisconnect:
        logger.info("[YOLO] WebSocket client disconnected.")
    except Exception as e:
        logger.error(f"[YOLO] WebSocket error: {e}", exc_info=True)
    finally:
        if active_cap:
            active_cap.release()
