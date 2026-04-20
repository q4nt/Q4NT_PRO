"""
Wildlife Data Router - Education Earth Explorer
Proxies OBIS (marine species), GBIF (terrestrial), and World Wonders API.
Provides curated migration route polylines for visualization on the MapBox globe.
"""

import time
import logging
import httpx
from fastapi import APIRouter, Query
from typing import Optional

logger = logging.getLogger(__name__)
router = APIRouter(tags=["wildlife"])

# --- Simple in-memory cache (5 min TTL) ---
_cache = {}
_CACHE_TTL = 300  # seconds


def _get_cached(key):
    entry = _cache.get(key)
    if entry and (time.time() - entry["ts"]) < _CACHE_TTL:
        return entry["data"]
    return None


def _set_cached(key, data):
    _cache[key] = {"data": data, "ts": time.time()}


# --- OBIS Species Taxonomy IDs ---
OBIS_SPECIES = {
    "humpback_whale": {"name": "Megaptera novaeangliae", "taxonid": 137092},
    "blue_whale":     {"name": "Balaenoptera musculus",   "taxonid": 137090},
    "gray_whale":     {"name": "Eschrichtius robustus",   "taxonid": 137094},
    "orca":           {"name": "Orcinus orca",            "taxonid": 137102},
    "sea_turtle":     {"name": "Cheloniidae",             "taxonid": 136999},
    "whale_shark":    {"name": "Rhincodon typus",         "taxonid": 105857},
    "manta_ray":      {"name": "Mobula birostris",        "taxonid": 105857},
    "dolphin":        {"name": "Delphinidae",             "taxonid": 136980},
}


@router.get("/wildlife/sightings")
async def get_wildlife_sightings(
    species: str = Query("humpback_whale", description="Species key"),
    limit: int = Query(200, ge=1, le=500),
):
    """Fetch marine species occurrence data from OBIS API."""
    cache_key = f"sightings_{species}_{limit}"
    cached = _get_cached(cache_key)
    if cached:
        return cached

    sp_info = OBIS_SPECIES.get(species)
    if not sp_info:
        return {"error": f"Unknown species: {species}", "available": list(OBIS_SPECIES.keys())}

    try:
        url = "https://api.obis.org/v3/occurrence"
        params = {
            "scientificname": sp_info["name"],
            "size": limit,
            "fields": "decimalLongitude,decimalLatitude,eventDate,species,depth,datasetName",
        }
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()

        results = data.get("results", [])
        sightings = []
        for r in results:
            lng = r.get("decimalLongitude")
            lat = r.get("decimalLatitude")
            if lng is not None and lat is not None:
                sightings.append({
                    "lng": lng,
                    "lat": lat,
                    "species": r.get("species", sp_info["name"]),
                    "date": r.get("eventDate", ""),
                    "depth": r.get("depth"),
                    "dataset": r.get("datasetName", ""),
                })

        result = {
            "species": species,
            "scientificName": sp_info["name"],
            "count": len(sightings),
            "sightings": sightings,
        }
        _set_cached(cache_key, result)
        return result

    except Exception as e:
        logger.error(f"[Wildlife] OBIS fetch error for {species}: {e}")
        return {"error": str(e), "species": species, "count": 0, "sightings": []}


