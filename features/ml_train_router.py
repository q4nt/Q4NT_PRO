import json
import logging
import asyncio
import os
import sys
import base64
import uuid
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import List
import re

logger = logging.getLogger("ml_train_router")
router = APIRouter(tags=["ml_train"])

# --- Models ---
class AnnotationObj(BaseModel):
    class_id: int
    points: List[List[float]]
    format: str

class AnnotationPayload(BaseModel):
    dataset_name: str
    image_base64: str
    vid_width: float
    vid_height: float
    annotations: List[AnnotationObj]

class AutoDetectPayload(BaseModel):
    image_base64: str
    object_name: str

@router.post("/ml_train/annotate")
async def save_annotation(payload: AnnotationPayload):
    try:
        # Sanitize dataset name: allow only alphanumeric, hyphens, underscores
        safe_name = re.sub(r'[^a-zA-Z0-9_-]', '', payload.dataset_name)
        if not safe_name:
            return {"status": "error", "message": "Invalid dataset name"}

        # Reject oversized payloads (10 MB base64 limit ~ 7.5 MB decoded)
        MAX_BASE64_LEN = 10 * 1024 * 1024
        if len(payload.image_base64) > MAX_BASE64_LEN:
            return {"status": "error", "message": f"Image too large (max {MAX_BASE64_LEN // 1024 // 1024}MB base64)"}

        base_dir = f"datasets/{safe_name}"
        img_dir = f"{base_dir}/images/train"
        label_dir = f"{base_dir}/labels/train"
        os.makedirs(img_dir, exist_ok=True)
        os.makedirs(label_dir, exist_ok=True)
        
        frame_id = str(uuid.uuid4())[:8]
        img_path = f"{img_dir}/frame_{frame_id}.jpg"
        label_path = f"{label_dir}/frame_{frame_id}.txt"
        
        # Save image
        img_data = payload.image_base64.split(",")[1]
        with open(img_path, "wb") as fh:
            fh.write(base64.b64decode(img_data))
            
        # Save YOLO labels
        with open(label_path, "w") as fh:
            for ann in payload.annotations:
                if len(ann.points) > 0:
                    pts = ann.points[0]
                    # pts is [x, y, w, h] in absolute video pixels
                    abs_x = pts[0]
                    abs_y = pts[1]
                    abs_w = pts[2]
                    abs_h = pts[3]
                    
                    # YOLO: x_center, y_center, w, h normalized
                    x_center = (abs_x + (abs_w / 2.0)) / payload.vid_width
                    y_center = (abs_y + (abs_h / 2.0)) / payload.vid_height
                    norm_w = abs_w / payload.vid_width
                    norm_h = abs_h / payload.vid_height
                    
                    fh.write(f"{ann.class_id} {x_center:.6f} {y_center:.6f} {norm_w:.6f} {norm_h:.6f}\n")
                    
        return {"status": "success", "frame_id": frame_id}
    except Exception as e:
        logger.error(f"Error saving annotation: {e}")
        return {"status": "error", "message": str(e)}

