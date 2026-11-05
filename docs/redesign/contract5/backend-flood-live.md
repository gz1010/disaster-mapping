# As built: backend-flood-live (brief 5)

Role `backend-flood-live` (PLAN-5 §3.5-3.6, §10.1). Milestones M1 live (commit 051975d) and M2 past floods (2d9cc95,
below the cut line, built: user decision U1 (a)), on branch `claude/cool-mayer-ki7to6`. This note lists the real names,
signatures and routes, and every deviation from CONTRACT §16 (the integration folds it into §16.16).

## Contract triple (additive)

- **`FloodManifest.refreshed_ms?: number | null`** (Python `refreshed_ms: int | None = Optional_()`): when the flood
  live loop last appended NWS product versions or gauge readings to `warnings.json` / `gauges.json`. `built_ms` stays
  (the terrain did not change). The web loads bundle files per `(id, built_ms)`; to show appended versions in an open
  Forensic view it can add `refreshed_ms` to that key (web roles: optional).
- No other type changed. `past_rule` is always `"moderate_or_worse"` (a bulk severity route exists, below);
  `preparing` is used. SPEC: §8.9 (flood live refresh), §8.10 (past floods), §6 rows of `/api/floods` (historical),
  `/api/floods/status`, `/api/official/flood-alerts` and `/api/official/river-gauges` (past times), §5.3 (manifest
  `refreshed_ms`, `warnings.json` keeps every version), §8.8 rule 13 (the year step is built).

## M1: the flood live loop (`backend/fire3d/floods/live.py`)

- **Second task** in `api/app.py`'s lifespan: `flood_live.flood_refresh_loop(jobs)` (task name
  `fire3d-flood-live-refresh`) when `config.LIVE_ENABLED and config.FLOODS_ENABLED`; both tasks are cancelled on
  shutdown. The fire loop (`api/live.py`) is not edited; a flood error cannot reach it (independent tasks; every cycle
  catches its own errors; tests: a crashing flood task and a failing flood cycle leave the fire loop running).
- State `flood_live.STATE: FloodLiveState` (`running`, `last_refresh_ms`, `next_refresh_ms`, `active_floods`,
  `gauges_in_flood`, `last_error`, `cycles`, `auto_build_done`, `auto_build_ids`, `last_prefetch`, `last_appended`,
  `last_refreshes`, `hvtec_tried`, `seen_passes`), `reset_state()`.
- **`GET /api/floods/status`** → `flood_live.live_status()`: from the loop once it has finished a cycle; before that,
  or without the loop, from `catalog.live_status()` (the cached list). `auto_build` is true only while the loop runs
  with `AUTO_BUILD_FLOODS` (catalog's own value said `AUTO_BUILD_FLOODS and LIVE_ENABLED`, true even with
  `FIRE3D_FLOODS=0`). Counts null when the lists could not decide (`list_counts(lst)`: `_decided`, else `_nws_ok and
  _gauges_ok`) or the cycle failed; never 0 for unknown.
- **One cycle** (`run_cycle(jobs)`, every `REFRESH_S` = 900 s; env `FIRE3D_FLOOD_LIVE_INTERVAL_S` for tests):
  1. `catalog.flood_list(refresh=True)` and the counts;
  2. `warm_year_lists()`: starts the past years' background builds when missing or stale (no request once built);
  3. `prefetch(lst, budget=PREFETCH_MAX=20)`: `prefetch_plan(lst, alerts, now)` → `hvtec` (river products in effect,
     warnings first, newest first, never asked before and not cached: `nws.product_hvtec`, counted 1 or 2 requests),
     `zones` (zone-based products' UGCs not cached: `nws.nws_zone`, 1 each), `series` (member gauges at minor or
     worse without any cached stageflow: `nwps.stageflow`, 1 each). Shares `PREFETCH_CAPS` hvtec 10 / zones 5 /
     series 5, then leftovers in the same order. Each fetch is counted at its largest possible cost before it is
     made; `SourceBusy` ends that kind for the cycle. The national products are read from the HTTP cache only
     (`catalog._stale_alerts()`: the list build has just fetched them).
  4. `refresh_bundles(lst, jobs)`: ready live non-synthetic bundles of listed floods (`BUNDLES_PER_CYCLE` 8, least
     recently refreshed first; skipped while any job of that flood runs or its build lock is held):
     `append_bundle(fid, summary, now=, reads=)` and `refresh_reason(fid, m, summary, now=)`.
  5. First cycle in which both lists answered and `AUTO_BUILD_FLOODS`: `auto_build_candidates(floods)` (the top
     `AUTO_BUILD_FLOODS_N` = 4 by the list's floodRank order among active, real, lower-48 floods; watches and gauges with
     `GAUGE_ONLY_COASTAL_CAVEAT` left out; those with a ready or building bundle are not built again), built one after
     another by `auto_build(jobs, ids)` (`build.gate` first; refused ids skipped).