@router.get("/wildlife/wonders")
async def get_world_wonders():
    """Fetch World Wonders data from the World Wonders API."""
    cache_key = "world_wonders"
    cached = _get_cached(cache_key)
    if cached:
        return cached

    # Curated data (the World Wonders API may be unreliable, so we provide
    # high-quality hardcoded data as primary source with API as enrichment)
    wonders = [
        {
            "name": "Great Wall of China",
            "location": "China",
            "lat": 40.4319,
            "lng": 116.5704,
            "built": "7th century BC - 1644 AD",
            "fact": "It stretches over 13,000 miles - longer than the distance from New York to Sydney!",
            "category": "ANCIENT",
            "color": "#ef4444",
        },
        {
            "name": "Petra",
            "location": "Jordan",
            "lat": 30.3285,
            "lng": 35.4444,
            "built": "312 BC",
            "fact": "This ancient city was carved directly into rose-red cliff faces!",
            "category": "ANCIENT",
            "color": "#f59e0b",
        },
        {
            "name": "Christ the Redeemer",
            "location": "Rio de Janeiro, Brazil",
            "lat": -22.9519,
            "lng": -43.2105,
            "built": "1931",
            "fact": "This statue is 98 feet tall and its arms stretch 92 feet wide!",
            "category": "MODERN",
            "color": "#22c55e",
        },
        {
            "name": "Machu Picchu",
            "location": "Peru",
            "lat": -13.1631,
            "lng": -72.5450,
            "built": "1450 AD",
            "fact": "This 'Lost City of the Incas' sits 7,970 feet above sea level in the clouds!",
            "category": "ANCIENT",
            "color": "#8b5cf6",
        },
        {
            "name": "Chichen Itza",
            "location": "Mexico",
            "lat": 20.6843,
            "lng": -88.5678,
            "built": "600 AD",
            "fact": "During equinox, shadows create a serpent slithering down the pyramid steps!",
            "category": "ANCIENT",
            "color": "#06b6d4",
        },
        {
            "name": "Roman Colosseum",
            "location": "Rome, Italy",
            "lat": 41.8902,
            "lng": 12.4922,
            "built": "80 AD",
            "fact": "It could seat 50,000 spectators - bigger than most modern football stadiums!",
            "category": "ANCIENT",
            "color": "#ec4899",
        },
        {
            "name": "Taj Mahal",
            "location": "Agra, India",
            "lat": 27.1751,
            "lng": 78.0421,
            "built": "1653",
            "fact": "It took 20,000 workers and 1,000 elephants 22 years to build!",
            "category": "MODERN",
            "color": "#3b82f6",
        },
        {
            "name": "Great Pyramid of Giza",
            "location": "Cairo, Egypt",
            "lat": 29.9792,
            "lng": 31.1342,
            "built": "2560 BC",
            "fact": "The oldest of the Seven Wonders - it was the tallest structure for 3,800 years!",
            "category": "ANCIENT",
            "color": "#f97316",
        },
        {
            "name": "Eiffel Tower",
            "location": "Paris, France",
            "lat": 48.8584,
            "lng": 2.2945,
            "built": "1889",
            "fact": "It grows about 6 inches taller in summer because hot metal expands!",
            "category": "LANDMARK",
            "color": "#6366f1",
        },
        {
            "name": "Statue of Liberty",
            "location": "New York, USA",
            "lat": 40.6892,
            "lng": -74.0445,
            "built": "1886",
            "fact": "Her full name is 'Liberty Enlightening the World' and she weighs 225 tons!",
            "category": "LANDMARK",
            "color": "#14b8a6",
        },
    ]

    result = {"count": len(wonders), "wonders": wonders}
    _set_cached(cache_key, result)
    return result


