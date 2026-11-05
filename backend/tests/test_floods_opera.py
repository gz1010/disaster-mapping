"""NASA OPERA satellite water sources (brief 5, backend-flood-bundle-api M1; PLAN-5 3.7, D6, D25, C17).

Earthdata GIS (no login), CMR, GIBS: recorded answers (``tests/data/floods/opera``, 2026-11-05) through a routing mock
transport. The ``EARTHDATA_TOKEN`` path is tested with a **fake** token and a mock transport only (there is no real
token here): the header goes only to PO.DAAC, never into a URL, a cache key, a log record, an error or a file; the
pre-signed S3 redirect gets no header and its ``X-Amz-*`` values never reach a log record or an error (count-only
checks: the tests count occurrences and never print a value)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path

import httpx
import numpy as np
import orjson
import pytest

import fire3d.http as fhttp
from fire3d import config
from fire3d.sources import opera
from fire3d.sources.nws import SourceError

from conftest import route_transport

OPERA = Path(__file__).parent / "data" / "floods" / "opera"
BOX = (-94.80, 39.62, -94.60, 39.76)
RECORDED_MS = int(datetime(2026, 11, 5, 0, 11, tzinfo=timezone.utc).timestamp() * 1000)
EGIS = "gis.earthdata.nasa.gov"
FAKE_TOKEN = "fake-earthdata-token-for-tests-0123456789abcdef"
AMZ = {"X-Amz-Security-Token": "FAKEAMZSECURITYTOKENVALUE", "X-Amz-Signature": "fakeamzsignature0123",
       "X-Amz-Credential": "FAKEAMZCREDENTIAL/20261105"}


@pytest.fixture
def egis(monkeypatch, flood_iso):
    calls: list[httpx.Request] = []
    probes = {13958123: "egis_probe_0.tif"}

    def export(req: httpx.Request) -> httpx.Response:
        size = req.url.params["size"]
        if size == "400,361":
            return httpx.Response(200, content=(OPERA / "egis_export.tif").read_bytes(), headers={"content-type": "image/tiff"})
        oids = orjson.loads(req.url.params["mosaicRule"])["lockRasterIds"]
        name = probes.get(oids[0], "egis_probe_1.tif")
        return httpx.Response(200, content=(OPERA / name).read_bytes(), headers={"content-type": "image/tiff"})

    routes = [(EGIS, r"/ImageServer/query$", OPERA / "egis_query.json"), (EGIS, r"/ImageServer/exportImage$", export),
              ("cmr.earthdata.nasa.gov", r"/granules\.json$",
               lambda r: httpx.Response(200, content=(OPERA / ("cmr_s1.json" if "S1" in r.url.params["short_name"]
                                                                else "cmr_hls.json")).read_bytes())),
              ("gibs.earthdata.nasa.gov", r"\.xml$", OPERA / "gibs_domain.xml")]
    monkeypatch.setattr(fhttp, "_transport", route_transport(routes, calls))
    return calls


# ---------------------------------------------------------------------------------------------------------------
# Earthdata GIS (default, no login)
# ---------------------------------------------------------------------------------------------------------------
def test_egis_granules_and_passes(egis):
    grans, fetched = opera.egis_granules(BOX, RECORDED_MS, days=20, now_ms=RECORDED_MS)
    assert len(grans) == 15 and fetched
    assert all(g.product == "DSWx-HLS" and g.route == "earthdata_gis" and g.oid for g in grans)
    assert all(g.footprint is not None and not g.footprint.is_empty for g in grans)
    passes = opera.group_passes(grans)
    assert len(passes) == 9
    assert [p.acquired_ms for p in passes] == sorted((p.acquired_ms for p in passes), reverse=True)
    two = [p for p in passes if len(p.granules) == 2]
    assert two and all(len(set(g.tile for g in p.granules)) == 2 for p in two)      # the tiles of one pass
    q = egis[0].url.params
    assert q["where"] == "category=1" and q["orderByFields"] == "datetime DESC"


def test_granule_names_give_exact_image_times():
    m = opera.parse_name("OPERA_L3_DSWx-HLS_T15TUE_20261029T170629Z_20261031T145515Z_L8_30_v1.1_B01_WTR")
    assert m["acquired_ms"] == int(datetime(2026, 10, 29, 17, 6, 29, tzinfo=timezone.utc).timestamp() * 1000)
    assert m["produced_ms"] > m["acquired_ms"] and m["sensor"] == "L8" and m["tile"] == "T15TUE"
    g = opera.Granule("x", "DSWx-HLS", "T15TUE", 1, None, "S2B", "earthdata_gis")
    assert g.platform == "Sentinel-2B"
    assert opera.parse_name("not a granule") is None


def test_egis_export_locked_raw_classes(egis):
    grans, _ = opera.egis_granules(BOX, RECORDED_MS, days=20, now_ms=RECORDED_MS)
    p = next(x for x in opera.group_passes(grans) if x.key == "DSWx-HLS_20261025T1714_S2B")
    arr = opera.egis_export(p, BOX, 400, 361)
    assert arr.shape == (361, 400) and arr.dtype == np.uint8
    assert set(np.unique(arr)) <= set(opera.CLASSES)
    q = egis[-1].url.params
    assert orjson.loads(q["mosaicRule"]) == {"mosaicMethod": "esriMosaicLockRaster", "lockRasterIds": sorted(p.oids)}
    assert orjson.loads(q["renderingRule"]) == {"rasterFunction": "None"}
    assert q["interpolation"] == "RSP_NearestNeighbor" and q["pixelType"] == "U8" and q["noData"] == "255"


def test_egis_export_json_error_is_a_source_error(monkeypatch, flood_iso):
    monkeypatch.setattr(fhttp, "_transport", route_transport(
        [(EGIS, r"/exportImage$", {"error": {"code": 500, "message": "Error exporting image"}})]))
    p = opera.Pass("k", "DSWx-HLS", "S2B", 1, [opera.Granule("g", "DSWx-HLS", "T", 1, None, "S2B", "earthdata_gis", oid=7)])
    with pytest.raises(SourceError, match="could not read"):
        opera.egis_export(p, BOX, 64, 64)


def test_gibs_latest_and_template(egis):
    date, _ = opera.gibs_latest(RECORDED_MS)
    assert date == "2026-10-31"
    t = opera.gibs_template(opera.GIBS_HLS_LAYER, date)
    assert t.endswith("/OPERA_L3_Dynamic_Surface_Water_Extent-HLS/default/2026-10-31/GoogleMapsCompatible_Level12/{z}/{y}/{x}.png")


def test_cmr_search_without_login(egis):
    s1, _ = opera.cmr_granules(opera.S1_SHORT_NAME, BOX, RECORDED_MS)
    hls, _ = opera.cmr_granules(opera.HLS_SHORT_NAME, BOX, RECORDED_MS)
    assert s1 and all(g.product == "DSWx-S1" and g.route == "podaac" for g in s1)
    assert hls and all(g.product == "DSWx-HLS" for g in hls)
    for g in s1 + hls:
        assert g.data_url.startswith(f"https://{opera.PODAAC_HOST}/podaac-ops-cumulus-protected/")
        assert g.data_url.endswith("_B01_WTR.tif")
    assert all("Authorization" not in r.headers for r in egis)


# ---------------------------------------------------------------------------------------------------------------
# Login state and the token path (fake token, mock transport; C17)
# ---------------------------------------------------------------------------------------------------------------
def _tiff(width: int = 8, height: int = 8, value: int = 1) -> bytes:
    import rasterio
    from rasterio.io import MemoryFile
    from rasterio.transform import from_bounds

    arr = np.full((height, width), value, np.uint8)
    arr[0, :] = 255
    with MemoryFile() as mem:
        with mem.open(driver="GTiff", width=width, height=height, count=1, dtype="uint8", crs="EPSG:4326", nodata=255,
                      transform=from_bounds(*BOX, width, height)) as ds:
            ds.write(arr, 1)
        return mem.read()


def _granule(product: str = "DSWx-S1") -> opera.Granule:
    gid = "OPERA_L3_DSWx-S1_T15TUE_20261031T002046Z_20261101T000853Z_S1D_30_v1.0"
    return opera.Granule(gid, product, "T15TUE", 1, None, "S1D", "podaac",
                         data_url=f"https://{opera.PODAAC_HOST}/podaac-ops-cumulus-protected/OPERA_L3_DSWX-S1_V1/{gid}_B01_WTR.tif")


def test_login_not_configured_without_token(monkeypatch, flood_iso):
    monkeypatch.setattr(config, "EARTHDATA_TOKEN", None)
    assert opera.login_state() == "not_configured"
    with pytest.raises(opera.LoginRefused):
        opera.podaac_download(_granule())


def _podaac_transport(seen: list[httpx.Request], s3_body: bytes | None = None, podaac_status: int | None = None,
                      urs_page: bool = False) -> httpx.MockTransport:
    s3 = (f"https://podaac-ops-cumulus-protected.s3.us-west-2.amazonaws.com/OPERA/file.tif?"
          + "&".join(f"{k}={v}" for k, v in AMZ.items()))

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        if req.url.host == opera.PODAAC_HOST:
            if podaac_status is not None:
                return httpx.Response(podaac_status, text="Unauthorized")
            if urs_page:
                return httpx.Response(302, headers={"location": f"https://{opera.URS_HOST}/oauth/authorize?app_type=401"})
            return httpx.Response(303, headers={"location": s3})
        if req.url.host == opera.URS_HOST:
            return httpx.Response(200, text="<html><body>Earthdata Login</body></html>", headers={"content-type": "text/html"})
        if req.url.host.endswith("amazonaws.com"):
            return httpx.Response(200, content=s3_body or _tiff(), headers={"content-type": "image/tiff"})
        raise RuntimeError("unexpected host")

    return httpx.MockTransport(handler)


def _count_secrets(text: str) -> int:
    return text.count(FAKE_TOKEN) + sum(text.count(v) for v in AMZ.values())


def test_token_goes_only_to_podaac_and_never_leaks(monkeypatch, flood_iso, caplog):
    monkeypatch.setattr(config, "EARTHDATA_TOKEN", FAKE_TOKEN)
    caplog.set_level(logging.DEBUG)
    for name in ("httpx", "httpcore", "fire3d"):
        logging.getLogger(name).setLevel(logging.DEBUG)
    seen: list[httpx.Request] = []
    monkeypatch.setattr(fhttp, "_transport", _podaac_transport(seen))
    assert opera.login_state() == "configured"
    path = opera.podaac_download(_granule())
    assert path.is_file() and path.read_bytes()[:4] in (b"II*\x00", b"MM\x00*")
    podaac = [r for r in seen if r.url.host == opera.PODAAC_HOST]
    s3 = [r for r in seen if r.url.host.endswith("amazonaws.com")]
    assert len(podaac) == 1 and len(s3) == 1
    assert podaac[0].headers.get("authorization") == f"Bearer {FAKE_TOKEN}"
    assert "authorization" not in s3[0].headers                           # the redirect leaves the origin: dropped
    assert all(FAKE_TOKEN not in str(r.url) for r in seen)
    # count-only scans: logs, the cache folder and the file name hold neither the token nor the X-Amz-* values
    assert _count_secrets(caplog.text) == 0
    cached = b"".join(p.read_bytes() for p in Path(config.CACHE_DIR).rglob("*") if p.is_file())
    assert cached.count(FAKE_TOKEN.encode()) == 0
    assert _count_secrets(str(path)) == 0
    # the pass reader (injectable) sees the cached file; S1 classes mapped
    monkeypatch.setattr(opera, "READER", lambda p, b, crs, w, h: np.array([[0, 1, 3, 251]], np.uint8))
    out = opera.podaac_pass(opera.Pass("k", "DSWx-S1", "S1D", 1, [_granule()]), BOX, "EPSG:4326", 4, 1)
    assert out.tolist() == [[0, 1, 2, 255]]


def test_default_reader_reprojects_into_the_grid(monkeypatch, flood_iso):
    monkeypatch.setattr(config, "EARTHDATA_TOKEN", FAKE_TOKEN)
    monkeypatch.setattr(fhttp, "_transport", _podaac_transport([], s3_body=_tiff(16, 16, 2)))
    path = opera.podaac_download(_granule("DSWx-HLS"))
    arr = opera.read_window(path, BOX, "EPSG:4326", 8, 8)
    assert arr.shape == (8, 8) and (arr[1:] == 2).all()
    # a grid reaching west of the image: cells the image does not cover are 255 (no data), never "not water"
    wide = opera.read_window(path, (BOX[0] - 0.2, BOX[1], BOX[2], BOX[3]), "EPSG:4326", 8, 8)
    assert (wide[:, :3] == 255).all() and (wide[2:, 5:] == 2).all()


@pytest.mark.parametrize("status", [401, 403])
def test_refused_token_401_403(monkeypatch, flood_iso, caplog, status):
    monkeypatch.setattr(config, "EARTHDATA_TOKEN", FAKE_TOKEN)
    monkeypatch.setattr(fhttp, "_transport", _podaac_transport([], podaac_status=status))
    with pytest.raises(opera.LoginRefused) as ei:
        opera.podaac_download(_granule())
    assert _count_secrets(str(ei.value)) == 0 and _count_secrets(caplog.text) == 0
    assert opera.login_state() == "refused"


def test_redirect_to_the_login_page_is_refused_and_not_kept(monkeypatch, flood_iso):
    monkeypatch.setattr(config, "EARTHDATA_TOKEN", FAKE_TOKEN)
    seen: list[httpx.Request] = []
    monkeypatch.setattr(fhttp, "_transport", _podaac_transport(seen, urs_page=True))
    with pytest.raises(opera.LoginRefused, match="login page"):
        opera.podaac_download(_granule())
    assert opera.login_state() == "refused"
    assert not list(opera.opera_cache_dir().glob("*.tif"))
    urs = [r for r in seen if r.url.host == opera.URS_HOST]
    assert urs and all("authorization" not in r.headers for r in urs)


def test_token_never_sent_outside_the_allow_list(monkeypatch, flood_iso):
    monkeypatch.setattr(config, "EARTHDATA_TOKEN", FAKE_TOKEN)
    seen: list[httpx.Request] = []
    monkeypatch.setattr(fhttp, "_transport", _podaac_transport(seen))
    g = _granule()
    g.data_url = "https://example.com/OPERA_B01_WTR.tif"
    with pytest.raises(SourceError) as ei:
        opera.podaac_download(g)
    assert not seen and _count_secrets(str(ei.value)) == 0


def test_s1_class_mapping():
    arr = np.array([0, 1, 2, 3, 250, 251, 252, 253, 254, 255], np.uint8)
    assert opera.s1_classes(arr).tolist() == [0, 1, 2, 2, 255, 255, 255, 255, 254, 255]


def test_px_size_about_30_m_and_capped():
    w, h = opera.px_size(BOX)
    assert 500 < w < 650 and 450 < h < 560
    w, h = opera.px_size((-95.0, 39.0, -94.0, 40.0), max_px=1600)
    assert max(w, h) == 1600
