"""NASA OPERA surface water seen by satellite (DSWx), for floods (brief 5 decision 2; PLAN-5 3.7, D6, D25; CONTRACT 16.5).

Three routes, in this order:

1. **Default, no login: NASA Earthdata GIS** ``OPERA_L3_DSWX-HLS_V1_B01_WTR/ImageServer`` (measured DSWx-HLS water classes
   0 not water, 1 open water, 2 partial water, 252 snow/ice, 253 cloud, 254 ocean, 255 no data, at 30 m).
   :func:`egis_granules` lists the granules over an area in a time window (the service's own time metadata is stale;
   its catalog rows are not), :func:`group_passes` joins the tiles of one satellite pass, and :func:`egis_export`
   reads the raw classes of **one locked pass** (``esriMosaicLockRaster``, so the image time is exact;
   ``rasterFunction: None``; nearest neighbour) on a lon/lat or UTM grid. Search cached 6 h, images 30 days (a granule
   never changes).
2. **With ``EARTHDATA_TOKEN``: PO.DAAC** (CMR search, which needs no login, then the ``B01_WTR`` GeoTIFF from
   ``archive.podaac.earthdata.nasa.gov`` with ``Authorization: Bearer``): DSWx-S1 (radar, sees through clouds) and the
   newest DSWx-HLS day. The token is read from ``config.EARTHDATA_TOKEN`` only, sent only to the allow-listed PO.DAAC
   host (``fire3d.http.check_auth_headers``), never in a URL, a cache key, a log record, an error or a file. PO.DAAC
   redirects to a pre-signed S3 address, which httpx follows **without** the header; ``X-Amz-*`` values are masked in
   every log line (``config.mask_secrets``). A 401 / 403, or an answer that is not a GeoTIFF (a redirect back to the
   ``urs.earthdata.nasa.gov`` login page), means the login was **refused** (:data:`LOGIN`); the default route still
   works. Files are cached under ``CACHE_DIR/opera/`` by granule id. The GeoTIFF reader is injectable
   (:data:`READER`) for tests; no GDAL ``/vsicurl/`` auth (it would bypass the masking).
3. **Picture fallback: NASA GIBS** WMTS ``OPERA_L3_Dynamic_Surface_Water_Extent-HLS`` (daily, z <= 12): a picture, not
   a measurement (:func:`gibs_latest`).

Every request goes through :mod:`fire3d.http` with its own limiter; errors raise ``nws.SourceError`` (``SourceBusy`` for
Fire-3d's own limit) with secret-free text; :class:`LoginRefused` for a refused token.
"""

from __future__ import annotations

import logging
import math
import re
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable

import numpy as np
import orjson
from shapely.geometry import box, shape

from .. import config
from .. import http as fhttp
from .nws import SourceBusy, SourceError

log = logging.getLogger(__name__)

BBox = tuple[float, float, float, float]

EGIS_HLS = ("https://gis.earthdata.nasa.gov/portal/rest/services/C2617126679-POCLOUD/"
            "OPERA_L3_DSWX-HLS_V1_B01_WTR/ImageServer")
