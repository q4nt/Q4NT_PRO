import os
import re
import json
import time
import asyncio
import logging
from typing import Dict, Any, List
from datetime import datetime, timezone
from pydantic import BaseModel
from fastapi import APIRouter, Query, Request, HTTPException
from backend.core.cache import SimpleCache, log_timing
logger = logging.getLogger("main_server")
router = APIRouter(tags=["polymarket"])

from backend.services.external_api import api_service
from backend.services.openai_service import openai_service

# =============================================================================
# POLYMARKET ENDPOINTS (ported from api_old.py)
# =============================================================================

# Pre-compiled regex patterns for filtering
SPORTS_PATTERN = re.compile(
    r"\b(vs\.?|nba|nfl|nhl|mlb|cfb|ufc|fight|match|game|playoffs|super bowl|champions league|cup"
    r"|soccer|tennis|f1|formula|boxing|wrestling|mma|premier league|la liga|bundesliga"
    r"|serie a|ligue 1|cricket|rugby|ncaa|college football|college basketball"
    r"|world series|stanley cup|grand prix|wimbledon|open championship"
    r"|ryder cup|daytona|nascar|pga|lpga|draft|mvp|all.?star|touchdown|goal"
    r"|assists?|rebounds?|strikeouts?|batting|quarterback|pitcher|goalkeeper"
    r"|seeds?|bracket|playoff|postseason|preseason|regular season)\b",
    re.I
)

CULTURE_PATTERN = re.compile(
    r"\b(movie|film|tv|show|album|music|song|actor|actress|oscar|grammy|emmy|celebrity"
    r"|netflix|disney|hbo|streaming|box office|billboard|concert|tour"
    r"|reality tv|bachelor|bachelorette|survivor|idol|voice"
    r"|tiktok|influencer|youtube|podcast|award show)\b",
    re.I
)

# Caches
_polymarket_all_cache = SimpleCache(ttl_seconds=120.0, name="polymarket_all")
_polymarket_space_cache = SimpleCache(ttl_seconds=300.0, name="polymarket_space_classified")
_polymarket_cache = SimpleCache(ttl_seconds=120.0, name="polymarket")
_polymarket_corr_cache = SimpleCache(ttl_seconds=300.0, name="polymarket_correlations")


def _as_list(x):
    """Helper to safely convert to list."""
    if x is None:
        return []
    if isinstance(x, list):
        return x
    if isinstance(x, str) and x.strip().startswith("["):
        try:
            return json.loads(x)
        except json.JSONDecodeError:
            return []
    return []


POLYMARKET_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "polymarket_classifications.json")