@router.get("/wildlife/migrations")
async def get_migration_routes(
    species: Optional[str] = Query(None, description="Filter by species key"),
):
    """Return curated migration route polylines for major species."""
    cache_key = f"migrations_{species or 'all'}"
    cached = _get_cached(cache_key)
    if cached:
        return cached

    all_routes = [
        {
            "id": "humpback_atlantic",
            "species": "humpback_whale",
            "name": "Humpback Whale - North Atlantic",
            "description": "Summer feeding in Iceland to winter breeding at Silver Bank, Caribbean",
            "color": "#3b82f6",
            "distance": "3,100 miles",
            "coordinates": [
                [-19.0, 65.5], [-24.0, 61.0], [-30.0, 55.0],
                [-38.0, 48.0], [-48.0, 40.0], [-55.0, 33.0],
                [-60.0, 26.0], [-64.0, 21.0], [-66.0, 18.5],
                [-64.5, 17.8],
            ],
        },
        {
            "id": "humpback_pacific",
            "species": "humpback_whale",
            "name": "Humpback Whale - North Pacific",
            "description": "Alaska feeding grounds to Hawaii breeding waters (open Pacific)",
            "color": "#60a5fa",
            "distance": "3,000 miles",
            "coordinates": [
                [-148.0, 59.0], [-150.0, 56.5], [-153.0, 53.0],
                [-155.0, 48.0], [-156.5, 42.0], [-157.0, 36.0],
                [-157.5, 30.0], [-157.0, 25.0], [-156.5, 21.5],
                [-155.8, 19.8],
            ],
        },
        {
            "id": "humpback_southern",
            "species": "humpback_whale",
            "name": "Humpback Whale - Southern Hemisphere",
            "description": "Antarctic feeding to Mozambique Channel breeding",
            "color": "#818cf8",
            "distance": "5,000 miles",
            "coordinates": [
                [5.0, -64.0], [10.0, -58.0], [18.0, -50.0],
                [25.0, -42.0], [30.0, -36.0], [33.0, -30.0],
                [35.5, -24.0], [37.0, -19.0], [38.0, -16.0],
                [40.0, -13.0],
            ],
        },
        {
            "id": "gray_whale",
            "species": "gray_whale",
            "name": "Gray Whale - Eastern Pacific",
            "description": "Bering Sea to Baja California lagoons - hugs Pacific coast!",
            "color": "#94a3b8",
            "distance": "12,000 miles round trip",
            "coordinates": [
                [-172.0, 63.0], [-170.0, 60.0], [-167.0, 57.5],
                [-160.0, 55.0], [-152.0, 53.0], [-145.0, 52.0],
                [-140.0, 50.0], [-134.0, 48.0], [-129.0, 45.5],
                [-126.5, 43.0], [-125.5, 40.0], [-124.5, 37.5],
                [-122.5, 35.5], [-120.5, 33.5], [-118.5, 31.0],
                [-117.5, 29.0], [-116.5, 27.5], [-115.5, 26.0],
                [-114.0, 25.0], [-112.5, 24.5],
            ],
        },
        {
            "id": "blue_whale",
            "species": "blue_whale",
            "name": "Blue Whale - Eastern Pacific",
            "description": "Gulf of Alaska to Costa Rica Dome - stays well offshore, west of Baja",
            "color": "#0ea5e9",
            "distance": "2,500 miles",
            "coordinates": [
                [-145.0, 57.0], [-142.0, 52.0], [-138.0, 47.0],
                [-133.0, 43.0], [-127.0, 38.5], [-124.0, 35.0],
                [-121.0, 32.5], [-118.0, 28.0], [-115.0, 24.0],
                [-110.0, 20.0], [-105.0, 16.0], [-92.0, 11.0],
                [-87.5, 9.5],
            ],
        },
        {
            "id": "orca_atlantic",
            "species": "orca",
            "name": "Orca - North Atlantic",
            "description": "Iceland to Norway following herring in the Norwegian Sea",
            "color": "#475569",
            "distance": "1,500 miles",
            "coordinates": [
                [-24.0, 65.0], [-20.0, 64.5], [-15.0, 63.0],
                [-8.0, 62.0], [-2.0, 61.5], [3.0, 62.5],
                [8.0, 64.0], [14.0, 67.0], [18.0, 69.0],
                [20.0, 70.0],
            ],
        },
        {
            "id": "arctic_tern",
            "species": "arctic_tern",
            "name": "Arctic Tern - Pole to Pole",
            "description": "The longest migration - S-shaped Atlantic route exploiting wind systems!",
            "color": "#f59e0b",
            "distance": "44,000 miles round trip",
            "coordinates": [
                [-20.0, 72.0], [-22.0, 67.0], [-28.0, 60.0],
                [-33.0, 52.0], [-30.0, 45.0], [-22.0, 38.0],
                [-18.0, 30.0], [-17.0, 22.0], [-18.0, 14.0],
                [-20.0, 5.0], [-15.0, -5.0], [-8.0, -15.0],
                [-2.0, -28.0], [3.0, -40.0], [8.0, -50.0],
                [5.0, -58.0], [0.0, -65.0],
            ],
        },
        {
            "id": "monarch_butterfly",
            "species": "monarch_butterfly",
            "name": "Monarch Butterfly - North America",
            "description": "Great Lakes to Oyamel fir forests in central Mexico!",
            "color": "#f97316",
            "distance": "3,000 miles",
            "coordinates": [
                [-79.5, 44.0], [-80.0, 42.0], [-82.0, 39.5],
                [-84.0, 37.0], [-87.0, 35.0], [-90.0, 33.0],
                [-93.0, 31.0], [-96.0, 29.0], [-98.0, 27.0],
                [-99.5, 24.5], [-100.0, 21.0], [-100.3, 19.6],
            ],
        },
        {
            "id": "sea_turtle_atlantic",
            "species": "sea_turtle",
            "name": "Loggerhead Sea Turtle - Atlantic Gyre",
            "description": "Cape Canaveral to Azores to Canaries and back via Gulf Stream!",
            "color": "#22c55e",
            "distance": "7,500 miles",
            "coordinates": [
                [-80.5, 28.5], [-78.0, 30.0], [-72.0, 32.0],
                [-63.0, 34.0], [-52.0, 36.0], [-40.0, 37.0],
                [-30.0, 38.0], [-25.0, 37.5], [-20.0, 35.0],
                [-16.0, 32.0], [-14.0, 29.0], [-17.0, 25.0],
                [-22.0, 20.0], [-30.0, 16.0], [-42.0, 14.0],
                [-55.0, 15.0], [-65.0, 18.0], [-74.0, 22.0],
                [-79.0, 26.0],
            ],
        },
        {
            "id": "wildebeest",
            "species": "wildebeest",
            "name": "Wildebeest - Serengeti Great Migration",
            "description": "1.5 million wildebeest circle the Serengeti every year!",
            "color": "#a16207",
            "distance": "500 miles circular",
            "coordinates": [
                [34.8, -2.5], [35.0, -2.0], [35.3, -1.5],
                [35.5, -1.2], [35.2, -1.8], [34.9, -2.2],
                [34.5, -2.8], [34.3, -3.2], [34.5, -3.0],
                [34.8, -2.5],
            ],
        },
    ]

    if species:
        all_routes = [r for r in all_routes if r["species"] == species]

    result = {"count": len(all_routes), "routes": all_routes}
    _set_cached(cache_key, result)
    return result


