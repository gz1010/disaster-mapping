# Progress: brief5-backend-flood-sources

Role `backend-flood-sources` (PLAN-5 §10.1, `plan5-roles.json`); ports API 8751 / Vite 5211.

## Baseline (before any change)

- `uv run pytest -q`: 1009 passed, 0 skipped (135 s).

## M1 contracts (done)

- `backend/fire3d/contracts.py`: every CONTRACT 16.2-16.6 model; inline TS objects get named Python models
  (`FloodTimeRange`, `FloodManifestFiles`, `GaugeImpact`, `GaugeAttribution`, `FloodMapStats`, `SatelliteImage`,
  `SatelliteTiles`, `SatelliteStats`); helper aliases `ResolvedFrom`, `PastRule`, `NfhlAvailability`.
- `web/src/api/floodTypes.ts` (verbatim 16.2-16.6), re-exported by `web/src/api/types.ts`.
- `backend/fire3d/config.py`: `FLOODS_DIR`, `EARTHDATA_TOKEN`, `EARTHDATA_AUTH_HOSTS`, `FLOODS_ENABLED`,
  `AUTO_BUILD_FLOODS`; `mask_secrets` masks both secrets, any `Bearer <credential>`, `X-Amz-(Security-Token|Signature|
  Credential)` values; module doc says two secrets.
- `backend/fire3d/http.py`: `check_auth_headers` (Authorization only over https to the allow-list, `ValueError` before
  any request); `stream_download(headers=)`; headers never in the cache key.
- Tests: `test_flood_contracts.py` (77: names, optionality, every literal union, inline objects), `test_config.py`
  and `test_http.py` additions (fake token, mock transport, 303 to a pre-signed S3 URL: token only to PO.DAAC, never
  in a URL, log, error or cache file; count-only).
- `SPEC.md` §4.4 "Flood ids", §6 flood route rows.

## M2 fixture (done)

- `backend/scripts/make_fixture.py --only flood [--now ISO] [--copy-api DIR]` (also in the default run): writes
  `data/floods/fixture-flood/` in about 6 s: procedural valley (EPSG:32612, 12 km, 1024²), every layer of PLAN-5 3.3
  (elevation, sky_view, naip.jpg, water_forecast, floodplain, water_satellite, water_model), `warnings.json` (FL.W NEW +
  EXT ending now + 8 h, FA.Y, FA.A zone-based), `gauges.json` (ZZRF1 moderate, crest major − 1 ft at +30 h; ZZRF2 action,
  `crest_at_end`; ZZRF3 no_flooding without reach; ZZRF4 obs_not_current), `satellite.json` + PNG (cloud ~25 %, no-data
  strip, image ending before the AOI's east edge, no-view hatch never transparent), maps (RFC FIM per reach with
  member-reach stats, CatFIM moderate/major, NFHL with availability and two effective dates, no zone X minimal), model
  (NWM analysis, 5-day, high flow with `recur_cat`, series for ZZRF1/ZZRF2), and `api/` canned answers for every route,
  the seven list-only demo floods, `edge/` cases and a canned build job. Issuers fictional (KZZZ, ZZRFC).
- `backend/scripts/serve_fixture.py`: every flood route of CONTRACT 16.7 from `data/floods/*/api/`, `?edge=`.
- `backend/tests/conftest.py`: session `flood_fixture_data` / `flood_fixture_bundle` (generated in tmp at
  2026-11-04T18:00:00Z, network refused); `tmp_data_dir` sets `FLOODS_DIR`.
- Committed copy `backend/tests/data/floods/fixture_api/` (equal to a fresh run: tested).
- `backend/fire3d/floods/copy.py` (16.14 strings, 16.15 credits and sources), `floods/grouping.py` (`flood_rank`).
- Tests: `test_floods_fixture.py`, `test_floods_copy.py`, `test_serve_fixture.py` flood routes. Full suite 1159 passed,
  0 skipped (67 s).

## M3 sources (done)

