# =============================================================================
# CHASE BANKING INTEGRATION ROUTER (via Plaid)
# =============================================================================
# Provides read-only access to Chase bank accounts via Plaid aggregation.
# Flow: Plaid Link popup -> Chase OAuth login -> public_token exchange ->
#       permanent access_token stored on disk -> balance/transaction queries.
# Docs: https://plaid.com/docs/
# =============================================================================

import os
import time
import json
import logging
from datetime import datetime, timedelta, date
from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Query
from pydantic import BaseModel

logger = logging.getLogger("q4nt.chase")

# --- Configuration ---
PLAID_CLIENT_ID = os.getenv("PLAID_CLIENT_ID", "")
PLAID_SECRET = os.getenv("PLAID_SECRET", "")
PLAID_ENV = os.getenv("PLAID_ENV", "sandbox")  # sandbox | development | production
PLAID_TOKEN_FILE = os.getenv("PLAID_TOKEN_FILE", "plaid_chase_tokens.json")

# Plaid environment -> base URL mapping
PLAID_BASE_URLS = {
    "sandbox": "https://sandbox.plaid.com",
    "development": "https://development.plaid.com",
    "production": "https://production.plaid.com",
}
PLAID_BASE_URL = PLAID_BASE_URLS.get(PLAID_ENV, PLAID_BASE_URLS["sandbox"])

PLAID_AVAILABLE = bool(PLAID_CLIENT_ID and PLAID_SECRET)

router = APIRouter(tags=["chase"])

# Shared httpx client for connection pooling
_chase_http: httpx.AsyncClient | None = None

def _client() -> httpx.AsyncClient:
    global _chase_http
    if _chase_http is None:
        _chase_http = httpx.AsyncClient(
            timeout=15.0,
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )
    return _chase_http

if PLAID_AVAILABLE:
    logger.info("[Chase] Plaid integration configured (env: %s)", PLAID_ENV)
else:
    logger.warning("[Chase] NOT configured -- set PLAID_CLIENT_ID and PLAID_SECRET in .env")


def _log_timing(label: str, start: float, extra: str = ""):
    elapsed = int((time.time() - start) * 1000)
    logger.info("[Chase] %s completed in %dms %s", label, elapsed, extra)


# ---- Token Persistence -------------------------------------------------------

def _token_path() -> str:
    return os.path.join(os.path.dirname(__file__), "..", PLAID_TOKEN_FILE)


def _load_access_token() -> Optional[str]:
    """Load stored Plaid access token from file."""
    path = _token_path()
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r") as f:
            data = json.load(f)
        return data.get("access_token")
    except Exception as e:
        logger.warning("[Chase] Failed to load access token: %s", e)
        return None


def _save_access_token(access_token: str, item_id: str) -> None:
    """Persist Plaid access token to disk."""
    try:
        with open(_token_path(), "w") as f:
            json.dump({
                "access_token": access_token,
                "item_id": item_id,
                "connected_at": datetime.now().isoformat(),
                "provider": "plaid",
                "institution": "chase",
            }, f, indent=2)
        logger.info("[Chase] Access token saved")
    except Exception as e:
        logger.error("[Chase] Failed to save access token: %s", e)