EGIS_HOST = "gis.earthdata.nasa.gov"
CMR_GRANULES = "https://cmr.earthdata.nasa.gov/search/granules.json"
CMR_HOST = "cmr.earthdata.nasa.gov"
PODAAC_HOST = "archive.podaac.earthdata.nasa.gov"
URS_HOST = "urs.earthdata.nasa.gov"
GIBS_ROOT = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best"
GIBS_HOST = "gibs.earthdata.nasa.gov"
GIBS_HLS_LAYER = "OPERA_L3_Dynamic_Surface_Water_Extent-HLS"
GIBS_S1_LAYER = "OPERA_L3_Dynamic_Surface_Water_Extent-Sentinel-1"
GIBS_MATRIX = "GoogleMapsCompatible_Level12"
GIBS_MAX_ZOOM = 12
HLS_SHORT_NAME = "OPERA_L3_DSWX-HLS_V1"
S1_SHORT_NAME = "OPERA_L3_DSWX-S1_V1"
HLS_COLLECTION = "C2617126679-POCLOUD"
S1_COLLECTION = "C2949811996-POCLOUD"
EGIS_ARCHIVE_START_MS = int(datetime(2023, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)

SEARCH_DAYS = 10
SEARCH_TTL_S = 6 * 3600.0
SEARCH_TTL_PAST_S = 30 * 86400.0
IMAGE_TTL_S = 30 * 86400.0
GIBS_TTL_S = 1800.0
TIMEOUT_S = 60.0
RETRIES = 1
EXPORT_MAX_PX = 2048                 # the image service's maxImageWidth / maxImageHeight
REFUSED_HOLD_S = 600.0               # a refused login is not tried again for 10 min

CLASSES = (0, 1, 2, 252, 253, 254, 255)
NOT_WATER, OPEN_WATER, PARTIAL_WATER, SNOW_ICE, CLOUD, OCEAN, NO_DATA = CLASSES

EGIS_LIMITER = fhttp.RateLimiter(30, 60.0, "floods: NASA Earthdata GIS")
CMR_LIMITER = fhttp.RateLimiter(30, 60.0, "floods: NASA CMR")
PODAAC_LIMITER = fhttp.RateLimiter(20, 60.0, "floods: NASA PO.DAAC")
GIBS_LIMITER = fhttp.RateLimiter(30, 60.0, "floods: NASA GIBS")
EGIS_DOWN = fhttp.DownMemo("floods: NASA Earthdata GIS")
_EGIS_NAME = "NASA Earthdata GIS (OPERA water)"
_CMR_NAME = "NASA's data catalogue (CMR)"
_PODAAC_NAME = "NASA PO.DAAC"
_GIBS_NAME = "NASA GIBS"

_NAME_RE = re.compile(r"OPERA_L3_DSWx-(HLS|S1)_(T\w{5})_(\d{8}T\d{6}Z)_(\d{8}T\d{6}Z)_([A-Z0-9]+)_")
_PLATFORMS = {"L8": "Landsat 8", "L9": "Landsat 9", "S2A": "Sentinel-2A", "S2B": "Sentinel-2B", "S2C": "Sentinel-2C",
              "S1A": "Sentinel-1A", "S1B": "Sentinel-1B", "S1C": "Sentinel-1C", "S1D": "Sentinel-1D"}


class LoginRefused(SourceError):
    """PO.DAAC refused the NASA Earthdata login (401 / 403, or a redirect back to the login page)."""


# ----------------------------------------------------------------------------------------------------------------
# Login state (never the token)
# ----------------------------------------------------------------------------------------------------------------
_login_lock = threading.Lock()
_refused_until = 0.0


def token() -> str | None:
    """The NASA Earthdata user token from the environment or ``.env`` (``config.EARTHDATA_TOKEN``), or None."""
    t = getattr(config, "EARTHDATA_TOKEN", None)
    return t.strip() if isinstance(t, str) and t.strip() else None


def login_state() -> str:
    """``not_configured`` (no token), ``refused`` (PO.DAAC refused it less than 10 min ago) or ``configured``."""
    if token() is None:
        return "not_configured"
    with _login_lock:
        return "refused" if time.monotonic() < _refused_until else "configured"


def mark_refused() -> None:
    global _refused_until
    with _login_lock:
        _refused_until = time.monotonic() + REFUSED_HOLD_S


def reset_state() -> None:
    """Forget the refused login and outage memories (tests)."""
    global _refused_until
    with _login_lock:
        _refused_until = 0.0
    EGIS_DOWN.reset()


# ----------------------------------------------------------------------------------------------------------------
# Granules and passes
# ----------------------------------------------------------------------------------------------------------------
def _ms_of(token_: str) -> int | None:
    try:
        return int(datetime.strptime(token_, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc).timestamp() * 1000)
    except ValueError:
        return None


@dataclass
class Granule:
    """One DSWx tile of one satellite pass."""

    id: str                          # "OPERA_L3_DSWx-HLS_T15TUE_20261029T170629Z_20261031T145515Z_L8_30_v1.1"
    product: str                     # "DSWx-HLS" | "DSWx-S1"
    tile: str | None
    acquired_ms: int                 # sensing time (from the name; the image time shown)
    produced_ms: int | None
    sensor: str | None               # "L8", "S2B", "S1D"
    route: str                       # "earthdata_gis" | "podaac"
    oid: int | None = None           # Earthdata GIS raster object id (locks the mosaic)
    data_url: str | None = None      # PO.DAAC B01_WTR GeoTIFF (protected)
    footprint: Any = None            # shapely, lon/lat
    tile_cloud_pct: float | None = None

    @property
    def platform(self) -> str | None:
        return _PLATFORMS.get(self.sensor or "", self.sensor)

    @property
    def page_url(self) -> str:
        coll = HLS_COLLECTION if self.product == "DSWx-HLS" else S1_COLLECTION
        return f"https://search.earthdata.nasa.gov/search/granules?p={coll}&q={self.id}"


def parse_name(name: str) -> dict | None:
    """Product, tile, sensing and production times and sensor from an OPERA DSWx granule name."""
    m = _NAME_RE.search(name or "")
    if not m:
        return None
    acq = _ms_of(m.group(3))
    if acq is None:
        return None
    return {"product": f"DSWx-{m.group(1)}", "tile": m.group(2), "acquired_ms": acq, "produced_ms": _ms_of(m.group(4)),
            "sensor": m.group(5)}


def _granule_id(name: str) -> str:
    return re.sub(r"_B0\d_[A-Z-]+(\.tif)?$", "", str(name))


def _esri_rings(geom: Any) -> Any:
    if not isinstance(geom, dict):
        return None
    try:
        if "rings" in geom:
            from shapely.geometry import Polygon
            from shapely.ops import unary_union

            return unary_union([Polygon(r).buffer(0) for r in geom["rings"] if len(r) >= 3])
        return shape(geom).buffer(0)
    except (ValueError, TypeError, AttributeError):
        return None


@dataclass
class Pass:
    """The tiles of one satellite pass over an area (one sensing time and sensor)."""

    key: str                          # URL-safe: "DSWx-HLS_20261029T170629Z_L8"
    product: str
    sensor: str | None
    acquired_ms: int
    granules: list[Granule] = field(default_factory=list)

    @property
    def route(self) -> str:
        return self.granules[0].route if self.granules else "earthdata_gis"

    @property
    def oids(self) -> list[int]:
        return [g.oid for g in self.granules if g.oid is not None]

    def footprint(self) -> Any:
        from shapely.ops import unary_union

        parts = [g.footprint for g in self.granules if g.footprint is not None and not g.footprint.is_empty]
        return unary_union(parts) if parts else None


def group_passes(granules: Iterable[Granule]) -> list[Pass]:
    """Tiles of one pass share the product, the sensor and the sensing time (to the minute): newest pass first."""
    out: dict[str, Pass] = {}
    for g in granules:
        stamp = datetime.fromtimestamp(g.acquired_ms / 1000, tz=timezone.utc).strftime("%Y%m%dT%H%M")
        key = f"{g.product}_{stamp}_{g.sensor or 'X'}"
        p = out.setdefault(key, Pass(key, g.product, g.sensor, g.acquired_ms))
        if all(x.id != g.id for x in p.granules):
            p.granules.append(g)
            p.acquired_ms = min(p.acquired_ms, g.acquired_ms)
    return sorted(out.values(), key=lambda p: (-p.acquired_ms, p.key))


# ----------------------------------------------------------------------------------------------------------------
# Requests
# ----------------------------------------------------------------------------------------------------------------
def _request(url: str, params: Any, *, ttl_s: float, limiter: fhttp.RateLimiter, name: str,
             down: fhttp.DownMemo | None = None, host: str = "", expect_json: bool = True,
             timeout: float = TIMEOUT_S) -> fhttp.Response:
    hit = fhttp.peek_cache("GET", url, params, ttl_s)
    if hit is not None:
        return hit
    if down is not None and down.down(host):
        raise SourceError(f"{name} could not be reached (it failed less than a minute ago)")
    if not limiter.try_acquire():
        raise SourceBusy(f"{name}: Fire-3d's request limit is reached; try again in a minute")
    try:
        resp = fhttp.request("GET", url, params=params, ttl_s=ttl_s, timeout=timeout, retries=RETRIES,
                             expect_json=expect_json)
    except fhttp.HttpError as e:
        if down is not None and (e.status is None or e.status >= 500 or e.status == 429):
            down.mark(host)
        code = f"HTTP {e.status}" if e.status is not None else "no response"
        raise SourceError(f"{name} could not be reached ({code})", e.status) from None
    except Exception as e:  # noqa: BLE001 - any transport failure: unreachable
        if down is not None:
            down.mark(host)
        log.warning("%s: %s", name, config.mask_secrets(f"{type(e).__name__}: {e}"))
        raise SourceError(f"{name} could not be reached (no response)") from None
    if down is not None:
        down.clear(host)
    return resp


def search_window(end_ms: int, days: int = SEARCH_DAYS) -> tuple[int, int]:
    """(start, end) of a search window ending at ``end_ms``, quantised to the hour for cache hits."""
    end = (int(end_ms) // 3_600_000 + 1) * 3_600_000
    return end - days * 86_400_000, end


def egis_query_params(bbox: BBox, start_ms: int, end_ms: int) -> dict[str, str]:
    w, s, e, n = bbox
    return {"geometry": f"{w:.5f},{s:.5f},{e:.5f},{n:.5f}", "geometryType": "esriGeometryEnvelope", "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects", "time": f"{int(start_ms)},{int(end_ms)}", "where": "category=1",
            "outFields": "objectid,name,tileid,datetime,cloud_coverage,spacecraft_name", "returnGeometry": "true",
            "outSR": "4326", "orderByFields": "datetime DESC", "resultRecordCount": "200", "f": "json"}


def parse_egis_row(f: Any) -> Granule | None:
    a = f.get("attributes") if isinstance(f, dict) else None
    if not isinstance(a, dict) or a.get("objectid") is None:
        return None
    name = str(a.get("name") or "")
    meta = parse_name(name)
    if meta is None or meta["product"] != "DSWx-HLS":
        return None
    acq = meta["acquired_ms"]
    try:
        cloud = float(a["cloud_coverage"]) if a.get("cloud_coverage") is not None else None
    except (TypeError, ValueError):
        cloud = None
    return Granule(_granule_id(name), "DSWx-HLS", meta["tile"], acq, meta["produced_ms"], meta["sensor"], "earthdata_gis",
                   oid=int(a["objectid"]), footprint=_esri_rings(f.get("geometry")), tile_cloud_pct=cloud)


def egis_granules(bbox: BBox, end_ms: int, days: int = SEARCH_DAYS, *, now_ms: int | None = None) -> tuple[list[Granule], int]:
    """DSWx-HLS granules over ``bbox`` sensed in the ``days`` before ``end_ms`` (Earthdata GIS catalog, newest first)."""
    start, end = search_window(end_ms, days)
    now = now_ms if now_ms is not None else int(time.time() * 1000)
    ttl = SEARCH_TTL_PAST_S if end < now - 30 * 86_400_000 else SEARCH_TTL_S
    params = egis_query_params(bbox, start, end)
    resp = _request(f"{EGIS_HLS}/query", params, ttl_s=ttl, limiter=EGIS_LIMITER, name=_EGIS_NAME, down=EGIS_DOWN,
                    host=EGIS_HOST)
    try:
        doc = resp.json()
    except ValueError:
        fhttp.evict_cache("GET", f"{EGIS_HLS}/query", params)
        raise SourceError(f"{_EGIS_NAME} sent a reply Fire-3d could not read") from None
    if not isinstance(doc, dict) or "error" in doc or not isinstance(doc.get("features"), list):
        fhttp.evict_bad_answer(resp, "GET", f"{EGIS_HLS}/query", params)
        raise SourceError(f"{_EGIS_NAME} sent an unexpected reply")
    rows = [g for g in (parse_egis_row(f) for f in doc["features"]) if g and start <= g.acquired_ms <= end]
    return rows, int(resp.fetched_ms)


def export_params(bbox: BBox, sr: int, width: int, height: int, oids: list[int]) -> dict[str, str]:
    """``exportImage`` of the raw classes of one locked pass (``bbox`` in ``sr``)."""
    w, s, e, n = bbox
    prec = 6 if sr == 4326 else 2
    return {"bbox": f"{w:.{prec}f},{s:.{prec}f},{e:.{prec}f},{n:.{prec}f}", "bboxSR": str(sr), "imageSR": str(sr),
            "size": f"{int(width)},{int(height)}", "format": "tiff", "pixelType": "U8",
            "interpolation": "RSP_NearestNeighbor", "noData": "255",
            "renderingRule": orjson.dumps({"rasterFunction": "None"}).decode(),
            "mosaicRule": orjson.dumps({"mosaicMethod": "esriMosaicLockRaster",
                                        "lockRasterIds": sorted(int(x) for x in oids)}).decode(),
            "f": "image"}


def _is_tiff(content: bytes) -> bool:
    return content[:4] in (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+")


def read_tiff_band(content: bytes, shape_hw: tuple[int, int] | None = None) -> np.ndarray:
    """Band 1 of a GeoTIFF as uint8 (rasterio ``MemoryFile``); ValueError when it is not a usable image."""
    import rasterio
    from rasterio.io import MemoryFile

    if not _is_tiff(content):
        raise ValueError("not a GeoTIFF")
    with rasterio.Env(), MemoryFile(content) as mem, mem.open() as ds:
        arr = ds.read(1)
    if shape_hw is not None and arr.shape != tuple(shape_hw):
        raise ValueError(f"image is {arr.shape}, expected {shape_hw}")
    return arr.astype(np.uint8, copy=False)


def egis_export(p: Pass, bbox: BBox, width: int, height: int, sr: int = 4326) -> np.ndarray:
    """The raw DSWx classes of pass ``p`` on a ``width`` x ``height`` grid over ``bbox`` (in ``sr``; north up).
    Cells the pass does not cover are 255 (no data). Cached 30 days. Raises SourceError."""
    if not p.oids:
        raise ValueError("this pass has no Earthdata GIS raster")
    width, height = int(min(width, EXPORT_MAX_PX)), int(min(height, EXPORT_MAX_PX))
    params = export_params(bbox, sr, width, height, p.oids)
    url = f"{EGIS_HLS}/exportImage"
    resp = _request(url, params, ttl_s=IMAGE_TTL_S, limiter=EGIS_LIMITER, name=_EGIS_NAME, down=EGIS_DOWN,
                    host=EGIS_HOST, expect_json=False)
    try:
        return read_tiff_band(resp.content, (height, width))
    except Exception as e:  # noqa: BLE001 - ArcGIS answers errors as JSON with HTTP 200, or a cut-off image
        fhttp.evict_cache("GET", url, params)
        log.warning("%s: unusable image (%s)", _EGIS_NAME, type(e).__name__)
        raise SourceError(f"{_EGIS_NAME} sent an image Fire-3d could not read") from None


# ----------------------------------------------------------------------------------------------------------------
# CMR search and PO.DAAC downloads (EARTHDATA_TOKEN)
# ----------------------------------------------------------------------------------------------------------------
def _cmr_footprint(entry: dict) -> Any:
    from shapely.geometry import Polygon
    from shapely.ops import unary_union

    parts = []
    for poly in entry.get("polygons") or []:
        ring = poly[0] if isinstance(poly, list) and poly else poly
        try:
            nums = [float(x) for x in str(ring).split()]
        except ValueError:
            continue
        pts = [(nums[i + 1], nums[i]) for i in range(0, len(nums) - 1, 2)]
        if len(pts) >= 3:
            parts.append(Polygon(pts).buffer(0))
    for bx in entry.get("boxes") or []:
        try:
            s, w, n, e = (float(x) for x in str(bx).split())
        except ValueError:
            continue
        parts.append(box(w, s, e, n))
    return unary_union(parts) if parts else None


def parse_cmr_entry(entry: Any) -> Granule | None:
    if not isinstance(entry, dict):
        return None
    title = str(entry.get("title") or entry.get("producer_granule_id") or "")
    meta = parse_name(title)
    if meta is None:
        return None
    data = None
    for link in entry.get("links") or []:
        href = str((link or {}).get("href") or "")
        if href.startswith(f"https://{PODAAC_HOST}/") and href.endswith("_B01_WTR.tif") and "protected" in href:
            data = href
            break
    if data is None:
        return None
    try:
        cloud = float(entry["cloud_cover"]) if entry.get("cloud_cover") not in (None, "") else None
    except (TypeError, ValueError):
        cloud = None
    return Granule(_granule_id(title), meta["product"], meta["tile"], meta["acquired_ms"], meta["produced_ms"],
                   meta["sensor"], "podaac", data_url=data, footprint=_cmr_footprint(entry), tile_cloud_pct=cloud)


def cmr_granules(short_name: str, bbox: BBox, end_ms: int, days: int = SEARCH_DAYS) -> tuple[list[Granule], int]:
    """DSWx granules of ``short_name`` over ``bbox`` from NASA's catalogue (no login), newest first."""
    start, end = search_window(end_ms, days)
    iso = lambda t: datetime.fromtimestamp(t / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")  # noqa: E731
    w, s, e, n = bbox
    params = {"short_name": short_name, "bounding_box": f"{w:.4f},{s:.4f},{e:.4f},{n:.4f}",
              "temporal": f"{iso(start)},{iso(end)}", "page_size": "100", "sort_key": "-start_date"}
    resp = _request(CMR_GRANULES, params, ttl_s=SEARCH_TTL_S, limiter=CMR_LIMITER, name=_CMR_NAME)
    try:
        entries = ((resp.json() or {}).get("feed") or {}).get("entry") or []
    except (ValueError, AttributeError):
        fhttp.evict_cache("GET", CMR_GRANULES, params)
        raise SourceError(f"{_CMR_NAME} sent a reply Fire-3d could not read") from None
    rows = [g for g in (parse_cmr_entry(x) for x in entries) if g]
    return sorted(rows, key=lambda g: -g.acquired_ms), int(resp.fetched_ms)


def opera_cache_dir() -> Path:
    return Path(config.CACHE_DIR) / "opera"


def _safe_name(granule_id: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", granule_id)[:180]


def podaac_download(g: Granule) -> Path:
    """The granule's ``B01_WTR`` GeoTIFF from PO.DAAC with the token (cached for good by granule id). Raises
    :class:`LoginRefused` (401 / 403, or a login page instead of a GeoTIFF) or SourceError. Never logs or returns the
    token; the pre-signed redirect is followed without it."""
    tok = token()
    if tok is None:
        raise LoginRefused("NASA Earthdata login is not set up")
    if not g.data_url:
        raise SourceError(f"{_PODAAC_NAME}: this granule has no download link")
    dest = opera_cache_dir() / f"{_safe_name(g.id)}_B01_WTR.tif"
    if dest.is_file() and _is_tiff(dest.read_bytes()[:4]):
        return dest
    if not PODAAC_LIMITER.try_acquire():
        raise SourceBusy(f"{_PODAAC_NAME}: Fire-3d's request limit is reached; try again in a minute")
    headers = {"Authorization": f"Bearer {tok}"}
    try:
        fhttp.stream_download(g.data_url, dest, headers=headers, timeout=120.0, retries=RETRIES, overwrite=True)
    except fhttp.HttpError as e:
        if e.status in (401, 403):
            mark_refused()
            raise LoginRefused(f"{_PODAAC_NAME} refused the NASA Earthdata login (HTTP {e.status})") from None
        code = f"HTTP {e.status}" if e.status is not None else "no response"
        raise SourceError(f"{_PODAAC_NAME} could not be reached ({code})", e.status) from None
    except ValueError:                  # check_auth_headers: never sent outside the allow-list
        raise SourceError(f"{_PODAAC_NAME}: the download link is not on NASA's PO.DAAC host") from None
    finally:
        headers.clear()
    head = dest.read_bytes()[:4] if dest.is_file() else b""
    if not _is_tiff(head):
        dest.unlink(missing_ok=True)
        mark_refused()                  # URS answered with a login page: the token was not accepted
        raise LoginRefused(f"{_PODAAC_NAME} sent the NASA login page instead of the file")
    return dest


def read_window(path: Path, dst_bounds: BBox, dst_crs: str, width: int, height: int) -> np.ndarray:
    """Default :data:`READER`: the GeoTIFF's classes reprojected (nearest) onto a north-up ``width`` x ``height`` grid
    over ``dst_bounds`` in ``dst_crs``; cells it does not cover are 255."""
    import rasterio
    from rasterio.transform import from_bounds
    from rasterio.warp import Resampling, reproject

    out = np.full((int(height), int(width)), NO_DATA, np.uint8)
    with rasterio.open(path) as src:
        reproject(source=rasterio.band(src, 1), destination=out, src_nodata=NO_DATA, dst_nodata=NO_DATA,
                  dst_transform=from_bounds(*dst_bounds, int(width), int(height)), dst_crs=dst_crs,
                  resampling=Resampling.nearest)
    return out


READER: Callable[[Path, BBox, str, int, int], np.ndarray] = read_window


def s1_classes(arr: np.ndarray) -> np.ndarray:
    """DSWx-S1 WTR values -> the DSWx-HLS class set: 0, 1, 2, 254, 255 kept; 3 (inundated vegetation, a later product
    version) -> 2 partial water; anything else (HAND, layover or shadow masks: no view of the water) -> 255."""
    out = np.full(arr.shape, NO_DATA, np.uint8)
    for v in (NOT_WATER, OPEN_WATER, PARTIAL_WATER, OCEAN, NO_DATA):
        out[arr == v] = v
    out[arr == 3] = PARTIAL_WATER
    return out


def podaac_pass(p: Pass, dst_bounds: BBox, dst_crs: str, width: int, height: int) -> np.ndarray:
    """A PO.DAAC pass (one or more tiles) on a grid: the first tile that has a value wins. Raises LoginRefused /
    SourceError."""
    out = np.full((int(height), int(width)), NO_DATA, np.uint8)
    for g in p.granules:
        arr = READER(podaac_download(g), dst_bounds, dst_crs, int(width), int(height))
        if g.product == "DSWx-S1":
            arr = s1_classes(arr)
        fill = (out == NO_DATA) & (arr != NO_DATA)
        out[fill] = arr[fill]
    return out


# ----------------------------------------------------------------------------------------------------------------
# GIBS picture fallback
# ----------------------------------------------------------------------------------------------------------------
def gibs_template(layer: str, date: str) -> str:
    return f"{GIBS_ROOT}/{layer}/default/{date}/{GIBS_MATRIX}/{{z}}/{{y}}/{{x}}.png"


def _domain_dates(xml: str) -> list[str]:
    """Every date of a GIBS DescribeDomains answer ("2026-10-25/2026-10-31/P1D", or single dates)."""
    m = re.search(r"<Domain>(.*?)</Domain>", xml or "", re.S)
    out: list[str] = []
    if not m:
        return out
    for part in m.group(1).split(","):
        bits = part.strip().split("/")
        try:
            if len(bits) == 3:
                a = datetime.strptime(bits[0][:10], "%Y-%m-%d")
                b = datetime.strptime(bits[1][:10], "%Y-%m-%d")
                step = max(1, int(re.sub(r"\D", "", bits[2]) or 1)) if bits[2].endswith("D") else 1
                d = a
                while d <= b and len(out) < 5000:
                    out.append(d.strftime("%Y-%m-%d"))
                    d = datetime.fromordinal(d.toordinal() + step)
            elif bits and bits[0]:
                out.append(datetime.strptime(bits[0][:10], "%Y-%m-%d").strftime("%Y-%m-%d"))
        except ValueError:
            continue
    return sorted(set(out))


def gibs_latest(end_ms: int, layer: str = GIBS_HLS_LAYER, days: int = SEARCH_DAYS) -> tuple[str | None, int]:
    """(the newest GIBS picture date at or before ``end_ms`` within ``days``, fetched_ms)."""
    start, end = search_window(end_ms, days)
    iso = lambda t: datetime.fromtimestamp(t / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")  # noqa: E731
    url = f"{GIBS_ROOT}/1.0.0/{layer}/default/{GIBS_MATRIX}/all/{iso(start)}--{iso(end)}.xml"
    resp = _request(url, None, ttl_s=GIBS_TTL_S, limiter=GIBS_LIMITER, name=_GIBS_NAME, expect_json=False)
    end_day = datetime.fromtimestamp(end_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
    dates = [d for d in _domain_dates(resp.text) if d <= end_day]
    return (dates[-1] if dates else None), int(resp.fetched_ms)


def px_size(bbox: BBox, target_m: float = 30.0, max_px: int = 1600) -> tuple[int, int]:
    """(width, height) of a lon/lat image of ``bbox`` with pixels of about ``target_m`` (longest side <= max_px)."""
    w, s, e, n = bbox
    lat = math.radians((s + n) / 2)
    wm, hm = (e - w) * 111_320 * math.cos(lat), (n - s) * 110_570
    scale = max(wm, hm) / target_m
    k = min(1.0, max_px / max(scale, 1.0))
    return max(8, int(round(wm / target_m * k))), max(8, int(round(hm / target_m * k)))

