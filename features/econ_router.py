import time
import logging
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from backend.core.cache import SimpleCache, log_timing
import httpx
import os

EIA_API_KEY = os.environ.get("EIA_API_KEY")
_http_client = httpx.AsyncClient()

logger = logging.getLogger("main_server")
router = APIRouter(tags=["economics"])

# =============================================================================
# FED NEWS ENDPOINT (Federal Reserve RSS)
# =============================================================================
_fed_news_cache = SimpleCache(ttl_seconds=300.0, name="fed_news")

@router.get("/fed-news")
def api_fed_news(limit: int = 10):
    """Get latest Federal Reserve news items from official RSS feeds."""
    start_time = time.time()
    logger.info(f"[API] /api/fed-news called: limit={limit}")

    # Check cache
    cached = _fed_news_cache.get()
    if cached is not None:
        log_timing("api_fed_news (cached)", start_time)
        return JSONResponse(
            content={"results": cached[:limit]},
            headers={"Cache-Control": "max-age=300"}
        )

    try:
        from backend.features.news.fetch_fed_rss import get_latest_fed_news
        items = get_latest_fed_news(limit)
        _fed_news_cache.set(items)
        logger.info(f"[API] Fetched {len(items)} fed news items from RSS")
        log_timing("api_fed_news", start_time)
        return JSONResponse(
            content={"results": items},
            headers={"Cache-Control": "max-age=300"}
        )
    except Exception as e:
        logger.error(f"[API] Fed news error: {e}")
        return JSONResponse(
            content={"results": [], "error": str(e)},
            status_code=500
        )


# =============================================================================
# FRED ECONOMIC INDICATORS ENDPOINTS
# =============================================================================
_fred_indicators_cache = SimpleCache(ttl_seconds=900.0, name="fred_indicators")

@router.get("/fred/indicators")
def api_fred_indicators():
    """Get all key economic indicators (CPI, PCE, GDP, rates, etc.) from FRED."""
    start_time = time.time()
    logger.info("[API] /api/fred/indicators called")

    # Check cache (15-min TTL since data changes infrequently)
    cached = _fred_indicators_cache.get()
    if cached is not None:
        log_timing("api_fred_indicators (cached)", start_time)
        return JSONResponse(
            content={"indicators": cached},
            headers={"Cache-Control": "max-age=900"}
        )

    try:
        from backend.features.news.fetch_fred import get_all_indicators
        indicators = get_all_indicators()
        _fred_indicators_cache.set(indicators)
        log_timing("api_fred_indicators", start_time, f"({len(indicators)} series)")
        return JSONResponse(
            content={"indicators": indicators},
            headers={"Cache-Control": "max-age=900"}
        )
    except Exception as e:
        logger.error(f"[API] FRED indicators error: {e}")
        return JSONResponse(
            content={"indicators": [], "error": str(e)},
            status_code=500
        )


@router.get("/fred/series/{series_id}")
def api_fred_series(series_id: str, limit: int = 60):
    """Get historical observations for a specific FRED series (for charting)."""
    start_time = time.time()
    logger.info(f"[API] /api/fred/series/{series_id} called: limit={limit}")

    try:
        from backend.features.news.fetch_fred import get_series_observations
        result = get_series_observations(series_id, limit=limit)
        log_timing(f"api_fred_series({series_id})", start_time)
        return JSONResponse(
            content=result,
            headers={"Cache-Control": "max-age=900"}
        )
    except Exception as e:
        logger.error(f"[API] FRED series error: {e}")
        return JSONResponse(
            content={"error": str(e), "observations": []},
            status_code=500
        )


_fred_calendar_cache = {}  # category -> (timestamp, data)

