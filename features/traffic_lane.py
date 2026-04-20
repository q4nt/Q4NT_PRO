"""
Traffic Analysis Lane - Cloudflare Internet Traffic
====================================================
Handles queries about:
- Global internet traffic trends
- Country-level network flows
- Traffic anomalies and disruptions

Data Sources:
- Cloudflare Radar API (cloudflare_traffic_api.py)
"""

import logging
import time
import sys
import os
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass

# Add scripts directory to path for Cloudflare module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))

try:
    from cloudflare_traffic_api import fetch_netflows_timeseries, make_summary_table, verify_token
except ImportError:
    fetch_netflows_timeseries = None
    make_summary_table = None
    verify_token = None

logger = logging.getLogger("lanes.traffic")


# =============================================================================
# CONFIGURATION
# =============================================================================

# Keywords that trigger this lane
TRIGGER_KEYWORDS = [
    "internet traffic", "cloudflare", "network flow", "netflow",
    "traffic trend", "internet in", "connectivity", "outage",
    "iran traffic", "china traffic", "us traffic",
]

# Country code mappings
COUNTRY_ALIASES = {
    "iran": "IR",
    "united states": "US",
    "usa": "US",
    "us": "US",
    "china": "CN",
    "uk": "GB",
    "united kingdom": "GB",
    "germany": "DE",
    "france": "FR",
    "japan": "JP",
    "india": "IN",
    "russia": "RU",
    "brazil": "BR",
    "canada": "CA",
    "australia": "AU",
}


# =============================================================================
# LANE HANDLER
# =============================================================================

@dataclass
class TrafficResult:
    """Result from traffic analysis query."""
    countries: List[str]
    timeseries: List[Dict[str, Any]]
    summary: Dict[str, Any]
    query_time_ms: float
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "countries": self.countries,
            "timeseries": self.timeseries,
            "summary": self.summary,
            "query_time_ms": self.query_time_ms,
            "data_points": len(self.timeseries),
        }
    
    def to_globe_command(self) -> Dict[str, Any]:
        """Generate globe heatmap command for traffic data."""
        # This would create a heatmap overlay on the globe
        # For now, return country highlights
        commands = []
        
        for country in self.countries:
            commands.append({
                "action": "highlight",
                "type": "country",
                "data": {
                    "country_code": country,
                    "color": "#3b82f6",
                    "opacity": 0.6,
                }
            })
        
        return {"commands": commands}


def handle_traffic(
    query: str,
    countries: Optional[List[str]] = None,
    date_range: str = "7d",
) -> TrafficResult:
    """
    Handle a traffic analysis query.
    
    Args:
        query: The user's question about internet traffic
        countries: List of country codes (ISO alpha-2), or None to extract from query
        date_range: Time range for data (1d, 7d, 30d)
    
    Returns:
        TrafficResult with timeseries and summary data
    """
    start_time = time.time()
    
    # Extract countries from query if not provided
    if countries is None:
        countries = _extract_countries(query)
    
    if not countries:
        countries = ["US"]  # Default to US
    
    timeseries = []
    summary = {}
    
    if fetch_netflows_timeseries is not None:
        try:
            # Fetch Cloudflare data
            df, meta = fetch_netflows_timeseries(countries)
            
            # Convert to list of dicts
            if not df.empty:
                timeseries = df.to_dict("records")
                
                # Generate summary
                if make_summary_table is not None:
                    summary_df = make_summary_table(df)
                    summary = summary_df.to_dict("records")
                    
        except Exception as e:
            logger.error(f"[Traffic] Cloudflare error: {e}")
    else:
        logger.warning("[Traffic] Cloudflare module not available")
    
    elapsed = (time.time() - start_time) * 1000
    
    logger.info(f"[Traffic] Query completed: {len(timeseries)} points for {countries} in {elapsed:.0f}ms")
    
    return TrafficResult(
        countries=countries,
        timeseries=timeseries,
        summary=summary,
        query_time_ms=elapsed,
    )


def _extract_countries(query: str) -> List[str]:
    """Extract country codes from query text."""
    query_lower = query.lower()
    countries = []
    
    # Check for country aliases
    for alias, code in COUNTRY_ALIASES.items():
        if alias in query_lower:
            if code not in countries:
                countries.append(code)
    
    # Check for direct country codes
    import re
    codes = re.findall(r'\b([A-Z]{2})\b', query.upper())
    for code in codes:
        if code in COUNTRY_ALIASES.values() and code not in countries:
            countries.append(code)
    
    return countries


def matches_lane(query: str) -> bool:
    """Check if a query should be routed to this lane."""
    query_lower = query.lower()
    return any(kw in query_lower for kw in TRIGGER_KEYWORDS)