- **Appending** (`append_bundle`): `merge_alerts(old, fresh)` keeps every version by CAP id (fresh wins), marks a
  product `ended` when NWS answered without its VTEC key (as `catalog.as_left`), changes nothing during an outage,
  merges zone outlines by UGC; `merge_gauges(old, fresh, refs, now)` appends member readings: NWPS
  (`gauges.nwps_river_gauge_fetched`, with series) for at most `GAUGE_READS_MAX` = 12 gauges a cycle (series union, the
  newer forecast), else the list's own `FloodGaugeRef` reading (no request; forecast untouched). Both answers are
  validated strictly (`FloodAlertsResponse`, `RiverGaugesResponse`) and written atomically under the bundle's build
  lock (`pipeline.bundle_lock(timeout=0)`; skipped when busy or when the bundle was rebuilt meanwhile); the manifest
  gets `refreshed_ms` and the layer times.
- **Refresh jobs** (kind `refresh`, `refresh_job_fn(fid, reason)`): `refresh_reason` answers `satellite` (a pass in
  NASA's Earthdata GIS catalog newer than the bundle's image that this server has not tried: `seen_passes`), `rfc_fim`
  (`water_maps.rfc_fim(bbox).reference_ms` differs from `layer_status.water_forecast.time_ms`; same cache key as the
  maps route), or `retry` (an official layer `unavailable` with an outage reason, after `RETRY_FAILED_H` = 3 h); never
  for an inactive flood, never sooner than `REFRESH_MIN_AGE_H` = 1 h after the last build. The job runs
  `build.build_flood(fid, force=True)` and then merges back the earlier product versions and observed rows
  (`merge_alerts`, `merge_rebuilt_gauges`).
