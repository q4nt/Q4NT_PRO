"""
Fetch Federal Reserve RSS feeds and return structured news items.
Parses the official Fed press releases and speeches RSS feeds.
"""
import logging
import xml.etree.ElementTree as ET
from typing import List, Dict
from datetime import datetime

import httpx

logger = logging.getLogger(__name__)

# Official Federal Reserve RSS feed URLs
FED_RSS_FEEDS = [
    "https://www.federalreserve.gov/feeds/press_all.xml",
    "https://www.federalreserve.gov/feeds/press_monetary.xml",
]

# HTTP timeout for feed fetches
FEED_TIMEOUT = 10.0


def _parse_rss_items(xml_text: str) -> List[Dict[str, str]]:
    """Parse RSS XML into a list of structured dicts."""
    items: List[Dict[str, str]] = []
    try:
        root = ET.fromstring(xml_text)
        # Handle both RSS 2.0 (<channel><item>) and Atom feeds
        channel = root.find("channel")
        if channel is None:
            # Try Atom namespace
            ns = {"atom": "http://www.w3.org/2005/Atom"}
            for entry in root.findall("atom:entry", ns):
                title = entry.findtext("atom:title", "", ns).strip()
                link_el = entry.find("atom:link", ns)
                link = link_el.get("href", "") if link_el is not None else ""
                summary = entry.findtext("atom:summary", "", ns).strip()
                published = entry.findtext("atom:updated", "", ns).strip()
                if title:
                    items.append({
                        "title": title,
                        "link": link,
                        "summary": summary,
                        "published": published,
                    })
            return items

        for item_el in channel.findall("item"):
            title = (item_el.findtext("title") or "").strip()
            link = (item_el.findtext("link") or "").strip()
            description = (item_el.findtext("description") or "").strip()
            pub_date = (item_el.findtext("pubDate") or "").strip()

            if not title:
                continue

            # Try to normalise pubDate to ISO format
            published_iso = pub_date
            if pub_date:
                for fmt in (
                    "%a, %d %b %Y %H:%M:%S %z",
                    "%a, %d %b %Y %H:%M:%S %Z",
                    "%Y-%m-%dT%H:%M:%S%z",
                ):
                    try:
                        dt = datetime.strptime(pub_date, fmt)
                        published_iso = dt.isoformat()
                        break
                    except ValueError:
                        continue

            items.append({
                "title": title,
                "link": link,
                "summary": description,
                "published": published_iso,
            })
    except ET.ParseError as exc:
        logger.warning("[Fed RSS] XML parse error: %s", exc)
    except Exception as exc:
        logger.warning("[Fed RSS] Unexpected parse error: %s", exc)

    return items


def get_latest_fed_news(limit: int = 5) -> List[Dict[str, str]]:
    """
    Fetch the latest Federal Reserve news items from official RSS feeds.

    Returns a list of dicts, each with keys:
      title, link, summary, published
    """
    all_items: List[Dict[str, str]] = []
    seen_titles: set = set()

    for feed_url in FED_RSS_FEEDS:
        try:
            resp = httpx.get(feed_url, timeout=FEED_TIMEOUT, follow_redirects=True)
            resp.raise_for_status()
            parsed = _parse_rss_items(resp.text)
            for item in parsed:
                # Deduplicate across feeds by title
                key = item["title"].lower()
                if key not in seen_titles:
                    seen_titles.add(key)
                    all_items.append(item)
        except httpx.TimeoutException:
            logger.warning("[Fed RSS] Timeout fetching %s", feed_url)
        except httpx.HTTPStatusError as exc:
            logger.warning("[Fed RSS] HTTP %s from %s", exc.response.status_code, feed_url)
        except Exception as exc:
            logger.warning("[Fed RSS] Error fetching %s: %s", feed_url, exc)

    # Sort by published date descending (most recent first)
    def _sort_key(item):
        try:
            return datetime.fromisoformat(item.get("published", ""))
        except (ValueError, TypeError):
            return datetime.min

    all_items.sort(key=_sort_key, reverse=True)

    logger.info("[Fed RSS] Fetched %d items total, returning %d", len(all_items), min(limit, len(all_items)))
    return all_items[:limit]