def load_classification_cache() -> Dict[str, str]:
    if os.path.exists(POLYMARKET_CACHE_FILE):
        try:
            with open(POLYMARKET_CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Failed to load polymarket classification cache: {e}")
    return {}

def save_classification_cache(cache: Dict[str, str]):
    try:
        tmp_file = POLYMARKET_CACHE_FILE + ".tmp"
        with open(tmp_file, "w", encoding="utf-8") as f:
            json.dump(cache, f, indent=2, ensure_ascii=False)
        os.replace(tmp_file, POLYMARKET_CACHE_FILE)
    except Exception as e:
        logger.warning(f"Failed to save polymarket classification cache: {e}")



def _classify_market_regex(question: str, slug: str, tags: str) -> str:
    """Fast regex-based classification: returns 'sports', 'popculture', or 'market'."""
    combined = question + " " + slug + " " + tags
    if SPORTS_PATTERN.search(combined):
        return "sports"
    if CULTURE_PATTERN.search(combined):
        return "popculture"
    return "market"


async def _classify_markets_openai(questions: List[str]) -> Dict[int, str]:
    """Use OpenAI to bulk-classify market questions into spaces.
    Returns {index: 'market'|'sports'|'popculture'}.
    Falls back to regex if OpenAI is unavailable."""
    if not OPENAI_API_KEY or len(questions) == 0:
        return {}

    # Build numbered question list (send in batches of 200)
    batch_size = 200
    all_classifications: Dict[int, str] = {}

    client = openai_service.async_client()
    sem = asyncio.Semaphore(5)

    async def _process_batch(batch_start, batch):
        q_list = "\n".join([
            f"  {batch_start + i}: {q[:120]}" for i, q in enumerate(batch)
        ])

        prompt = f"""Classify each prediction market question into exactly one category.

CATEGORIES:
- "market": economy, crypto, tech, finance, earnings, politics, elections, weather, science, geopolitics, regulation, monetary policy, trade, warfare, diplomacy
- "sports": NBA, NFL, MLB, NHL, soccer, tennis, golf, UFC/MMA, F1, cricket, Olympics, esports, any athletic competition, player stats, game outcomes, championships, draft picks, betting lines
- "popculture": music, movies, TV shows, celebrities, entertainment awards (Oscar, Grammy, Emmy), streaming platforms, social media, influencers, reality TV, box office, albums, concerts, TikTok, YouTube creators

QUESTIONS:
{q_list}

Return ONLY a JSON object mapping question index to category.
Example: {{"0": "market", "1": "sports", "2": "popculture"}}
Classify ALL questions. If uncertain, default to "market"."""

        try:
            async with sem:
                t0 = time.time()
                resp = await client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"},
                    max_completion_tokens=8000
                )
                elapsed_ms = int((time.time() - t0) * 1000)
                logger.info(f"[API] OpenAI classification batch {batch_start}-{batch_start + len(batch)} in {elapsed_ms}ms")

                content = resp.choices[0].message.content.strip()
                parsed = json.loads(content)
                return parsed
        except Exception as e:
            logger.warning(f"[API] OpenAI classification batch failed: {e}")
            return {}

    tasks = []
    for batch_start in range(0, len(questions), batch_size):
        batch = questions[batch_start:batch_start + batch_size]
        tasks.append(_process_batch(batch_start, batch))

    results = await asyncio.gather(*tasks)

    valid_cats = {"market", "sports", "popculture"}
    for parsed in results:
        for k, v in parsed.items():
            try:
                idx = int(k)
                cat = v.lower().strip()
                if cat in valid_cats:
                    all_classifications[idx] = cat
            except (ValueError, AttributeError):
                continue

    return all_classifications


def _parse_polymarket_market(m: Dict[str, Any], now_utc: datetime) -> List[Dict[str, Any]]:
    """Parse a single Polymarket API market dict into row dicts.
    Returns empty list if the market is inactive or expired."""
    if not m.get("active", True):
        return []

    end_date_str = m.get("endDateIso")
    if end_date_str:
        try:
            clean_date = end_date_str.replace("Z", "+00:00")
            end_date = datetime.fromisoformat(clean_date)
            if end_date.tzinfo is None:
                end_date = end_date.replace(tzinfo=timezone.utc)
            if end_date < now_utc:
                return []
        except ValueError:
            pass

    question = (m.get("question") or "").strip()
    slug = (m.get("slug") or "").lower()
    tags = " ".join(str(t) for t in (m.get("tags") or []))
    outs = _as_list(m.get("outcomes"))
    prices = _as_list(m.get("outcomePrices"))
    space_label = _classify_market_regex(question, slug, tags)

    rows = []
    for i in range(min(len(outs), len(prices))):
        try:
            p = float(prices[i])
        except (TypeError, ValueError):
            continue
        rows.append({
            "market_id": m.get("id"),
            "question": question,
            "volume24hr": m.get("volume24hr"),
            "outcome": outs[i],
            "implied_pct": round(p * 100, 2),
            "endDate": m.get("endDateIso"),
            "url": m.get("url") or f"https://polymarket.com/market/{m.get('slug')}",
            "_space_regex": space_label,
            "_slug": slug,
            "_tags": tags,
        })
    return rows