- **CLI** (`fire3d/cli.py`): `catalog --hazard flood [--mode live|historical] [--year Y] [--refresh]`
  (`_cmd_flood_catalog`; historical builds and waits), `build-flood <id-or-name> [--force]` (`resolve_flood(ref)`:
  an id, or a fuzzy name from the live list with `match_incidents`; `BuildRefused` → exit 1 with the API's text).
- **`scripts/check_bundle.py --hazard flood <id>`** (`check_flood_bundle(bdir) -> (Report, manifest)`): strict
  FloodManifest / FloodAlertsResponse / RiverGaugesResponse / SatelliteWaterResponse / ModelOutputResponse; the eight
  `layer_status` keys; each layer against its LayerInfo with the flood encodings (water_forecast and water_model 0/255,
  floodplain 0-3, water_satellite DSWx classes); the satellite PNG decodable and not fully transparent when the image
  has cloud or no-data pixels (D25); GeoJSON copies are FeatureCollections; every `ok` layer's source credited in
  `data_sources`; no relative age in any JSON file (C16); no secret in any file (count only). `_check_layer` gained
  `grid=`/`dtype=` keywords (fire defaults unchanged).

### M1 measured

- One real cycle on port 8760 (2026-11-05 06:01-06:03 UTC; `FIRE3D_LIVE=1 FIRE3D_AUTO_BUILD_LIVE=0`, a scratch copy of
  `data/floods`, the main cache): 55 floods listed (37 active, 31 gauges in flood); prefetch hvtec 14 + series 6 = 20
  requests; appended to 5 bundles; 4 refresh jobs (Peace River `rfc_fim`; Grand River, St. Johns River, Platte River
  `satellite`), rebuilt in 3-49 s; every earlier product version kept; `check_bundle --hazard flood` 0 problems on all
  five afterwards. The fire loop ran its own cycle (151 fires) unchanged. No secret in the log (count only).
- `build-flood "moenkopi wash"`: a real bundle in 29 s (10.7 MB); `check_bundle --hazard flood` 0 problems; also 0 on
  `fixture-flood`, St. Johns River, Calcasieu River and Platte River in `data/floods`. Grand River and Peace River
  (built before bundle-api's credit fix R1) fail only the credit check until rebuilt (the loop's refresh does it).

## M2: past floods (`backend/fire3d/floods/history.py`)

- **Bulk route found** (6 research requests of the 10 allowed; PLAN-5 §3.6): IEM
  `cgi-bin/request/gis/watchwarn.py?accept=csv&limit1=1&limitps=1&phenomena=FL,FF&significance=W,W&addsvs=1` has
  `hvtec_nwsli`, `hvtec_severity`, `damagetag` and `is_emergency` for every storm-based warning polygon (issuance and
  follow-up statements; follow-ups raise the severity of about 16 % of events, so `addsvs=1` is needed); the polygons
  come from `api/1/vtec/sbw_interval.geojson?ph=FL&ph=FF` (year, counties). The two services cut their windows
  differently (the CSV by VTEC begin, the polygons by the issuance product), so all months are read before rows and
  polygons are joined by key, and the first month's polygons start 14 days earlier. IEM's `emergencies.json` is not
  needed (`is_emergency` is in the CSV). **So `past_rule` is always `"moderate_or_worse"` (PAST_RULE); the fallback
  is not used.** `vtec_events_bystate.py` (49 requests a year in the plan) is not used either.
- Names: `PAST_YEARS` (2026, 2025), `PAST_RULE`, `SCHEMA`, `WATCHWARN_URL`, `SBW_URL`, `EPISODE_GAP_H` (=
  `INACTIVE_LISTED_H` 48), `FLASH_JOIN_H` (= `AREAL_NEAR_H` 12), `MAX_PAST_EVENTS` 12, `MAX_PAST_GAUGES` 6;
  `month_windows(year, now)`, `watchwarn_params`, `sbw_params`, `fetch_month(start, end, ttl, *, sbw_start_ms=None)`,
  `gauge_rows(lids)` (NWS `riv_gauges` layer 0 by `gaugelid in (...)`, 150 a request, cached 30 days), `Event`,
  `events_from(rows, features)`, `meets_rule(ev)`, `group_events(events)`, `summarize(group, gauges)`,
  `assign(rows, reg)`, `build_rows(events, year, *, reg, gauges)`, `build_year(year, *, now) -> (answer, partial)`,
  `year_list(year, *, wait=False)`, `cached_rows(year)`, `find(flood_id)`, `past_flood_alerts(summary, *, now,
  at_ms)`, `past_area_alerts(bbox, ...)`, `past_gauge(...)`, `past_gauges(lids, *, now, at_ms, start_ms, end_ms,
  flood_id, member, area)`, `past_flood_gauges(summary, ...)`, `past_area_gauges(bbox, ...)`, `latlon_polygon(text)`,
  `is_past(at_ms, now)` (older than now − 6 h), `default_year()`, `reset_state()`.
- **Year lists:** built once per year in a daemon thread on the first request (the live loop also starts them each
  cycle), `preparing: true` until then; memory + disk copy `data/floods/years/{year}.json` (`{schema, built_at,
  answer}`): for good for a closed year, rebuilt after `YEAR_REFRESH_H` 6 h for the current year. Requests on
  `nws.IEM_LIMITER` (30 a minute, shared with the fire archive; the build waits `BUSY_WAIT_S` for a slot); month TTLs:
  closed year for good, this year's closed months 30 days, the current month 6 h. IEM down → `iem_archive`
  `unavailable` with `ARCHIVE_DOWN` (never an empty "no floods" year; two failed months with no success stop the
  build); some months failed → `available`, `stale: true`, `ARCHIVE_PARTIAL` naming the months, retried after 10 min;
  a failed rebuild never replaces a complete list. Other years: an empty list, `iem_archive` `unavailable` with
  `YEAR_NOT_KEPT`.
- **Rows:** PAST_RULE (FL.W at a gauge with H-VTEC severity 2-3 in any product; FF.W with damage tag CONSIDERABLE or
  CATASTROPHIC, or an emergency), lower 48 + DC; one river flood per gauge episode (warnings at one gauge less than 48 h
  apart), flash floods joined when their polygons overlap 30 % of the smaller within 12 h; names by `naming.flood_name`
  (the gauge's river; the largest place in the polygon), duplicates numbered by `naming.dedupe_names`. Fields:
  `mode: "historical"`, `status: "inactive"`, level `warning`, `started_ms` = the first product's issue time (`nws_product`;
  the CSV's `utc_issue` is the VTEC begin, which can come days after the product), `ended_ms` = the last expiry,
  `expires_ms` null, `last_product_ms` = the newest product, `max_category` from the H-VTEC severity ("moderate" /
  "major"; null for flash floods), `primary_gauge` with `observed_category: "unknown"` and no reading,
  `gauges_in_flood` 0, products `archived: true`, `phase: "ended"`, `id` = IEM's issuance product id, `url` = IEM's
  event page, `sender_name` null.
- **Ids:** `assign` looks every VTEC key (`K{wfo}.{ph}.W.{etn:04d}.{year}`) up in the registry first: a hit gives its
  live id (and the live name from its last-known summary); rows of one live id merge (`_merge`). Else
  `naming.make_flood_id(started_ms, name before duplicate suffixes, gauge NWSLI or oldest VTEC key)`; the year builder
  never writes registry lines. This year's rows still in the live list are served as their live rows by
  `GET /api/floods?mode=historical` (`api/floods._with_live_rows`; 8 of 2,108 on 2026-11-05).
- **Detail chain year step** (`api/floods._resolve`): live list → `history.find(id)` (cached year lists only; never a
  build or a request) → `catalog.resolve` (alias, bundle, last-known, 404 / 503). Every per-flood route uses it
  (`_summary`), so maps, model and satellite answer past floods too (maps and model `not_available_for_past_dates` at
  their `at_ms`).
- **Past answers** (`at_ms` older than 6 h):
  - `flood-alerts?flood=`: `past_flood_alerts`: IEM `json/vtec_event.py` per event (`nws.event_detail`, at most 12
    events, cached 30 days once over), every version sent up to `at_ms` (+ 6 h), the event's own segment verbatim
    (headline, description, instruction), `LAT...LON` polygon, H-VTEC (`nws.parse_hvtec_for`), damage threat and
    detection from the raw segment, `sender_name` from "National Weather Service <office>", `url` IEM's product page,
    `archived: true`, phase `ended` for a past flood (a live flood's versions by their own end), source `SOURCE_IEM`.
    Before the flood's first product: `not_available_for_past_dates` with `PAST_BEFORE_FLOOD`; IEM unreachable:
    `unavailable` with `PAST_ALERTS_DOWN` (never "no product").
  - `flood-alerts?bbox=` at a past time: `not_available_for_past_dates`, `PAST_AREA_ALERTS`.
  - `river-gauges?flood=` / `?lid=`: `past_gauges`: NWPS detail (thresholds, impacts of today) + USGS
    `observed_series` over the flood's span (start − 3 d to end + 2 d, at most 40 days; `lid`: 10 days before to 3 days
    after `at_ms`); `forecast: null`, series forecast `[]`; the reading at `at_ms` with `category: "unknown"`; caveats
    `GAUGE_NOT_ALL_CLEAR`, `THRESHOLDS_TODAY`, `PAST_NO_FORECAST`, plus `NO_USGS_SITE` / `USGS_429` /
    `GAUGES_UNAVAILABLE` per gauge; source `SOURCE_USGS`; a `lid` answer's gauge has `member: false`.
  - `river-gauges?bbox=` at a past time: `not_available_for_past_dates`, `PAST_AREA_GAUGES`; the fixture's fictional
    gauges and synthetic floods at a past time: `PAST_GAUGE_NOT_KEPT`.
- **Recorder** `backend/scripts/record_test_samples_flood_history.py` (9 requests on 2026-11-05 ~06:17 UTC) →
  `backend/tests/data/floods/iem/` (1.2 MB) with `PROVENANCE.md`: NWS Indianapolis and Louisville FL.W + FF.W of
  2025-04-01..05 (CSV + polygons), their gauges' map rows, two `vtec_event.py` answers (KIND.FL.W.0030.2025 at FREI3,
  KLMK.FF.W.0023.2025 CONSIDERABLE), NWPS FREI3 (no USGS site) and SERI3, USGS stage and flow of SERI3 for 04-04..06.

### M2 measured (2026-11-05)

- 2025: 1,976 floods (769 river: 563 moderate, 206 major; 1,207 flash, 47 emergencies) from 24 IEM requests + 5 map
  requests in 23 s, at most 24 IEM requests in one minute (≤ 30); cached for good (a rebuild made 1 new IEM request).
- 2026: 2,108 floods (607 river, 1,501 flash) from 22 IEM + 3 map requests in 25 s.
- Real API walk on 8760: the 2025 list (0.2 s from memory), a Kentucky river flood's detail (`resolved_from: year`),
  its archived products at `last_product_ms` (5 versions, verbatim), its past gauge readings, the 2026 list; every
  answer contract-valid (`contract_problems` empty).

## New backend-sent strings (`history.PAST_STRINGS`; for CONTRACT 16.14, integration)

They live in `floods/history.py` (`floods/copy.py` is not this role's file); `tests/test_floods_history.py` runs the
PLAN-5 §5.1 guard of `test_floods_copy.py` over them. The integration may move them into `copy.py`.

| Name | Text | Sent |
|---|---|---|
| `SOURCE_NAME` | National Weather Service, archived copy via the Iowa Environmental Mesonet (Iowa State University) | year lists' `iem_archive` source name |
| `ARCHIVE_DOWN` | The archive of NWS warnings (Iowa Environmental Mesonet) could not be reached right now, so past floods could not be listed. That is not an all-clear. | year list, IEM down |
| `ARCHIVE_PARTIAL` | Part of the archive of NWS warnings (Iowa Environmental Mesonet) could not be read ({months}); floods of those months may be missing. That is not an all-clear. | year list, some months failed (`stale: true`) |
| `YEAR_NOT_KEPT` | Fire-3d lists past floods for {years} only. That is not an all-clear. | a year outside 2025-2026 |
| `PAST_AREA_ALERTS` | Past NWS flood products are shown per flood: open a past flood to see its archived products. That is not an all-clear. | flood-alerts `bbox` at a past time |
| `PAST_AREA_GAUGES` | Past river gauge readings are shown per flood and per gauge; nearby gauges are not kept for past dates. That is not an all-clear. | river-gauges `bbox` at a past time |
| `PAST_ALERTS_DOWN` | The archive of NWS flood products (Iowa Environmental Mesonet) could not be reached right now. That is not an all-clear: follow local officials. | past flood-alerts, IEM down (reason; a caveat when only some events failed) |
| `NO_USGS_SITE` | NWS names no USGS site for this gauge, so its past readings are not available here. | past river-gauges caveat |
| `PAST_GAUGE_NOT_KEPT` | Past readings are not kept for this gauge. That is not an all-clear. | synthetic floods and fictional gauges at a past time |
| `PAST_BEFORE_FLOOD` | This flood's NWS products were sent after that time; Fire-3d shows a flood's products from its start. That is not an all-clear. | past flood-alerts before the flood's first product |

`ALERTS_PAST_NOT_YET`, `GAUGES_PAST_NOT_YET` and `PAST_NOT_YET` (copy.py) are no longer sent by the real API (the
fixture server keeps its canned answers).

## Deviations and interpretations

1. **Refresh jobs re-run the whole flood build** (`build_flood(force=True)`), not only the satellite and forecast
   layers (PLAN-5 3.5 "no terrain rebuild"): `floods/build.py` is not this role's file. Terrain and NAIP come from the
   HTTP cache when the area did not change (measured 3-49 s), and the job puts back the product versions and observed
   rows the bundle had. `built_ms` changes (the web reloads the bundle).
2. **The append step uses NWPS for at most 12 member gauges a cycle** and the list's own reading for the rest (no
   request); bundle checks for refreshes cost two cached requests per bundle (satellite catalog 6 h, forecast map 15
   min; both shared with the 2D routes). Neither counts against the prefetch budget (PLAN-5 names the budget for the
   prefetch only).
3. **Past years use one gauge per river flood** (no same-river join across gauges as the live list does): IEM's rows
   carry no river name, and the gauges' names come from one batched map request. A long river flood can show as
   several entries ("Clackamas River flood (OR)", "(OR, 2)").
4. **A past reading's category is `unknown`**: NWS's category of a past reading is not kept, and Fire-3d does not
   infer one from today's thresholds (the hydrograph still draws today's flood stages with `THRESHOLDS_TODAY`).