@router.get("/fred/calendar/{category}")
def api_fred_calendar(category: str):
    """Get upcoming release dates for a FRED category (fed, cpi, jobs, gdp, global)."""
    start_time = time.time()
    logger.info(f"[API] /api/fred/calendar/{category} called")

    # Check cache (1-hour TTL per category)
    cached = _fred_calendar_cache.get(category)
    if cached and (time.time() - cached[0]) < 3600:
        log_timing(f"api_fred_calendar({category}) (cached)", start_time)
        return JSONResponse(
            content=cached[1],
            headers={"Cache-Control": "max-age=3600"}
        )

    try:
        from backend.features.news.fetch_fred import get_release_calendar
        result = get_release_calendar(category)
        _fred_calendar_cache[category] = (time.time(), result)
        log_timing(f"api_fred_calendar({category})", start_time, f"({len(result.get('events', []))} events)")
        return JSONResponse(
            content=result,
            headers={"Cache-Control": "max-age=3600"}
        )
    except Exception as e:
        logger.error(f"[API] FRED calendar error: {e}")
        return JSONResponse(
            content={"category": category, "events": [], "error": str(e)},
            status_code=500
        )

# =============================================================================
# US TREASURY FISCAL DATA  (National Debt - Debt to the Penny)
# =============================================================================
_treasury_debt_cache = SimpleCache(ttl_seconds=900.0, name="treasury_debt")

@router.get("/treasury/debt")
async def api_treasury_debt(limit: int = 120):
    """Fetch US national debt history from Treasury Fiscal Data API (no key required)."""
    start_time = time.time()
    logger.info(f"[API] /api/treasury/debt called: limit={limit}")

    cached = _treasury_debt_cache.get()
    if cached is not None:
        log_timing("api_treasury_debt (cached)", start_time)
        return JSONResponse(
            content=cached,
            headers={"Cache-Control": "max-age=900"}
        )

    try:
        url = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny"
        params = {
            "sort": "-record_date",
            "page[size]": limit,
            "fields": "record_date,tot_pub_debt_out_amt",
        }
        resp = await _http_client.get(url, params=params, timeout=15.0)
        resp.raise_for_status()
        raw = resp.json().get("data", [])

        observations = []
        for entry in raw:
            try:
                val = float(entry.get("tot_pub_debt_out_amt", 0))
                observations.append({
                    "date": entry.get("record_date", ""),
                    "value": val,
                })
            except (ValueError, TypeError):
                continue

        observations.reverse()  # chronological order

        result = {
            "series_id": "NATIONAL_DEBT",
            "count": len(observations),
            "observations": observations,
        }
        _treasury_debt_cache.set(result)
        log_timing("api_treasury_debt", start_time, f"({len(observations)} points)")
        return JSONResponse(
            content=result,
            headers={"Cache-Control": "max-age=900"}
        )
    except Exception as e:
        logger.error(f"[API] Treasury debt error: {e}")
        return JSONResponse(
            content={"error": str(e), "observations": []},
            status_code=500
        )


# =============================================================================
# FEAR & GREED INDEX  (Alternative.me Crypto Fear & Greed Index - no key)
# =============================================================================
_fear_greed_cache = SimpleCache(ttl_seconds=600.0, name="fear_greed")

@router.get("/fear-greed")
async def api_fear_greed(limit: int = 30):
    """Fetch Crypto Fear & Greed Index from Alternative.me (free, no key)."""
    start_time = time.time()
    logger.info(f"[API] /api/fear-greed called: limit={limit}")

    cached = _fear_greed_cache.get()
    if cached is not None:
        log_timing("api_fear_greed (cached)", start_time)
        return JSONResponse(
            content=cached,
            headers={"Cache-Control": "max-age=600"}
        )

    try:
        url = "https://api.alternative.me/fng/"
        params = {"limit": limit, "format": "json"}
        resp = await _http_client.get(url, params=params, timeout=15.0)
        resp.raise_for_status()
        raw = resp.json()
        data = raw.get("data", [])

        result = {
            "name": "Fear and Greed Index",
            "data": data,
            "count": len(data),
        }
        _fear_greed_cache.set(result)
        log_timing("api_fear_greed", start_time, f"({len(data)} points)")
        return JSONResponse(
            content=result,
            headers={"Cache-Control": "max-age=600"}
        )
    except Exception as e:
        logger.error(f"[API] Fear & Greed error: {e}")
        return JSONResponse(
            content={"error": str(e), "data": []},
            status_code=500
        )