def _plaid_request(endpoint: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Make a synchronous POST request to Plaid API."""
    import urllib.request
    url = f"{PLAID_BASE_URL}{endpoint}"
    # Always include client credentials
    payload["client_id"] = PLAID_CLIENT_ID
    payload["secret"] = PLAID_SECRET

    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.request.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else ""
        logger.error("[Chase] Plaid API error %s: %s", e.code, error_body[:300])
        raise


async def _plaid_request_async(endpoint: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """Make an async POST request to Plaid API using shared connection pool."""
    url = f"{PLAID_BASE_URL}{endpoint}"
    payload["client_id"] = PLAID_CLIENT_ID
    payload["secret"] = PLAID_SECRET

    resp = await _client().post(
        url,
        json=payload,
        headers={"Content-Type": "application/json"},
    )
    if resp.status_code != 200:
        logger.error("[Chase] Plaid API error %s: %s", resp.status_code, resp.text[:300])
    resp.raise_for_status()
    return resp.json()


# ---- Link Token (Step 1: Open Chase login popup) ----------------------------

@router.post("/chase/link-token")
async def api_chase_link_token() -> Dict[str, Any]:
    """
    Generate a Plaid Link token. The frontend uses this to open the
    Plaid Link popup where the user logs into Chase.
    """
    start_time = time.time()
    if not PLAID_AVAILABLE:
        return {"error": "Plaid not configured. Add PLAID_CLIENT_ID and PLAID_SECRET to .env"}
    try:
        result = await _plaid_request_async("/link/token/create", {
            "user": {"client_user_id": "q4nt-user-1"},
            "client_name": "Q4NT Platform",
            "products": ["auth", "transactions"],
            "country_codes": ["US"],
            "language": "en",
            # Optionally filter to Chase only:
            # "institution_id": "ins_3",  # Chase's Plaid institution ID
        })
        _log_timing("link_token_create", start_time)
        return {
            "link_token": result.get("link_token"),
            "expiration": result.get("expiration"),
            "request_id": result.get("request_id"),
        }
    except Exception as e:
        logger.error("[Chase] Link token error: %s", e)
        return {"error": str(e)}


# ---- Connect (Step 2: Exchange public_token after login) ---------------------

class ChaseConnectRequest(BaseModel):
    public_token: str


@router.post("/chase/connect")
async def api_chase_connect(req: ChaseConnectRequest) -> Dict[str, Any]:
    """
    Exchange the public_token (received after user completes Plaid Link)
    for a permanent access_token. Stores it on disk.
    """
    start_time = time.time()
    if not PLAID_AVAILABLE:
        return {"error": "Plaid not configured"}
    try:
        result = await _plaid_request_async("/item/public_token/exchange", {
            "public_token": req.public_token,
        })
        access_token = result.get("access_token")
        item_id = result.get("item_id")

        if access_token:
            _save_access_token(access_token, item_id)
            _log_timing("connect", start_time)
            return {
                "status": "connected",
                "item_id": item_id,
                "message": "Chase account connected successfully (read-only).",
            }
        else:
            return {"error": "No access token received from Plaid"}
    except Exception as e:
        logger.error("[Chase] Connect error: %s", e)
        return {"error": str(e)}


# ---- Status ------------------------------------------------------------------

@router.get("/chase/status")
async def api_chase_status() -> Dict[str, Any]:
    """Check if a Chase account is connected."""
    access_token = _load_access_token()
    return {
        "plaid_configured": PLAID_AVAILABLE,
        "connected": access_token is not None,
        "environment": PLAID_ENV,
    }


# ---- Accounts & Balances (Read-Only) ----------------------------------------

@router.get("/chase/accounts")
async def api_chase_accounts() -> Dict[str, Any]:
    """
    Get all linked Chase accounts with real-time balances.
    Returns checking, savings, credit card accounts.
    """
    start_time = time.time()
    access_token = _load_access_token()
    if not access_token:
        return {"error": "Chase not connected. Click the Chase icon to connect."}
    try:
        result = await _plaid_request_async("/accounts/balance/get", {
            "access_token": access_token,
        })

        accounts = []
        for acct in result.get("accounts", []):
            balances = acct.get("balances", {})
            accounts.append({
                "account_id": acct.get("account_id"),
                "name": acct.get("name"),
                "official_name": acct.get("official_name"),
                "type": acct.get("type"),           # depository, credit, loan, etc.
                "subtype": acct.get("subtype"),       # checking, savings, credit card
                "mask": acct.get("mask"),             # last 4 digits
                "current_balance": balances.get("current"),
                "available_balance": balances.get("available"),
                "limit": balances.get("limit"),       # credit limit (for credit cards)
                "currency": balances.get("iso_currency_code", "USD"),
            })

        # Summary stats
        total_checking = sum(
            a.get("current_balance") or 0
            for a in accounts if a.get("subtype") in ("checking", "savings")
        )
        total_credit_used = sum(
            a.get("current_balance") or 0
            for a in accounts if a.get("type") == "credit"
        )

        _log_timing("accounts", start_time, f"({len(accounts)} accounts)")
        return {
            "accounts": accounts,
            "count": len(accounts),
            "summary": {
                "total_cash": total_checking,
                "total_credit_used": total_credit_used,
            },
            "institution": "Chase",
        }
    except Exception as e:
        logger.error("[Chase] Accounts error: %s", e)
        # Check if token is invalid
        error_str = str(e)
        if "ITEM_LOGIN_REQUIRED" in error_str:
            return {"error": "Chase session expired. Please reconnect by clicking the Chase icon."}
        return {"error": str(e)}


# ---- Transactions (Read-Only) ------------------------------------------------

@router.get("/chase/transactions")
async def api_chase_transactions(
    days: int = Query(30, description="Number of days of history (max 90)", ge=1, le=90),
    account_type: Optional[str] = Query(None, description="Filter: checking, savings, credit"),
    limit: int = Query(50, description="Max transactions to return"),
) -> Dict[str, Any]:
    """
    Get recent Chase transactions with merchant name, amount, date, and category.
    """
    start_time = time.time()
    access_token = _load_access_token()
    if not access_token:
        return {"error": "Chase not connected. Click the Chase icon to connect."}
    try:
        end_date = date.today()
        start_date = end_date - timedelta(days=days)

        result = await _plaid_request_async("/transactions/get", {
            "access_token": access_token,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "options": {
                "count": min(limit, 100),
                "offset": 0,
            },
        })

        # Get account info for filtering
        acct_map = {}
        for acct in result.get("accounts", []):
            acct_map[acct.get("account_id")] = {
                "name": acct.get("name"),
                "type": acct.get("type"),
                "subtype": acct.get("subtype"),
                "mask": acct.get("mask"),
            }

        transactions = []
        for txn in result.get("transactions", []):
            acct_info = acct_map.get(txn.get("account_id"), {})
            # Filter by account type if specified
            if account_type and acct_info.get("subtype") != account_type:
                continue

            transactions.append({
                "transaction_id": txn.get("transaction_id"),
                "date": txn.get("date"),
                "name": txn.get("name"),                    # Merchant name
                "merchant_name": txn.get("merchant_name"),
                "amount": txn.get("amount"),                 # Positive = debit
                "category": txn.get("category"),
                "primary_category": (txn.get("category") or [""])[0],
                "pending": txn.get("pending", False),
                "account_name": acct_info.get("name"),
                "account_type": acct_info.get("subtype"),
                "account_mask": acct_info.get("mask"),
                "currency": txn.get("iso_currency_code", "USD"),
            })

        # Spending summary
        total_spent = sum(t["amount"] for t in transactions if t["amount"] > 0)
        total_received = sum(abs(t["amount"]) for t in transactions if t["amount"] < 0)

        _log_timing("transactions", start_time, f"({len(transactions)} txns, {days}d)")
        return {
            "transactions": transactions[:limit],
            "count": len(transactions),
            "total_available": result.get("total_transactions", 0),
            "date_range": {
                "start": start_date.isoformat(),
                "end": end_date.isoformat(),
                "days": days,
            },
            "summary": {
                "total_spent": round(total_spent, 2),
                "total_received": round(total_received, 2),
                "net": round(total_received - total_spent, 2),
            },
            "institution": "Chase",
        }
    except Exception as e:
        logger.error("[Chase] Transactions error: %s", e)
        error_str = str(e)
        if "ITEM_LOGIN_REQUIRED" in error_str:
            return {"error": "Chase session expired. Please reconnect."}
        if "PRODUCT_NOT_READY" in error_str:
            return {"error": "Transaction data is still loading. Please try again in a moment."}
        return {"error": str(e)}


# ---- Disconnect --------------------------------------------------------------

@router.post("/chase/disconnect")
async def api_chase_disconnect() -> Dict[str, Any]:
    """Remove the Chase connection (delete stored access token)."""
    access_token = _load_access_token()
    if not access_token:
        return {"status": "not_connected"}

    # Remove from Plaid
    try:
        await _plaid_request_async("/item/remove", {
            "access_token": access_token,
        })
    except Exception as e:
        logger.warning("[Chase] Plaid item/remove failed (continuing): %s", e)

    # Delete local token file
    path = _token_path()
    if os.path.exists(path):
        os.remove(path)
        logger.info("[Chase] Token file deleted")

    return {"status": "disconnected", "message": "Chase account disconnected."}