- `sources/nws.py` (fire defaults unchanged, the existing NWS tests pass untouched): `FLOOD_EVENTS`,
  `FLOOD_PHENOMENA`, `EVENT_LABELS`; `normalize_alert(feature, family="fire"|"flood")` ->
  `normalize_flood_alert` (FloodAlert fields + internal `_geometry`, `_same`, `_references`, `_awips`, VTEC year from
  the begin time, else the oldest reference, else sent; Emergency from damage threat CATASTROPHIC or the headline);
  `flood_url()`, `flood_active()` (one national request, NWS limiter, 2 min); `parse_hvtec`, `parse_hvtec_for`,
  `product_hvtec` (product list 5 min + product for good; never in the list build); `local_in_scope(...,
  hazard=)`, `mentions_flood`, `normalize_local_nws(f, hazard)`, `split_local(f, hazard)`, `past_local(...,
  hazard=)`, `NationalAnswer.local_flood`; `bypoint_events(..., phenomena=)`; `ArchiveEvent.event` from
  `EVENT_LABELS`.
- `sources/nwps.py`: riv_gauges layers 0/15 and envelope, rfc_max_forecast, IEM join keys (`key4`: the rows have no
  year), NWPS gauge/stageflow/reach (timeout 20 s, one retry, `NWPS_DOWN` outage memory); parsers to `RiverGauge`,
  `GaugeSeries`, `ModelSeries`. Measured: `riv_gauges.obstime` is UTC (equals NWPS validTime); rfc_max_forecast has
  no last step, so its `crest_at_end` is read conservatively (min before max).
- Recorder `scripts/record_test_samples_floods.py`: 13 real requests on 2026-11-04 ~22:15 UTC; samples in
  `tests/data/floods/{nws,nwps}/` with PROVENANCE.md (35 flood products, 97 gauges at action+, 88 RFC points, 22 IEM
  warnings).
- Tests: `test_floods_nws.py` (12), `test_floods_nwps.py` (11+). Full suite 1182 passed, 0 skipped.

## M4 catalog (done)

- `floods/{catalog,grouping,naming,registry,store}.py`, `api/floods.py` (+ one `include_router` line in `api/app.py`):
  rules 1-13, SAME-county watch overlap with no request, gauge episodes, aliases, last-known summaries, stale copies,
  outages; `GET /api/floods`, `/api/floods/status`, `/api/floods/{id}`. SPEC §8.8.
- Real API on port 8751 (FIRE3D_LIVE=0), 2026-11-04 ~22:55 UTC: 43 lower-48 floods, 31 NWS products in effect, 5
  upstream requests, 4.2 s cold (table in the report).
- Tests: `test_floods_grouping.py` (17, every rule), `test_floods_registry.py`, `test_floods_catalog.py` (the recorded
  day equals `tests/data/floods/catalog/cases.json`, reviewed by hand), `test_floods_list_cost.py` (5 requests, none
  per flood; stale copies), `test_floods_list_api.py` (routes, rule-13 chain, 503).
- Gates: backend 1213 passed, 0 skipped; web typecheck clean, lint 55 (all `src/scene`), 1457 tests passed, build OK.
- Wrote `docs/redesign/contract5/backend-flood-sources.md` and `docs/redesign/reports/brief5-backend-flood-sources.json`.

## Status

All four milestones done. Cut line left: SPEC §10 test notes; the background H-VTEC fetch is backend-flood-live's.

## Review fixes (BFS-R1..R10, docs/redesign/reports/review5-backend-flood-sources.json)

- Picked up after the container restart from the snapshot c69c324 (an earlier fix attempt had R1-R10 mostly done,
  gates not run). Re-verified each finding with the reviewer's scripts on the recorded day (carry-over, NWS down,
  downtime, areal link) and on the real API (port 8751, 2026-11-04 ~23:40 UTC, 5 upstream requests).
- R1 carry-overs `ended` (`catalog.as_left`); R2 tide-gauge caveat `GAUGE_ONLY_COASTAL_CAVEAT` (19 of 25 gauge-only
  floods today); R3 areal FA.W links the gauge its text names (Winslow + LCWA3 one flood); R4 outages "cannot
  decide", `ALERTS_UNAVAILABLE` caveat, no split, edge fixtures from the real path; R5 episodes kept until 48 h quiet;
  R6 200 kept, recorded as a deviation; R7 issue times; R8 strings in `copy.py`; R9 PROVENANCE count; R10 IEM join in
  `sources[]` and SPEC §2 rows.
- Found in this step on the real list and fixed: "Conejos River flood" listed twice (NWS replaced KPUB.FA.W.0026 by
  KPUB.FA.W.0028): continuation rule (`catalog.continuations`); "Fisher Island flood" kept an old-code plain caveat
  (as_left decides it again); a gauge whose flood-stage reading is old would have opened a new episode each build
  (quiet time floored at the episode's start); a carry-over's `ended` phases are saved so a later outage cannot revive
  them. Tests for each.