async def _fetch_all_polymarket_rows() -> List[Dict[str, Any]]:
    """Fetch all Polymarket rows (no filtering). Uses cache."""
    cached = _polymarket_all_cache.get()
    if cached is not None:
        return cached

    BASE = "https://gamma-api.polymarket.com/markets"
    PAGE_SIZE = 500
    MAX_MARKETS = 5000

    all_markets = []
    try:
        fetch_start = time.time()
        offset = 0
        while offset < MAX_MARKETS:
            params = {
                "limit": PAGE_SIZE,
                "offset": offset,
                "closed": "false",
                "order": "volume24hr",
                "ascending": "false",
            }
            resp = await api_service.get(BASE, params=params, timeout=20.0)
            resp.raise_for_status()
            page = resp.json()
            if not page or len(page) == 0:
                break
            all_markets.extend(page)
            if len(page) < PAGE_SIZE:
                break
            offset += PAGE_SIZE
        log_timing("polymarket_fetch", fetch_start, f"({len(all_markets)} markets in {offset // PAGE_SIZE + 1} pages)")

    except Exception as e:
        logger.error(f"[API] _fetch_all_polymarket_rows error: {e}")
        return []

    logger.info(f"[API] Fetched {len(all_markets)} total markets from Polymarket")

    now_utc = datetime.now(timezone.utc)
    rows = []
    for m in all_markets:
        rows.extend(_parse_polymarket_market(m, now_utc))

    # Sort by volume desc
    def sort_key(item):
        v = float(item.get("volume24hr") or 0)
        q = item.get("question") or ""
        p = float(item.get("implied_pct") or 0)
        return (-v, q, -p)

    rows.sort(key=sort_key)
    _polymarket_all_cache.set(rows)
    return rows


async def _get_classified_markets() -> Dict[int, List[Dict[str, Any]]]:
    """Get markets classified by space (1=market, 2=sports, 3=popculture).
    Uses OpenAI for ambiguous markets, regex for clear-cut ones."""
    cached = _polymarket_space_cache.get()
    if cached is not None:
        return cached

    all_rows = await _fetch_all_polymarket_rows()
    if not all_rows:
        return {1: [], 2: [], 3: []}

    # Deduplicate questions for classification
    seen_questions = {}
    unique_questions = []
    for r in all_rows:
        q = r.get("question", "")
        if q not in seen_questions:
            seen_questions[q] = len(unique_questions)
            unique_questions.append(q)

    # Start with regex classifications and check persistent cache
    classifications = {}
    ambiguous_indices = []
    
    persistent_cache = load_classification_cache()
    
    for idx, q in enumerate(unique_questions):
        # Find a row with this question to get slug/tags
        row = next((r for r in all_rows if r.get("question") == q), None)
        if row:
            # Check persistent cache first
            if q in persistent_cache:
                classifications[idx] = persistent_cache[q]
                continue
                
            regex_label = row.get("_space_regex", "market")
            classifications[idx] = regex_label
            # If regex says 'market', it might be ambiguous -- flag for OpenAI review
            if regex_label == "market":
                ambiguous_indices.append(idx)

    # Use OpenAI to re-classify ambiguous (regex='market') questions
    if ambiguous_indices and OPENAI_API_KEY:
        ambiguous_qs = [unique_questions[i] for i in ambiguous_indices]
        logger.info(f"[API] Sending {len(ambiguous_qs)} ambiguous markets to OpenAI for classification")
        ai_results = await _classify_markets_openai(ambiguous_qs)
        
        has_new_cached_items = False
        for local_idx, ai_label in ai_results.items():
            if 0 <= local_idx < len(ambiguous_indices):
                global_idx = ambiguous_indices[local_idx]
                q_text = unique_questions[global_idx]
                classifications[global_idx] = ai_label
                persistent_cache[q_text] = ai_label
                has_new_cached_items = True
                
        if has_new_cached_items:
            save_classification_cache(persistent_cache)

    # Build space buckets
    space_map = {"market": 1, "sports": 2, "popculture": 3}
    result: Dict[int, List[Dict[str, Any]]] = {1: [], 2: [], 3: []}

    for r in all_rows:
        q = r.get("question", "")
        q_idx = seen_questions.get(q, -1)
        label = classifications.get(q_idx, "market")
        space_num = space_map.get(label, 1)
        # Clean internal fields before returning
        clean_row = {k: v for k, v in r.items() if not k.startswith("_")}
        result[space_num].append(clean_row)

    counts = {s: len(rows) for s, rows in result.items()}
    logger.info(f"[API] Polymarket classified: space1={counts[1]}, space2={counts[2]}, space3={counts[3]}")

    _polymarket_space_cache.set(result)
    
    # Also update legacy cache with space-1 data
    _polymarket_cache.set(result[1])
    
    return result