5. **Ownership:** three assertions in `backend/tests/test_flood_endpoint_contracts.py` (`test_past_times` is
   unchanged; `test_past_gauges_are_never_todays_readings` updated) and `backend/tests/test_floods_list_api.py`
   (`test_live_list_status_and_gzip`, historical part) encoded the pre-M2 placeholders (`GAUGES_PAST_NOT_YET`,
   `PAST_NOT_YET`) that M2 replaces by design. Their roles are finished and no running role owns them, and the gate
   needs them green, so they were updated deliberately with the same intent (never today's readings for a past time;
   the historical list's shape, without a background build in that test). Nothing else outside this role's files was
   edited.
6. **`build.gate` does not know past floods** (it calls `catalog.resolve`, which has no year step): "Prepare 3D data"
   for a past flood answers 404. Building a past flood's bundle would also need an `at_ms`-aware build (today's RFC
   map and model are wrong for a past flood). For the integration: either let `catalog.resolve` / `build.gate` use
   `api/floods._resolve`'s year step and teach `build_flood` past times, or have the web say that 3D data is prepared
   for current floods only.

## For the next roles

- **Integration:** fold this note into CONTRACT 16.16; add the strings above to CONTRACT 16.14 (or move them into
  `copy.py`); CONTRACT 16.7's historical row: `past_rule` is `"moderate_or_worse"`, `preparing` while building;
  CONTRACT 16.8: `PAST_RULE` used (the bulk route exists), `PAST_RULE_FALLBACK` unused; add `refreshed_ms` to 16.3;
  README: credit IEM's archive and USGS for past floods (SPEC §8.10). Deviation 6 (past-flood bundles) is yours.