# =============================================================================
# CNN MARKET FEAR & GREED INDEX
# =============================================================================
_cnn_fear_greed_cache = SimpleCache(ttl_seconds=600.0, name="cnn_fear_greed")

@router.get("/fear-greed-market")
async def api_fear_greed_market(limit: int = 30):
    """Fetch Stock Market Fear & Greed Index from CNN Dataviz API."""
    start_time = time.time()
    logger.info(f"[API] /api/fear-greed-market called: limit={limit}")

    cached = _cnn_fear_greed_cache.get()
    if cached is not None:
        log_timing("api_fear_greed_market (cached)", start_time)
        return JSONResponse(
            content=cached,
            headers={"Cache-Control": "max-age=600"}
        )

    try:
        url = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
            'Accept': 'application/json'
        }
        resp = await _http_client.get(url, headers=headers, timeout=15.0, follow_redirects=True)
        resp.raise_for_status()
        raw = resp.json()
        
        current = raw.get("fear_and_greed", {})
        historical_raw = raw.get("fear_and_greed_historical", {}).get("data", [])
        
        # Take the last `limit` days from historical
        historical_data = []
        for item in historical_raw[-limit:]:
             historical_data.append({
                 "timestamp": item.get("x"),
                 "value": item.get("y"),
                 "rating": item.get("rating")
             })
             
        result = {
            "name": "CNN Market Fear and Greed Index",
            "current": current,
            "historical": historical_data,
            "count": len(historical_data),
        }
        _cnn_fear_greed_cache.set(result)
        log_timing("api_fear_greed_market", start_time, f"({len(historical_data)} historical points)")
        return JSONResponse(
            content=result,
            headers={"Cache-Control": "max-age=600"}
        )
    except Exception as e:
        logger.error(f"[API] CNN Fear & Greed error: {e}")
        return JSONResponse(
            content={"error": str(e), "current": {}, "historical": []},
            status_code=500
        )


# =============================================================================
# EIA (Energy Information Administration) ENDPOINTS
# =============================================================================
_eia_gasoline_cache = SimpleCache(ttl_seconds=900.0, name="eia_gasoline")
_eia_petro_trade_cache = SimpleCache(ttl_seconds=900.0, name="eia_petro_trade")
_eia_natgas_cache = SimpleCache(ttl_seconds=900.0, name="eia_natgas")
_eia_electricity_cache = SimpleCache(ttl_seconds=900.0, name="eia_electricity")

EIA_BASE = "https://api.eia.gov/v2"


async def _eia_fetch_series(route: str, params: dict) -> dict:
    """Async helper to fetch from EIA API v2 using shared connection pool."""
    if not EIA_API_KEY:
        raise ValueError("EIA_API_KEY not configured in .env")
    params["api_key"] = EIA_API_KEY
    url = f"{EIA_BASE}/{route}/"
    resp = await _http_client.get(url, params=params, timeout=30.0)
    resp.raise_for_status()
    return resp.json()


def _parse_eia_observations(data: dict, value_key: str = "value") -> list:
    """Extract date/value observations from EIA API v2 response."""
    raw = data.get("response", {}).get("data", [])
    observations = []
    for entry in raw:
        try:
            val = float(entry.get(value_key, 0))
            observations.append({"date": entry.get("period", ""), "value": val})
        except (ValueError, TypeError):
            continue
    observations.reverse()
    return observations


# Background retry for EIA API failures (wait 2 min, then retry)
import threading
_eia_pending_retries: set = set()

