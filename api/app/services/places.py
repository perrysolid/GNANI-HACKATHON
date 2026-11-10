"""Turn a GPS fix into what a person would say on the phone: the place, and the
named landmarks around it ("40 m north: Shani temple"). OpenStreetMap data via
Nominatim (street) and Photon (nearby places)."""

import logging
import math

import httpx

log = logging.getLogger("haanji.places")
UA = {"User-Agent": "Haanji/1.0 (voice assistant; hackathon)"}
DIRS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]


def distance_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def direction(lat1: float, lng1: float, lat2: float, lng2: float) -> str:
    y = math.sin(math.radians(lng2 - lng1)) * math.cos(math.radians(lat2))
    x = math.cos(math.radians(lat1)) * math.sin(math.radians(lat2)) - math.sin(math.radians(lat1)) * math.cos(
        math.radians(lat2)) * math.cos(math.radians(lng2 - lng1))
    return DIRS[round((math.degrees(math.atan2(y, x)) % 360) / 45) % 8]


# Temples, stations, banks and roads are what people give directions by.
RANK = {"place of worship": 0, "hindu temple": 0, "temple": 0, "church": 0, "mosque": 0, "station": 0,
        "metro station": 0, "bus stop": 1, "road": 1, "bank": 1, "atm": 1, "hospital": 1, "school": 1}


async def _google(lat: float, lng: float, key: str) -> dict:
    """Google: street address (Geocoding) and named places within ~250 m (Places API, New)."""
    out: dict = {"place": "", "near": []}
    async with httpx.AsyncClient(timeout=8) as c:
        try:
            r = await c.get("https://maps.googleapis.com/maps/api/geocode/json",
                            params={"latlng": f"{lat},{lng}", "key": key, "language": "en", "region": "in"})
            res = [x for x in r.json().get("results", []) if "plus_code" not in x.get("types", [])]
            if res:
                parts = [p.strip() for p in res[0]["formatted_address"].split(",")]
                parts = [p for i, p in enumerate(parts) if i == 0 or p != parts[i - 1]]  # Google repeats the number
                # Drop "Karnataka 560102" and "India": riders need the street and area.
                out["place"] = ", ".join(p for p in parts if p != "India" and not any(ch.isdigit() for ch in p[-6:]) or p == parts[0])
        except Exception as e:
            log.info("google geocode failed: %s", e)
        try:
            r = await c.post("https://places.googleapis.com/v1/places:searchNearby",
                             headers={"X-Goog-Api-Key": key,
                                      "X-Goog-FieldMask": "places.displayName,places.location,places.primaryTypeDisplayName"},
                             json={"maxResultCount": 20, "rankPreference": "DISTANCE", "languageCode": "en",
                                   "locationRestriction": {"circle": {"center": {"latitude": lat, "longitude": lng}, "radius": 250}}})
            seen, near = set(), []
            for p in r.json().get("places", []):
                name = (p.get("displayName") or {}).get("text", "")
                loc = p.get("location") or {}
                if not name or name in seen or "latitude" not in loc:
                    continue
                seen.add(name)
                kind = ((p.get("primaryTypeDisplayName") or {}).get("text") or "place").lower()
                near.append({"name": name[:60], "kind": kind[:30],
                             "m": round(distance_m(lat, lng, loc["latitude"], loc["longitude"])),
                             "dir": direction(lat, lng, loc["latitude"], loc["longitude"])})
            out["near"] = sorted(near, key=lambda p: (RANK.get(p["kind"], 2), p["m"]))[:6]
        except Exception as e:
            log.info("google nearby failed: %s", e)
    return out


async def describe(lat: float, lng: float) -> dict:
    """{'place': '24th Main Road, HSR Layout, Bengaluru', 'near': [{'name','kind','m','dir'}]}"""
    from ..config import get_settings
    key = get_settings().google_maps_key
    if key:
        g = await _google(lat, lng, key)
        if g["place"] and g["near"]:
            return g
    out: dict = {"place": "", "near": []}
    async with httpx.AsyncClient(timeout=8, headers=UA) as c:
        try:
            r = await c.get("https://nominatim.openstreetmap.org/reverse",
                            params={"format": "jsonv2", "lat": lat, "lon": lng, "zoom": 18, "accept-language": "en"})
            a = r.json().get("address", {})
            road = " ".join(x for x in (a.get("house_number"), a.get("road")) if x)
            out["place"] = ", ".join(x for x in (a.get("amenity") or a.get("building") or a.get("shop"), road,
                                                 a.get("neighbourhood") or a.get("suburb"),
                                                 a.get("city") or a.get("town")) if x)
        except Exception as e:
            log.info("reverse geocode failed: %s", e)
        try:
            r = await c.get("https://photon.komoot.io/reverse",
                            params={"lat": lat, "lon": lng, "limit": 20, "radius": 0.2, "lang": "en"})
            seen, near = set(), []
            for f in r.json().get("features", []):
                p = f.get("properties", {})
                name, key, kind = p.get("name"), p.get("osm_key", ""), p.get("osm_value", "")
                if not name or name in seen or key in ("landuse", "boundary", "place") or kind == "yes":
                    continue
                seen.add(name)
                plng, plat = f["geometry"]["coordinates"]
                near.append({"name": name[:60], "kind": ("road" if key == "highway" else kind.replace("_", " "))[:30],
                             "m": round(distance_m(lat, lng, plat, plng)), "dir": direction(lat, lng, plat, plng)})
            out["near"] = sorted(near, key=lambda p: (RANK.get(p["kind"], 2), p["m"]))[:6]
        except Exception as e:
            log.info("nearby lookup failed: %s", e)
    return out