- **Web roles:** past floods' rows have `mode: "historical"`, `status: "inactive"`, `max_category` from H-VTEC,
  `gauges_in_flood` 0 and `primary_gauge.observed_category` `"unknown"` (no reading); show the gauge without a reading
  rather than "below flood stage". `askedAt(summary)` (`last_product_ms`) gets the archived products and USGS readings.
  The 2026 tab may contain live rows (`mode: "live"`) for floods still listed.
- **Reviewer:** the real cycle and the real year builds are reproducible with `uv run python -m fire3d.cli catalog
  --hazard flood --mode historical --year 2025` (cached) and the API on port 8760 with `FIRE3D_LIVE=1
  FIRE3D_AUTO_BUILD_LIVE=0` (use a scratch `FIRE3D_DATA_DIR` copy of `data/floods`: the loop refreshes ready bundles).

## Review fixes (BFL-R1..R10; commit "brief 5 backend-flood-live: review fixes")

What changed against the sections above. Every finding is fixed; R9 needs one web string changed by the integration
(below).

### Live loop (`floods/live.py`)

- **One budget a cycle (R1, R7).** `PREFETCH_MAX` (20) now covers the prefetch **and** the append step's NWS and NWPS
  requests together. The prefetch takes at most `PREFETCH_MAX - APPEND_SHARE` (`APPEND_SHARE` = 8) with
  `PREFETCH_CAPS` hvtec 6 / zones 3 / series 3 (were 10 / 5 / 5 out of 20); `run_cycle` passes what is left to
  `refresh_bundles(..., budget=)`. In `append_bundle`, the products' answer (`zones.flood_alerts`) is fetched only
  when `alerts_cost(summary)` fits (the national answer when its 2-min copy expired, uncached zone outlines up to
  `ZONE_FETCH_MAX`, uncached product texts up to `HVTEC_FETCH_MAX`; read from caches only), else the products wait
  for a later cycle. Member gauge reads cost their exact NWPS requests (`_gauge_cost`: detail + series when not cached)
  out of the same budget, at most `GAUGE_READS_MAX` (`reads = {"left", "gauges"}`). The list's own reading is applied
  whenever it is newer than NWPS's cached one. `_hvtec_cost(a)` is now exact (0 when the list and product are cached).