def _eia_schedule_retry(endpoint_name: str, fetch_fn):
    """Schedule a background retry for a failed EIA endpoint after 2 minutes."""
    if endpoint_name in _eia_pending_retries:
        return  # already scheduled
    _eia_pending_retries.add(endpoint_name)
    logger.info(f"[EIA Retry] Scheduling retry for {endpoint_name} in 120s")

    def _do_retry():
        try:
            logger.info(f"[EIA Retry] Retrying {endpoint_name}...")
            fetch_fn()
            logger.info(f"[EIA Retry] {endpoint_name} succeeded on retry")
        except Exception as e:
            logger.warning(f"[EIA Retry] {endpoint_name} retry failed: {e} - will retry again in 120s")
            # Schedule another retry
            _eia_pending_retries.discard(endpoint_name)
            _eia_schedule_retry(endpoint_name, fetch_fn)
            return
        _eia_pending_retries.discard(endpoint_name)

    timer = threading.Timer(120.0, _do_retry)
    timer.daemon = True
    timer.start()


@router.get("/eia/gasoline-prices")
async def api_eia_gasoline_prices(limit: int = 200):
    """Weekly US retail gasoline prices (all grades, all formulations) from EIA."""
    start_time = time.time()
    logger.info(f"[API] /api/eia/gasoline-prices called: limit={limit}")

    cached = _eia_gasoline_cache.get()
    if cached is not None:
        log_timing("api_eia_gasoline (cached)", start_time)
        return JSONResponse(content=cached, headers={"Cache-Control": "max-age=900"})

    try:
        data = await _eia_fetch_series("petroleum/pri/gnd/data", {
            "frequency": "weekly",
            "data[0]": "value",
            "facets[product][]": "EPM0",
            "facets[duoarea][]": "NUS",
            "sort[0][column]": "period",
            "sort[0][direction]": "desc",
            "length": limit,
        })
        observations = _parse_eia_observations(data)

        result = {
            "series_id": "EIA_GASOLINE",
            "title": "US Retail Gasoline Prices (All Grades)",
            "units": "$/gallon",
            "count": len(observations),
            "observations": observations,
        }
        _eia_gasoline_cache.set(result)
        log_timing("api_eia_gasoline", start_time, f"({len(observations)} points)")
        return JSONResponse(content=result, headers={"Cache-Control": "max-age=900"})
    except Exception as e:
        logger.error(f"[API] EIA gasoline error: {e}")
        _eia_schedule_retry("gasoline-prices", lambda: api_eia_gasoline_prices(limit))
        return JSONResponse(content={"error": str(e), "observations": []}, status_code=500)


_eia_gas_by_state_cache = SimpleCache(ttl_seconds=86400.0, name="eia_gas_by_state") # AAA data cached for 24 hours

# EIA duoarea codes for US states (S prefix = state)
_EIA_STATE_CODES = {
    "SAL": "Alabama", "SAK": "Alaska", "SAZ": "Arizona", "SAR": "Arkansas",
    "SCA": "California", "SCO": "Colorado", "SCT": "Connecticut", "SDE": "Delaware",
    "SDC": "District of Columbia", "SFL": "Florida", "SGA": "Georgia", "SHI": "Hawaii",
    "SID": "Idaho", "SIL": "Illinois", "SIN": "Indiana", "SIA": "Iowa",
    "SKS": "Kansas", "SKY": "Kentucky", "SLA": "Louisiana", "SME": "Maine",
    "SMD": "Maryland", "SMA": "Massachusetts", "SMI": "Michigan", "SMN": "Minnesota",
    "SMS": "Mississippi", "SMO": "Missouri", "SMT": "Montana", "SNE": "Nebraska",
    "SNV": "Nevada", "SNH": "New Hampshire", "SNJ": "New Jersey", "SNM": "New Mexico",
    "SNY": "New York", "SNC": "North Carolina", "SND": "North Dakota", "SOH": "Ohio",
    "SOK": "Oklahoma", "SOR": "Oregon", "SPA": "Pennsylvania", "SRI": "Rhode Island",
    "SSC": "South Carolina", "SSD": "South Dakota", "STN": "Tennessee", "STX": "Texas",
    "SUT": "Utah", "SVT": "Vermont", "SVA": "Virginia", "SWA": "Washington",
    "SWV": "West Virginia", "SWI": "Wisconsin", "SWY": "Wyoming",
}