# ---------------------------------------------------------------------------
# GET /api/polymarket - Fetch & filter markets (Space-Aware)
# ---------------------------------------------------------------------------
@router.get("/polymarket")
async def api_polymarket(
    space: int = Query(0, description="Space filter: 1=market, 2=sports, 3=popculture, 0=market(legacy)")
) -> Dict[str, Any]:
    """Fetch Polymarket data with space-aware classification."""
    start_time = time.time()
    effective_space = space if space in (1, 2, 3) else 1
    logger.info(f"[API] /api/polymarket called: space={space} (effective={effective_space})")

    try:
        classified = await _get_classified_markets()
        rows = classified.get(effective_space, [])

        log_timing("api_polymarket", start_time, f"(space={effective_space}, {len(rows)} rows)")
        logger.info(f"[API] /api/polymarket completed: space={effective_space}, {len(rows)} results")

        return {"results": rows}

    except Exception as e:
        logger.error(f"[API] Polymarket API Error: {e}")
        # Return cached data if available, even if expired
        stale = _polymarket_cache.get_stale()
        if stale is not None:
            logger.warning("[API] Returning stale Polymarket cache due to error")
            return {"results": stale}
        return {"error": str(e), "results": []}


# ---------------------------------------------------------------------------
# GET /api/polymarket/search - Search/filter markets with ?q= query param
# ---------------------------------------------------------------------------
@router.get("/polymarket/search")
async def api_polymarket_search(
    q: str = Query("", description="Search query for filtering markets"),
    limit: int = Query(15, description="Maximum number of results"),
    space: int = Query(0, description="Space filter: 1=market, 2=sports, 3=popculture, 0=market(legacy)")
) -> Dict[str, Any]:
    """Search Polymarket data with query filter for prediction panels. Space-aware."""
    start_time = time.time()
    logger.info(f"[API] /api/polymarket/search called: q='{q}', limit={limit}, space={space}")

    # Allow custom keywords for sports/popculture aliases without AI
    effective_space = space if space in (1, 2, 3) else 1
    query_lower = q.lower().strip()

    # Apply aliases if user searches globally or implicitly
    sports_aliases = ["sport", "basketball", "football", "baseball", "hockey", "fight", "nba", "nfl", "mlb", "nhl", "ufc"]
    pop_aliases = ["pop", "culture", "music", "movie", "entertainment", "oscar", "grammy", "celeb"]

    if query_lower in sports_aliases:
        effective_space = 2
        query_lower = ""
    elif query_lower in pop_aliases:
        effective_space = 3
        query_lower = ""

    # First, get the base Polymarket data (classified by space)
    base_response = await api_polymarket(space=effective_space)
    all_markets = base_response.get("results", [])

    if not query_lower:
        # No query, return top markets for the space
        results = all_markets[:limit]
        log_timing("api_polymarket_search", start_time, f"(space={effective_space}, no query, {len(results)} results)")
        return {"markets": results}

    # Filter markets by query
    filtered = []
    
    # Exact phrase matched in question
    for market in all_markets:
        question = (market.get("question") or "").lower()
        if query_lower in question:
            filtered.append(market)
            if len(filtered) >= limit:
                break

    # If not enough results, search by word match or outcomes
    if len(filtered) < limit:
        query_words = query_lower.split()
        for market in all_markets:
            if market in filtered:
                continue
            question = (market.get("question") or "").lower()
            outcome = (market.get("outcome") or "").lower()
            
            # Match any word in question or outcome
            if any(word in question or word in outcome for word in query_words):
                filtered.append(market)
                if len(filtered) >= limit:
                    break

    log_timing("api_polymarket_search", start_time, f"(space={effective_space}, query='{q}', {len(filtered)} results)")
    logger.info(f"[API] /api/polymarket/search completed: {len(filtered)} results for '{q}' in space {effective_space}")

    return {"markets": filtered}


# ---------------------------------------------------------------------------
# GET /api/polymarket/batch - Streaming API
# ---------------------------------------------------------------------------