- **Refreshes start only after a paced warm-up, outside the job workers (R1).** `refresh_bundles` no longer submits
  jobs: due refreshes go to `STATE.pending` (`fid -> (reason, summary)`) and `run_cycle` starts one runner task
  (`run_refreshes(jobs)`, task name `fire3d-flood-refreshes`, cancelled with the loop). For each due flood the runner
  calls `warm_nwps(summary, max_s=WARM_MAX_S)` in a worker thread: the member gauges' NWPS detail and series and the
  NWM reach series of forecast points are fetched into the HTTP cache only while `nwps.NWPS_LIMITER.remaining() >
  NWPS_RESERVE` (10 of 30 a minute stay free), polling every `WARM_POLL_S`, stopping after `WARM_MAX_S` (240 s); then
  it submits the `refresh` job. The first-cycle auto-build (`auto_build(jobs, ids, rows)`) warms the same way before
  each build. No job worker ever waits.
- **A refresh never makes a bundle worse (R1).** `refresh_job_fn` snapshots the earlier build's files
  (`snapshot(bdir, m)`: everything but the terrain), rebuilds, and then, under the build lock, runs
  `keep_what_the_rebuild_lost(bdir, old_m, snap, new_m, now=)` through `bundle.update_manifest` (validated strictly):
  - products: `merge_alerts` as before; an `unavailable` rebuild keeps the earlier answer **and** its `layer_status`;
  - gauges: `merge_rebuilt_gauges(older, rebuilt, members) -> (merged, kept)` (signature changed: it returns a tuple
    and takes the rebuilt summary's member lids): an `unavailable` rebuild keeps the earlier `gauges.json`; a member
    that the rebuild could read only from the NWS gauge map (`GAUGE_DETAIL_DOWN` and no impacts / reach / attribution)
    keeps its earlier NWPS detail with the map's newer reading (`keep_detail`); a member of the flood that the rebuild
    left out is put back; `GAUGE_DETAIL_DOWN` is dropped when no member is left with the map's reading only; the
    gauge credits (NWPS, data attributions, RFCs) are re-added through `build._gauge_credits`;
  - NWM series: earlier `model/nwm_series_<lid>.json` files of current members are put back (`files.model`, credit);
  - layers (`LAYER_PARTS`): `naip`, `water_forecast` (+ `maps/rfc_fim.geojson`), `floodplain` (+ `maps/nfhl.geojson`),
    `water_model` (+ `model/nwm_analysis.geojson`) and `water_satellite` (+ `satellite.json`, `satellite.png`) that were
    `ok` and are not now keep their earlier files, `layers` entry, `layer_status` (own time) and credit; satellite only
    when the rebuild's answer is an outage (`unavailable`, or a picture with `upstream_error`), never over NASA's
    `no_image` answer (as the satellite route);
  - the manifest's warnings lose the outage texts of what was kept and gain `REFRESH_KEPT` ("The refresh of {time}
    could not load {what} again; the earlier copy is kept, with its own time.", time in UTC). The job result has
    `kept`; `STATE.last_kept[fid]` records it.
- **Satellite passes tried survive a restart (R6).** `data/floods/live_state.json` (`LIVE_STATE_NAME`;
  `{"seen_passes": {fid: {"built_ms", "keys"}}}`, at most `SEEN_PASSES_MAX` keys per flood, floods with a bundle only).
  `new_passes(fid, m, passes, acq)`: with a measured image, passes newer than it and not tried (as before); without
  one, the passes listed at the first check after a build (sensed before it ran) are taken as the ones the build saw,
  so only passes that appear later count. `STATE.seen_passes` holds these records (was a set per flood).
- **Product text refused by Fire-3d's own limit is asked again (R8):** `prefetch`'s `hvtec` marks a product tried only
  after NWS answered (or failed), never on `SourceBusy`.

### Past floods (`floods/history.py`)

- **R2:** `row_product_ms(r)` = the row's own product id time, else `utc_polygon_begin`, else `utc_prodissue`;
  `events_from` sets `last_ms` to the newest product's time and `expire_ms` to **that product's** expiry (IEM keeps a
  long provisional expiry on early rows of "until further notice" warnings: 31 of 125 events in the recorded sample).
  So `last_product_ms`, `updated_ms` and `ended_ms` of a year row are the newest product's (LMK FL 50: 2025-04-26 16:10
  UTC, ended 04-27 10:14). `SCHEMA` = 2: the disk copies are rebuilt once (the month answers are cached).