@router.post("/ml_train/auto_detect")
async def auto_detect(payload: AutoDetectPayload):
    try:
        import base64
        import numpy as np
        import cv2
        from openai import AsyncOpenAI
        from backend.core.config import Config
        
        # Decode base64 to target opencv array just to get dimensions
        base64_data = payload.image_base64
        if "," in base64_data:
            prefix, base64_data = base64_data.split(",", 1)
            
        decoded = base64.b64decode(base64_data)
        np_arr = np.frombuffer(decoded, np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Invalid Image Data")
            
        img_height, img_width = img.shape[:2]

        client = AsyncOpenAI(api_key=Config.OPENAI_API_KEY, timeout=45)
        
        prompt = (
            f"Detect all instances of '{payload.object_name}' in the image. "
            "Return a JSON array of objects. Each object must have: "
            "'x' (relative left coordinate 0.0-1.0), "
            "'y' (relative top coordinate 0.0-1.0), "
            "'w' (relative width 0.0-1.0), "
            "'h' (relative height 0.0-1.0), "
            "'conf' (confidence score 0.0-1.0)."
        )
        
        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{base64_data}",
                                "detail": "high"
                            }
                        }
                    ]
                }
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "bounding_boxes",
                    "schema": {
                        "type": "object",
                        "properties": {
                            "boxes": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "x": {"type": "number"},
                                        "y": {"type": "number"},
                                        "w": {"type": "number"},
                                        "h": {"type": "number"},
                                        "conf": {"type": "number"}
                                    },
                                    "required": ["x", "y", "w", "h", "conf"],
                                    "additionalProperties": False
                                }
                            }
                        },
                        "required": ["boxes"],
                        "additionalProperties": False
                    },
                    "strict": True
                }
            },
            max_tokens=1000
        )
        
        content = response.choices[0].message.content
        data = json.loads(content)
        
        boxes_out = []
        for b in data.get("boxes", []):
            boxes_out.append({
                "x": b["x"] * img_width,
                "y": b["y"] * img_height,
                "w": b["w"] * img_width,
                "h": b["h"] * img_height,
                "conf": b["conf"]
            })
                
        return {"status": "success", "boxes": boxes_out}
    except Exception as e:
        logger.error(f"Auto-detect array error: {e}", exc_info=True)
        return {"status": "error", "message": str(e)}

def _run_yolo_train(dataset_name: str, epochs: int, model_name: str, log_queue: asyncio.Queue, loop: asyncio.AbstractEventLoop):
    try:
        from ultralytics import YOLO
        import torch
        
        device = 'cuda:0' if torch.cuda.is_available() else 'cpu'
        
        def send_log(msg):
            asyncio.run_coroutine_threadsafe(log_queue.put(msg), loop)

        send_log(f"Initializing {model_name} on {device}...")
        
        model = YOLO(model_name)
        data_yaml = f"{dataset_name}.yaml"
        if not os.path.exists(data_yaml):
            send_log(f"Warning: {data_yaml} not found. Defaulting to 'coco8.yaml' for demonstration.")
            data_yaml = "coco8.yaml"
        
        send_log(f"Starting training for {epochs} epochs...")
        
        results = model.train(
            data=data_yaml,
            epochs=epochs,
            imgsz=640,
            device=device,
            verbose=True,
            batch=2
        )
        send_log("Training completed successfully.")
        
    except Exception as e:
        logger.error(f"[ML_TRAIN] Training failed: {e}", exc_info=True)
        asyncio.run_coroutine_threadsafe(log_queue.put(f"Error during training: {str(e)}"), loop)

@router.websocket("/ws/ml_train")
async def ml_train_websocket(websocket: WebSocket):
    await websocket.accept()
    logger.info("[ML_TRAIN] WebSocket client connected.")
    
    loop = asyncio.get_event_loop()
    log_queue = asyncio.Queue()
    training_task = None

    async def log_sender():
        try:
            while True:
                msg = await log_queue.get()
                if msg == "__DONE__":
                    await websocket.send_json({"status": "finished"})
                    break
                await websocket.send_json({"log": msg})
        except asyncio.CancelledError:
            pass

    sender_task = asyncio.create_task(log_sender())

    try:
        while True:
            data_str = await websocket.receive_text()
            data = json.loads(data_str)
            action = data.get("action")
            
            if action == "start_training":
                dataset = data.get("dataset", "custom")
                epochs = int(data.get("epochs", 10))
                model_name = data.get("model", "yolo11n-seg.pt")
                await log_queue.put(f"> Received training request: Dataset={dataset}, Epochs={epochs}, Model={model_name}")
                training_task = loop.run_in_executor(None, _run_yolo_train, dataset, epochs, model_name, log_queue, loop)
                async def wait_for_train():
                    await training_task
                    await log_queue.put("__DONE__")
                asyncio.create_task(wait_for_train())
            elif action == "stop":
                await log_queue.put("> Training stop requested (Note: Ultralytics interrupts require process kill).")

    except WebSocketDisconnect:
        logger.info("[ML_TRAIN] WebSocket client disconnected.")
    except Exception as e:
        logger.error(f"[ML_TRAIN] WebSocket error: {e}", exc_info=True)
    finally:
        sender_task.cancel()