@router.get("/polymarket/batch")
async def api_polymarket_batch(
    space: int = Query(1),
    offset: int = Query(0),
    limit: int = Query(25)
) -> Dict[str, Any]:
    """Fetch a specific page from Polymarket and classify it on the fly, skipping the global cache."""
    start_time = time.time()
    BASE = "https://gamma-api.polymarket.com/markets"
    params = {
        "limit": limit,
        "offset": offset,
        "closed": "false",
        "order": "volume24hr",
        "ascending": "false",
    }
    
    try:
        resp = await api_service.get(BASE, params=params, timeout=10.0)
        resp.raise_for_status()
        page = resp.json()
    except Exception as e:
        logger.error(f"[API] Batch fetch offset={offset} error: {e}")
        raise HTTPException(status_code=500, detail="Upstream error")

    if not page:
        return {"results": [], "next_offset": None, "total": offset}

    rows = []
    unique_questions = []
    seen_questions = {}
    now_utc = datetime.now(timezone.utc)

    for m in page:
        parsed_rows = _parse_polymarket_market(m, now_utc)
        rows.extend(parsed_rows)
        question = (m.get("question") or "").strip()
        if question and question not in seen_questions:
            seen_questions[question] = len(unique_questions)
            unique_questions.append(question)

    classifications = {}
    ambiguous_indices = []
    persistent_cache = load_classification_cache()
    
    for idx, q in enumerate(unique_questions):
        row = next((r for r in rows if r.get("question") == q), None)
        if row:
            if q in persistent_cache:
                classifications[idx] = persistent_cache[q]
                continue
                
            regex_label = row.get("_space_regex", "market")
            classifications[idx] = regex_label
            if regex_label == "market":
                ambiguous_indices.append(idx)

    # Fast inline classification
    if ambiguous_indices and OPENAI_API_KEY:
        ambiguous_qs = [unique_questions[i] for i in ambiguous_indices]
        ai_results = await _classify_markets_openai(ambiguous_qs)
        
        has_new_cached_items = False
        for local_idx, ai_label in ai_results.items():
            if 0 <= local_idx < len(ambiguous_indices):
                global_idx = ambiguous_indices[local_idx]
                q_text = unique_questions[global_idx]
                classifications[global_idx] = ai_label
                persistent_cache[q_text] = ai_label
                has_new_cached_items = True
                
        if has_new_cached_items:
            save_classification_cache(persistent_cache)

    # Build response bucket for the requested space
    space_map = {"market": 1, "sports": 2, "popculture": 3}
    filtered_rows = []

    for r in rows:
        q = r.get("question", "")
        q_idx = seen_questions.get(q, -1)
        label = classifications.get(q_idx, "market")
        space_num = space_map.get(label, 1)
        if space_num == space:
            clean_row = {k: v for k, v in r.items() if not k.startswith("_")}
            filtered_rows.append(clean_row)

    def sort_key(item):
        v = float(item.get("volume24hr") or 0)
        q = item.get("question") or ""
        p = float(item.get("implied_pct") or 0)
        return (-v, q, -p)

    filtered_rows.sort(key=sort_key)
    log_timing("api_polymarket_batch", start_time, f"(space={space}, offset={offset}, returned={len(filtered_rows)})")

    return {
        "results": filtered_rows,
        "next_offset": offset + limit if len(page) == limit else None,
        "count_raw": len(page),
        "count_filtered": len(filtered_rows)
    }

# ---------------------------------------------------------------------------
# POST /api/polymarket/correlations - OpenAI-powered thematic correlations
# ---------------------------------------------------------------------------

class CorrelationRequest(BaseModel):
    markets: List[Dict[str, Any]]
    context_markets: List[Dict[str, Any]] = []