@router.get("/eia/gasoline-by-state")
def api_eia_gasoline_by_state():
    """Latest retail gasoline prices by US state from AAA."""
    start_time = time.time()
    logger.info("[API] /api/eia/gasoline-by-state called (AAA override)")

    cached = _eia_gas_by_state_cache.get()
    if cached is not None:
        log_timing("api_eia_gas_by_state (cached)", start_time)
        return JSONResponse(content=cached, headers={"Cache-Control": "max-age=86400"})

    try:
        import urllib.request
        from bs4 import BeautifulSoup
        import re
        
        req = urllib.request.Request(
            "https://gasprices.aaa.com/state-gas-price-averages/",
            headers={'User-Agent': 'Mozilla/5.0'}
        )
        with urllib.request.urlopen(req) as response:
            html = response.read()

        soup = BeautifulSoup(html, 'html.parser')
        
        states = []
        us_avg = None
        
        # Try finding the national average from the top element
        avg_el = soup.find(text=re.compile(r'National Average'))
        if avg_el and avg_el.parent:
            avg_text = avg_el.parent.get_text(separator=' ', strip=True)
            match = re.search(r'\$([\d\.]+)', avg_text)
            if match:
                us_avg = float(match.group(1))

        # Reverse map for state codes
        name_to_code = {v: k[1:] for k, v in _EIA_STATE_CODES.items()}
        
        table = soup.find('table')
        if table:
            for row in table.find_all('tr')[1:]:
                cols = row.find_all('td')
                if len(cols) >= 2:
                    name = cols[0].get_text(strip=True)
                    price_str = cols[1].get_text(strip=True).replace('$', '')
                    
                    if "Columbia" in name:
                        name = "District of Columbia"
                        
                    try:
                        price = float(price_str)
                    except ValueError:
                        continue
                        
                    code = name_to_code.get(name)
                    if code:
                        states.append({
                            "state": name,
                            "code": code,
                            "price": price
                        })

        # Sort by price descending
        states.sort(key=lambda x: x["price"], reverse=True)

        result = {
            "series_id": "AAA_GAS_BY_STATE",
            "title": "Regular Grade Gasoline Prices by State (AAA)",
            "period": "Today",
            "us_average": us_avg,
            "units": "$/gallon",
            "count": len(states),
            "states": states,
        }
        
        _eia_gas_by_state_cache.set(result)
        log_timing("api_eia_gas_by_state (AAA)", start_time, f"({len(states)} states)")
        return JSONResponse(content=result, headers={"Cache-Control": "max-age=86400"})
    except Exception as e:
        logger.error(f"[API] AAA gas by state error: {e}")
        _eia_schedule_retry("gasoline-by-state", lambda: api_eia_gasoline_by_state())
        return JSONResponse(content={"error": str(e), "states": []}, status_code=500)


@router.get("/eia/petroleum-trade")
async def api_eia_petroleum_trade(limit: int = 120):
    """Monthly US petroleum imports and exports from EIA."""
    start_time = time.time()
    logger.info(f"[API] /api/eia/petroleum-trade called: limit={limit}")

    cached = _eia_petro_trade_cache.get()
    if cached is not None:
        log_timing("api_eia_petro_trade (cached)", start_time)
        return JSONResponse(content=cached, headers={"Cache-Control": "max-age=900"})

    try:
        # Fetch imports
        imp_data = await _eia_fetch_series("petroleum/move/imp/data", {
            "frequency": "monthly",
            "data[0]": "value",
            "facets[product][]": "EP00",
            "facets[process][]": "IM0",
            "sort[0][column]": "period",
            "sort[0][direction]": "desc",
            "length": limit,
        })
        imports = _parse_eia_observations(imp_data)

        # Fetch exports
        exp_data = await _eia_fetch_series("petroleum/move/exp/data", {
            "frequency": "monthly",
            "data[0]": "value",
            "facets[product][]": "EP00",
            "facets[process][]": "EX0",
            "sort[0][column]": "period",
            "sort[0][direction]": "desc",
            "length": limit,
        })
        exports = _parse_eia_observations(exp_data)

        result = {
            "series_id": "EIA_PETRO_TRADE",
            "title": "US Petroleum Imports & Exports",
            "units": "Thousand Barrels",
            "imports": imports,
            "exports": exports,
            "count_imports": len(imports),
            "count_exports": len(exports),
        }
        _eia_petro_trade_cache.set(result)
        log_timing("api_eia_petro_trade", start_time,
                   f"({len(imports)} imp, {len(exports)} exp)")
        return JSONResponse(content=result, headers={"Cache-Control": "max-age=900"})
    except Exception as e:
        logger.error(f"[API] EIA petroleum trade error: {e}")
        _eia_schedule_retry("petroleum-trade", lambda: api_eia_petroleum_trade(limit))
        return JSONResponse(content={"error": str(e), "imports": [], "exports": []}, status_code=500)


