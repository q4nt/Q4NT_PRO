from fastapi import APIRouter, HTTPException, Depends
import logging
from backend.services.external_api import api_service
from backend.core.auth import require_auth
from typing import Dict, Any

logger = logging.getLogger("blockchain_router")

router = APIRouter(tags=["blockchain"])

# We proxy blockchain.info/charts/ to avoid CORS issues and keep it centralized.
BLOCKCHAIN_API_BASE = "https://api.blockchain.info/charts"

@router.get("/blockchain/chart/{chart_name}", dependencies=[Depends(require_auth)])
async def get_blockchain_chart(chart_name: str, timespan: str = "1year", format: str = "json") -> Dict[str, Any]:
    """
    Fetch a specific chart from Blockchain.com API.
    Common chart names: hash-rate, mempool-size, n-transactions, trade-volume
    """
    url = f"{BLOCKCHAIN_API_BASE}/{chart_name}?timespan={timespan}&format={format}"
    logger.info(f"[Blockchain] Fetching chart: {chart_name} (timespan: {timespan})")
    
    try:
        resp = await api_service.get(url, timeout=10.0)
        data = resp.json()
        
        if resp.status_code != 200:
            logger.error(f"[Blockchain] API error {resp.status_code}: {data}")
            raise HTTPException(status_code=resp.status_code, detail=f"Blockchain API error: {resp.text}")
            
        return data
    except Exception as e:
        logger.error(f"[Blockchain] Error fetching {chart_name}: {e}")
        raise HTTPException(status_code=502, detail=f"Blockchain API error: {str(e)}")