@router.post("/polymarket/correlations")
async def api_polymarket_correlations(req: CorrelationRequest) -> Dict[str, Any]:
    """Use OpenAI to determine thematic correlations between prediction markets."""
    start_time = time.time()
    logger.info(f"[API] /api/polymarket/correlations called with {len(req.markets)} primary, {len(req.context_markets)} context")

    if not req.markets or len(req.markets) < 2:
        return {"correlations": [], "source": "none"}

    # Build cache key from sorted market titles (stable across refreshes)
    cache_key = "|".join(sorted(m.get("title", "")[:30] for m in req.markets))

    # Check cache
    cached = _polymarket_corr_cache.get()
    if cached is not None and cached.get("cache_key") == cache_key:
        logger.info("[API] Polymarket correlations cache HIT")
        log_timing("api_polymarket_correlations (cached)", start_time)
        return {"correlations": cached["correlations"], "source": "cached"}

    if not OPENAI_API_KEY:
        logger.warning("[API] OpenAI API key not available for correlations")
        return {"correlations": [], "source": "no_api_key"}

    # Build prompt with primary nodes
    market_list = "\n".join([
        f'  ID {m["id"]}: "{m.get("fullTitle", m["title"])}" (prob: {m.get("prob", 0.5) * 100:.0f}%, category: {m.get("category", "?")})'
        for m in req.markets
    ])

    # Build context summary from broader pool
    context_summary = ""
    if req.context_markets:
        context_questions = [m.get("question", m.get("title", "")) for m in req.context_markets[:100]]
        context_summary = f"""

BROADER MARKET CONTEXT (for thematic awareness - these are NOT nodes, just context):
The full market pool contains {len(req.context_markets)} additional bets. Here are representative samples:
{chr(10).join('  - ' + q[:90] for q in context_questions[:50])}

Use this context to understand thematic clusters. For example, if the primary nodes include an Iran bet,
and the broader pool has many Middle East/war/diplomacy bets, that Iran node should connect to other
geopolitical nodes. Similarly, if there are many crypto bets in context, connect crypto-related primary nodes together."""

    prompt = f"""You are a quantitative analyst building a prediction market correlation network.
Given these PRIMARY NODES (the top prediction markets by volume), determine thematic connections between them.

PRIMARY NODES (these are the nodes in the network - connect ONLY these IDs):
{market_list}
{context_summary}

RULES FOR CONNECTIONS:
1. **Thematic clustering**: Group by real-world topic. An Iran bet connects to Middle East/war/diplomacy bets.
   A Fed rate bet connects to inflation/recession/economy bets. A crypto bet connects to other crypto/finance bets.
2. **Causal chains**: If outcome A would directly affect outcome B's probability, connect them strongly.
3. **Inverse relationships**: Use negative r for bets that move opposite directions.
4. **Every node MUST have 2-5 connections**. No isolated nodes.
5. **Prefer strong thematic connections** (r > 0.5) over weak generic ones.

CORRELATION SCALE:
- r = 0.7 to 0.95: Strong thematic link (same topic/event, direct causal)
- r = 0.4 to 0.7: Moderate link (same domain, indirect effect)
- r = 0.15 to 0.4: Weak but notable (shared broader theme)
- r = -0.15 to -0.95: Inverse relationship

Return ONLY a JSON object with a "correlations" array of [id_a, id_b, r_value] triples.
Use ONLY the numeric IDs from the PRIMARY NODES above.
Example: {{"correlations": [[0, 3, 0.82], [1, 5, -0.45], [2, 7, 0.33]]}}"""

    try:
        client = openai_service.async_client()

        t0 = time.time()
        resp = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.2,
            max_tokens=8000
        )
        elapsed_ms = int((time.time() - t0) * 1000)
        logger.info(f"[API] OpenAI correlations response in {elapsed_ms}ms")

        content = resp.choices[0].message.content.strip()
        parsed = json.loads(content)
        correlations = parsed.get("correlations", [])

        # Validate: ensure all IDs exist and r values are in range
        valid_ids = {m["id"] for m in req.markets}
        validated = []
        for corr in correlations:
            if (isinstance(corr, list) and len(corr) == 3
                    and corr[0] in valid_ids and corr[1] in valid_ids
                    and corr[0] != corr[1]):
                r = max(-0.95, min(0.95, float(corr[2])))
                if abs(r) >= 0.10:
                    validated.append([corr[0], corr[1], round(r, 2)])

        # Cache the result
        _polymarket_corr_cache.set({
            "cache_key": cache_key,
            "correlations": validated
        })

        log_timing("api_polymarket_correlations", start_time, f"({len(validated)} pairs)")
        logger.info(f"[API] Polymarket correlations: {len(validated)} pairs computed")
        return {"correlations": validated, "source": "openai"}

    except Exception as e:
        logger.error(f"[API] Polymarket correlations error: {e}")
        return {"correlations": [], "source": "error", "error": str(e)}