- **R3:** `build_rows(events, year, *, reg, gauges, now=None, names=None)`: with `now` (the year build passes it), a
  group whose newest product had not expired is left out (the live list serves it). `canonical_rows(rows, reg)` maps
  served row ids through the registry's aliases at request time (merging rows that land on one id; `aliases` updated);
  `year_list` and `cached_rows` (so `find`) use it. The unused `_merge_event` is gone; `_merge` tolerates rows
  without `_keys`.
- **R10:** product refs carry `sender_name` = `sender_of(wfo, names)`: NWS's own sender name from this server's cached
  national answer (`office_names()`, no request), else "NWS <office id>" (e.g. "NWS LMK").
- **R9:** docstrings say "forecast or observed" (H-VTEC's severity). The rule is unchanged.
- New string `PAST_NO_BUNDLE` ("Fire-3d prepares 3D data for current floods only: NWS's forecast maps, the model and
  river forecasts are not kept for a past flood's dates.") in `PAST_STRINGS` (guard-tested).

### Routes (`api/floods.py`) and CLI

- **R3:** `_with_live_rows` (every year now, not only the current one) serves a year row as the live row that has its
  id **or any of its VTEC keys**, each live row once. `_resolve`: live -> year -> **an alias of a year row (canonical
  year row, `resolved_from: "alias"`)** -> `catalog.resolve`.
- **R4:** `POST /api/floods/{id}/build` resolves with `_resolve`; a year-list flood answers **409 `PAST_NO_BUNDLE`**
  (the web shows a 409's detail verbatim). `cli build-flood <past id>` refuses with the same text (exit 1).
- **R5:** `_past_at(summary, at_ms)`: a `mode: "historical"` summary asked without `at_ms` is answered at its
  `last_product_ms` (else `ended_ms`, `updated_ms`) by `/model` (so `not_available_for_past_dates`), `/maps` (rfc_fim,
  catfim; FEMA unchanged), `/satellite`, `flood-alerts?flood=` and `river-gauges?flood=`.
- `scripts/check_bundle.py --hazard flood` notes (not problems) member gauges of the summary missing from
  `gauges.json`, members with the gauge map's reading only, and `REFRESH_KEPT` warnings.

### For the integration and the web roles

- **R9 wording:** `PAST_RULE_NOTE` in `web/src/ui/shell/floodCopy.ts` (not this role's file) should say "river floods
  that reached **or were forecast to reach** moderate or major flood stage at an NWS gauge" (H-VTEC's severity is the
  forecast or observed severity); SPEC 8.10 says so now.
- CONTRACT 16.14: add `PAST_NO_BUNDLE` and `REFRESH_KEPT` (a manifest warning); 16.8: `PREFETCH_MAX` is the cycle's
  whole background budget (prefetch + append), `APPEND_SHARE` 8, `NWPS_RESERVE` 10; 16.7: build 409 for a past flood,
  and the default `at_ms` of a past flood's per-flood routes.
- Forensic (web): for a `mode: "historical"` flood the "Prepare 3D data" button could say `PAST_NO_BUNDLE` up front
  instead of offering a build that answers 409.