@router.get("/eia/natural-gas-prices")
async def api_eia_natural_gas_prices(limit: int = 200):
    """Monthly US natural gas Henry Hub spot prices from EIA."""
    start_time = time.time()
    logger.info(f"[API] /api/eia/natural-gas-prices called: limit={limit}")

    cached = _eia_natgas_cache.get()
    if cached is not None:
        log_timing("api_eia_natgas (cached)", start_time)
        return JSONResponse(content=cached, headers={"Cache-Control": "max-age=900"})

    try:
        data = await _eia_fetch_series("natural-gas/pri/sum/data", {
            "frequency": "monthly",
            "data[0]": "value",
            "facets[process][]": "PRS",
            "facets[duoarea][]": "NUS",
            "sort[0][column]": "period",
            "sort[0][direction]": "desc",
            "length": limit,
        })
        observations = _parse_eia_observations(data)

        result = {
            "series_id": "EIA_NATGAS",
            "title": "US Natural Gas Price (Residential)",
            "units": "$/MCF",
            "count": len(observations),
            "observations": observations,
        }
        _eia_natgas_cache.set(result)
        log_timing("api_eia_natgas", start_time, f"({len(observations)} points)")
        return JSONResponse(content=result, headers={"Cache-Control": "max-age=900"})
    except Exception as e:
        logger.error(f"[API] EIA natural gas error: {e}")
        _eia_schedule_retry("natural-gas-prices", lambda: api_eia_natural_gas_prices(limit))
        return JSONResponse(content={"error": str(e), "observations": []}, status_code=500)


@router.get("/eia/electricity")
async def api_eia_electricity(limit: int = 120):
    """Monthly US net electricity generation from EIA."""
    start_time = time.time()
    logger.info(f"[API] /api/eia/electricity called: limit={limit}")

    cached = _eia_electricity_cache.get()
    if cached is not None:
        log_timing("api_eia_electricity (cached)", start_time)
        return JSONResponse(content=cached, headers={"Cache-Control": "max-age=900"})

    try:
        data = await _eia_fetch_series("electricity/electric-power-operational-data/data", {
            "frequency": "monthly",
            "data[0]": "generation",
            "facets[sectorid][]": "99",
            "facets[fueltypeid][]": "ALL",
            "facets[location][]": "US",
            "sort[0][column]": "period",
            "sort[0][direction]": "desc",
            "length": limit,
        })
        observations = _parse_eia_observations(data, value_key="generation")

        result = {
            "series_id": "EIA_ELECTRICITY",
            "title": "US Net Electricity Generation (All Sources)",
            "units": "Thousand MWh",
            "count": len(observations),
            "observations": observations,
        }
        _eia_electricity_cache.set(result)
        log_timing("api_eia_electricity", start_time, f"({len(observations)} points)")
        return JSONResponse(content=result, headers={"Cache-Control": "max-age=900"})
    except Exception as e:
        logger.error(f"[API] EIA electricity error: {e}")
        _eia_schedule_retry("electricity", lambda: api_eia_electricity(limit))
        return JSONResponse(content={"error": str(e), "observations": []}, status_code=500)