# ---------------------------------------------------------------------------
# POST /api/polymarket/agent-query - NL-powered network rearrangement
# ---------------------------------------------------------------------------

class AgentQueryRequest(BaseModel):
    query: str
    markets: List[Dict[str, Any]] = []


@router.post("/polymarket/agent-query")
async def api_polymarket_agent_query(req: AgentQueryRequest) -> Dict[str, Any]:
    """Parse a natural language query into structured filter/layout instructions
    for the prediction network visualization."""
    start_time = time.time()
    logger.info(f"[API] /api/polymarket/agent-query called: query='{req.query}', markets={len(req.markets)}")

    query = req.query.strip()
    if not query:
        return {"action": "none", "narrative": "No query provided.", "filter": {}, "layout": "default", "highlightIds": []}

    # --- RESET shortcut (no LLM needed) ---
    reset_words = ["reset", "show all", "clear", "default", "restore"]
    if query.lower() in reset_words:
        log_timing("api_polymarket_agent_query", start_time, "(reset)")
        return {
            "action": "reset",
            "filter": {},
            "layout": "default",
            "narrative": "View reset to default layout.",
            "highlightIds": [],
            "focusMarketId": None
        }

    # --- Build market summary for LLM ---
    market_summary = ""
    if req.markets:
        lines = []
        for m in req.markets[:100]:
            lines.append(
                f"  ID {m.get('id', '?')}: \"{m.get('fullTitle', m.get('title', '?'))}\" "
                f"(prob: {round((m.get('prob', 0.5)) * 100)}%, "
                f"cat: {m.get('category', '?')}, vol: {m.get('volume', '?')})"
            )
        market_summary = "\n".join(lines)

    # --- LLM-powered intent parsing ---
    if OPENAI_API_KEY and req.markets:
        prompt = f"""You are an analyst controlling a prediction market visualization.
The user typed a natural language command to filter/rearrange the network of prediction market nodes.

AVAILABLE MARKETS (nodes in the network):
{market_summary}

AVAILABLE CATEGORIES: ECON, TECH, CRYPTO, SCI, POL

USER COMMAND: "{query}"

Parse their intent into a JSON object with these fields:
{{
  "action": "filter" | "compare" | "focus" | "sort",
  "filter": {{
    "categories": [],
    "minProb": null,
    "maxProb": null,
    "keywords": [],
    "marketIds": [],
    "sortBy": null
  }},
  "layout": "cluster" | "radial" | "split" | "default",
  "focusMarketId": null,
  "narrative": "...",
  "highlightIds": []
}}

LAYOUT RULES:
- "cluster": group matching nodes together at center (default for filter)
- "radial": arrange matching nodes in circle around focusMarketId
- "split": side-by-side comparison (action="compare", e.g. "crypto vs politics")
- "default": return all nodes to original positions

IMPORTANT:
- For "compare" action, split keywords into two groups in the filter
- highlightIds should be the top 3-5 most relevant matches
- narrative should be concise and informative
- If keywords match market titles, include those market IDs in marketIds
- Return ONLY the JSON object, no extra text"""

        try:
            client = openai_service.sync_client()

            t0 = time.time()
            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                max_tokens=2000
            )
            elapsed_ms = int((time.time() - t0) * 1000)
            logger.info(f"[API] Agent query LLM response in {elapsed_ms}ms")

            content = resp.choices[0].message.content.strip()
            parsed = json.loads(content)

            # Validate and normalize the response
            result = {
                "action": parsed.get("action", "filter"),
                "filter": parsed.get("filter", {}),
                "layout": parsed.get("layout", "cluster"),
                "focusMarketId": parsed.get("focusMarketId"),
                "narrative": parsed.get("narrative", ""),
                "highlightIds": parsed.get("highlightIds", []),
                "source": "openai"
            }

            # Validate category names
            valid_cats = {"ECON", "TECH", "CRYPTO", "SCI", "POL"}
            if result["filter"].get("categories"):
                result["filter"]["categories"] = [
                    c for c in result["filter"]["categories"] if c in valid_cats
                ]

            # Validate market IDs
            valid_ids = {m.get("id") for m in req.markets}
            if result.get("highlightIds"):
                result["highlightIds"] = [i for i in result["highlightIds"] if i in valid_ids]
            if result["filter"].get("marketIds"):
                result["filter"]["marketIds"] = [i for i in result["filter"]["marketIds"] if i in valid_ids]

            log_timing("api_polymarket_agent_query", start_time, f"(action={result['action']})")
            return result

        except Exception as e:
            logger.error(f"[API] Agent query LLM error: {e}")
            # Fall through to keyword fallback

    # --- FALLBACK: keyword-based filtering (no LLM) ---
    logger.info("[API] Agent query using keyword fallback")
    query_lower = query.lower()

    # Simple category detection
    cat_map = {
        "crypto": "CRYPTO", "bitcoin": "CRYPTO", "ethereum": "CRYPTO", "btc": "CRYPTO",
        "tech": "TECH", "ai": "TECH", "technology": "TECH",
        "economy": "ECON", "economic": "ECON", "fed": "ECON", "inflation": "ECON", "rate": "ECON",
        "science": "SCI", "climate": "SCI", "health": "SCI",
        "politic": "POL", "politics": "POL", "political": "POL",
        "election": "POL", "president": "POL", "trump": "POL", "congress": "POL"
    }
    detected_cats = []
    cat_trigger_words = set()
    for word, cat in cat_map.items():
        if word in query_lower:
            if cat not in detected_cats:
                detected_cats.append(cat)
            cat_trigger_words.add(word)

    # Extract non-category keywords for title matching
    query_words = re.findall(r'[a-z]+', query_lower)
    stop_words = {"show", "me", "the", "all", "vs", "versus", "compare", "and", "or",
                  "with", "about", "above", "below", "markets", "market", "in", "for"}
    title_keywords = [w for w in query_words if w not in stop_words and w not in cat_trigger_words and len(w) > 2]

    # Probability extraction
    min_prob = None
    max_prob = None
    prob_above = re.search(r'above\s+(\d+)%', query_lower)
    prob_below = re.search(r'below\s+(\d+)%', query_lower)
    if prob_above:
        min_prob = int(prob_above.group(1)) / 100
    if prob_below:
        max_prob = int(prob_below.group(1)) / 100

    # Detect compare intent
    is_compare = " vs " in query_lower or " versus " in query_lower or "compare" in query_lower
    layout = "split" if is_compare and len(detected_cats) >= 2 else "cluster"
    action = "compare" if is_compare else "filter"

    # Find matching market IDs
    matching_ids = []
    if req.markets:
        for m in req.markets:
            title = (m.get("fullTitle") or m.get("title") or "").lower()
            cat = m.get("category", "")
            prob = m.get("prob", 0.5)

            cat_match = not detected_cats or cat in detected_cats
            kw_match = not title_keywords or any(k in title for k in title_keywords)

            prob_match = True
            if min_prob is not None and prob < min_prob:
                prob_match = False
            if max_prob is not None and prob > max_prob:
                prob_match = False

            if cat_match and kw_match and prob_match:
                matching_ids.append(m.get("id"))

    narrative = f"Showing {len(matching_ids)} markets"
    if detected_cats:
        narrative += f" in {', '.join(detected_cats)}"
    if min_prob:
        narrative += f" above {int(min_prob * 100)}%"
    if max_prob:
        narrative += f" below {int(max_prob * 100)}%"
    narrative += "."

    result = {
        "action": action,
        "filter": {
            "categories": detected_cats,
            "minProb": min_prob,
            "maxProb": max_prob,
            "keywords": title_keywords,
            "marketIds": matching_ids,
            "sortBy": None
        },
        "layout": layout,
        "focusMarketId": None,
        "narrative": narrative,
        "highlightIds": matching_ids[:5],
        "source": "fallback"
    }

    log_timing("api_polymarket_agent_query", start_time, f"(fallback, {len(matching_ids)} matches)")
    return result