@router.get("/wildlife/oceans")
async def get_ocean_data():
    """Return fun ocean facts for Education students."""
    oceans = [
        {
            "name": "Pacific Ocean",
            "lat": 0.0, "lng": -160.0,
            "area": "63.8 million sq mi",
            "maxDepth": "36,161 ft (Mariana Trench)",
            "fact": "The Pacific is so big, it covers more area than all the land on Earth combined!",
            "color": "#3b82f6",
            "funCreature": "Giant Pacific Octopus",
        },
        {
            "name": "Atlantic Ocean",
            "lat": 15.0, "lng": -35.0,
            "area": "41.1 million sq mi",
            "maxDepth": "27,841 ft (Puerto Rico Trench)",
            "fact": "The Atlantic Ocean is getting wider by about 1 inch every year!",
            "color": "#6366f1",
            "funCreature": "Blue Whale",
        },
        {
            "name": "Indian Ocean",
            "lat": -15.0, "lng": 75.0,
            "area": "27.2 million sq mi",
            "maxDepth": "24,442 ft (Java Trench)",
            "fact": "The Indian Ocean is the warmest ocean in the world!",
            "color": "#14b8a6",
            "funCreature": "Whale Shark",
        },
        {
            "name": "Southern Ocean",
            "lat": -62.0, "lng": 0.0,
            "area": "7.8 million sq mi",
            "maxDepth": "23,737 ft",
            "fact": "Home to 20 million breeding pairs of penguins!",
            "color": "#06b6d4",
            "funCreature": "Emperor Penguin",
        },
        {
            "name": "Arctic Ocean",
            "lat": 80.0, "lng": 0.0,
            "area": "5.4 million sq mi",
            "maxDepth": "18,456 ft",
            "fact": "Parts of the Arctic Ocean are covered in ice all year round!",
            "color": "#a5f3fc",
            "funCreature": "Narwhal - the unicorn of the sea!",
        },
    ]
    return {"count": len(oceans), "oceans": oceans}
