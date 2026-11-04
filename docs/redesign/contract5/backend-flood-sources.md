# As built: backend-flood-sources (brief 5)

Role `backend-flood-sources` (PLAN-5 §10.1). Milestones M1 contracts, M2 fixture, M3 sources, M4 catalog, on branch
`claude/cool-mayer-ki7to6`. This note lists the real names, signatures and routes, and every deviation from CONTRACT
§16 (the integration folds it into §16.16).

## Contract triple (M1)

- `backend/fire3d/contracts.py` "Brief 5: floods": every type of CONTRACT 16.2-16.6 with the same names and fields.
  Inline TS objects have named Python models: `FloodTimeRange` (`FloodManifest.time_range`), `FloodManifestFiles`
  (`.files`), `GaugeImpact` (`RiverGauge.impacts[]`), `GaugeAttribution` (`RiverGauge.data_attribution[]`),
  `FloodMapStats` (`FloodMapResponse.stats`), `SatelliteImage`, `SatelliteTiles`, `SatelliteStats`. Extra Python
  aliases: `ResolvedFrom`, `PastRule`, `NfhlAvailability`. `FloodReasonCode` / `SatelliteReasonCode` are Literals
  without `None` (fields are `X | None`). Fire models and unions are unchanged (tested).
- `web/src/api/floodTypes.ts`: CONTRACT 16.2-16.6 verbatim; `web/src/api/types.ts` ends with
  `export * from './floodTypes'`.
- `backend/tests/test_flood_contracts.py`: field names, optionality and every string-literal union (named and inline)
  between the two files.
- `SPEC.md`: §4.4 "Flood ids", §6 flood route rows, §8.8 "Flood catalog".

## Config, secrets, HTTP (M1)

- `config.FLOODS_DIR` (`DATA_DIR / "floods"`), `config.EARTHDATA_TOKEN` (env or `.env`, None allowed),
  `config.EARTHDATA_AUTH_HOSTS = ("archive.podaac.earthdata.nasa.gov",)`, `config.FLOODS_ENABLED` (`FIRE3D_FLOODS`,
  default on; **governs the flood live task only, the routes always answer**), `config.AUTO_BUILD_FLOODS`
  (`FIRE3D_AUTO_BUILD_FLOODS`, default = `FIRE3D_AUTO_BUILD_LIVE`).
- `config.mask_secrets(text)`: both secrets, any `Bearer <credential>` (also `Bearer%20`, dict reprs), and the values
  of `X-Amz-Security-Token`, `X-Amz-Signature`, `X-Amz-Credential` (`=`, `%3D`, `:` forms).
- `fire3d.http.check_auth_headers(url, headers)`: `ValueError` (no request made) for an `Authorization` header to
  anything but https on an allow-listed host. Called by `request()` / `get_*()` / `post_json()` and
  `stream_download(url, path, ..., headers=None)` (new keyword). Headers never enter a cache key. Tested with a fake
  token and a mock transport: PO.DAAC gets the header, the 303 pre-signed S3 redirect does not; no log record, error,
  URL or cache file holds the token or the `X-Amz-*` values (count-only).

## Fixed strings and credits (`backend/fire3d/floods/copy.py`)

- Every CONTRACT 16.14 name as a module constant, plus `CONTRACT_STRINGS` (name -> text), `catfim_note(category)`,
  `sat_caveat(date_time, cloud_pct)`. **Deviation:** the `SAT_CAVEAT` slot is written `{date_time}` (CONTRACT shows
  `{date, time}`); the text is otherwise identical (tested word for word against CONTRACT.md).
- Credit lines (16.15): `CREDIT_NWS`, `CREDIT_IEM`, `CREDIT_NWPS`, `CREDIT_NWC_EXPERIMENTAL`, `CREDIT_NWM`, `CREDIT_NFHL`,
  `CREDIT_OPERA_HLS`, `CREDIT_OPERA_S1`, `CREDIT_USGS`, `USGS_OBSERVATIONS`, `rfc_credit(rfc_name, office)`;
  `OfficialSource` dicts `SOURCE_NWS`, `SOURCE_IEM`, `SOURCE_NWPS`, `SOURCE_RFC_FIM`, `SOURCE_CATFIM`, `SOURCE_NFHL`,
  `SOURCE_OPERA_HLS`, `SOURCE_NWM`, `SOURCE_USGS` (for bundle-api's routes).

## Fixture (M2)

- `uv run python scripts/make_fixture.py --only flood [--now 2026-11-04T18:00:00Z] [--copy-api DIR]` (the default run
  now writes it too) -> `data/floods/fixture-flood/` in about 6 s. Builder: `build_flood_fixture(data_dir, now=None, *,
  copy_api=None) -> Path` in `scripts/make_fixture.py` (with `demo_floods`, `write_flood_edges`, `write_flood_extras`,
  `_sat_palette_rgba` (the PNG palette: 253 and 255 the same grey hatch, never transparent)).
- Contents as PLAN-5 7.1. Gauges ZZRF1 (moderate 17.6 ft, crest 18.0 ft = major − 1 at now + 30 h, issued now − 2 h,
  reach 9900004), ZZRF2 (action, `crest_at_end: true`), ZZRF3 (no_flooding, no reach, not a forecast point, nearby),
  ZZRF4 (obs_not_current, last reading now − 9 h, nearby). Products FL.W (NEW then EXT, ends now + 8 h, H-VTEC
  `ZZRF1.2.ER`), FA.Y, FA.A (zones NMZ901/NMZ902, geometry null). Satellite: one HLS granule 4 d 2 h old, cloud about
  25 %, a no-data strip, image ending at 86 % of the AOI's width (cells east of it are 255).
- Canned answers in `api/`: `list.json` (live), **`list-2025.json` and `list-2026.json` (historical)**, `status.json`,
  `detail.json`, `detail-<id>.json`, `flood-alerts.json`, `flood-alerts-<id>.json`, `river-gauges.json`,
  `river-gauges-<id>.json`, `river-gauges-<LID>.json` (with series), `river-gauges-national.json`,
  `maps-{rfc_fim,catfim,nfhl}.json`, `maps-catfim-ZZRF1-{moderate,major}.json`, `maps-<kind>-<id>.json` (all three
  kinds for each demo flood), `model-{nwm_analysis,nwm_5day,nwm_high_flow}.json`, `model-nwm_series-<LID>.json`
  (ZZRF3/ZZRF4 answer `unavailable`), `satellite.json`, `satellite.png`, `build-job.json` (queued -> running -> done),
  `local-alerts.json`, `evacuations.json`; `edge/` has `{alerts,gauges,rfc_fim,catfim,nfhl,satellite,model}-unavailable.json`
  plus `satellite-refused.json`, `satellite-picture.json`, `list-{nws-down,gauges-down,both-down,empty}.json`,
  `detail-last-known.json`.
- **Deviation:** `list.json` is the live list (fixture-flood + the six live demo floods); the 2025 demo flood
  (`fixture-flood-past`) is in `list-2025.json`, since a live list never carries a historical row.
- Synthetic answers credit their source as "Synthetic data for testing; not from: <credit>" (no screenshot credits NWS
  for synthetic data). The demo floods: `fixture-flood-flash` "Example Creek flash flood" (TX; Emergency, OBSERVED,
  CATASTROPHIC, no member gauge, ZZEC1 6 km away below stage, empty RFC FIM), `-major` "Sample River flood" (MO),
  `-moderate` "Demo Fork flood" (IA), `-minor` "Testbed Creek flood" (FL, gauge only), `-advisory` "Mockingbird Run
  flood" (AZ), `-watch` "Flood watch: Example Valley and 2 more areas" (CO, zones COZ991-993), `-past` "Placeholder
  River flood" (KY, 2025).
- Committed copy `backend/tests/data/floods/fixture_api/` (regenerate with `--copy-api`; a test checks it equals a fresh
  run). Pytest: `conftest.flood_fixture_data` / `flood_fixture_bundle` (session, generated into tmp at
  `FLOOD_FIXTURE_NOW_MS`), `conftest.load_script(name)`, `conftest.recorded_flood_inputs()`, fixture `flood_iso`.
- `scripts/serve_fixture.py`: `mount_flood_routes(app, data_dir, ...)` answers every CONTRACT 16.7 route from
  `data/floods/*/api/`; `?edge=` cases listed in its module doc; flood-alerts and river-gauges by `bbox` filter the
  canned answers (point queries set `covers_point`; every product including watches). It also answers
  `/api/official/local-alerts` and `/api/extras/evacuations` **only with `hazard=flood`** (fire requests 404 there, as
  before). Canned times are those of the generating run.

## Sources (M3)

- `sources/nws.py` (fire defaults unchanged): `FLOOD_EVENTS`, `FLOOD_PHENOMENA`, `EVENT_LABELS`,
  `normalize_alert(feature, family="fire")` (`"flood"` -> `normalize_flood_alert(feature)`: FloodAlert fields plus
  internal `_geometry`, `_zone_types`, `_same`, `_references`, `_awips`, `_vtec_begin_ms`, `_vtec_end_ms`,
  `_event_ending_ms`; VTEC `year` from the begin time, else the oldest CAP reference, else `sent`; `emergency` from
  damage threat CATASTROPHIC or "FLASH FLOOD EMERGENCY" in the text; `ends_ms` = ends ?? eventEndingTime),
  `vtec_key(v)`, `flood_url()`, `flood_active() -> FloodNational(alerts, fetched_ms, updated_ms, states, from_cache)`,
  `parse_hvtec(text)`, `parse_hvtec_for(text, alert)`, `product_list_url`, `product_url`, `pick_product_id`,
  `product_hvtec(alert)` (2 requests, cached for good), `cached_product_hvtec(alert)` (cache only, no request),
  `flood_phase`, `mentions_flood`, `local_in_scope(code, *texts, hazard="fire")`, `normalize_local_nws(f, hazard)`,
  `split_local(features, hazard)`, `past_local(..., hazard="fire")`, `NationalAnswer.local_flood` (the flood-scope local
  messages of the shared national request), `bypoint_events(..., phenomena=("FW",))`, `ArchiveEvent.event` from
  `EVENT_LABELS`.
- `sources/nwps.py`: `riv_gauges_observed(min)`, `riv_gauges_forecast(min)`, `riv_gauges_in_bbox(bbox)`,
  `rfc_max_forecast()`, `iem_current_flood_warnings()` (each `-> (rows, fetched_ms)`), `gauge(lid)`, `stageflow(lid)`,
  `reach_streamflow(reach_id, series)` (NWPS: timeout 20 s, one retry, `NWPS_DOWN` outage memory; a 404 is not an
  outage); parsers `parse_riv_row`, `parse_rfc_row`, `parse_iem_warning`, `series_rows`, `gauge_series`, `thresholds`,
  `crest_at_end(rows)`, `river_gauge(detail, sf, *, member, time_zone, with_series=False, state=None, county=None)`
  (a contract-valid `RiverGauge`), `nwm_series(doc, name)` (NWPS answers series under camelCase keys); helpers `num`,
  `utc_ms`, `category`, `status_where`, `gauge_page`.
- Measured on the recorded answers: `riv_gauges.obstime` is UTC (equals NWPS `validTime`); IEM
  `current_flood_warnings` rows **have no year**, so they join live products on `key4` = (office, phenomena,
  significance, ETN); `rfc_max_forecast` has **no last forecast step**, so its `crest_at_end` is read conservatively
  (the forecast minimum comes before its maximum); NWPS `dataAttribution[].title` is the credit text.
- Recorder `scripts/record_test_samples_floods.py` (13 requests on 2026-11-04 ~22:15 UTC); samples and
  `PROVENANCE.md` in `backend/tests/data/floods/{nws,nwps}/`.

## Catalog and routes (M4)

- `floods/catalog.py`: `fetch_inputs() -> Inputs`, `build_list(inputs, now) -> dict`, `flood_list(refresh=False)`,
  `public_list(lst)`, `live_status()`, `resolve(flood_id) -> (summary, resolved_from)` (raises `FloodNotFound` /
  `ListsUnavailable`), `reset_state()`, `county_geoms()`, `zone_counties(alert)`, `product_geom(alert)` (polygon, else
  the union of its SAME counties), `product_key(alert)` (VTEC key, else `CAP:<oldest reference>`), constants
  `LIST_TTL_S`, `LIST_TTL_DEGRADED_S`, `MAX_LIST_UPSTREAM_REQUESTS`, `WATCHES_SHOWN_BY_DEFAULT`, `RFC_DOWN`,
  `STALE_REASON`, `PAST_NOT_YET`.
- `floods/grouping.py`: CONTRACT 16.8 constants, `flood_rank`, `rank_key`, `sort_floods`, `same_river`,
  `river_matches`, `distance_km`, `overlap_share`, `keep_product`, `keep_gauge`, `product_class`, `product_level`.
- `floods/naming.py`: `make_flood_id(started_ms, name, anchor)`, `is_flood_id`, `flood_name(...)`,
  `river_from_text` (the segment's `* WHERE...` line first), `water_from_text`, `first_location`, `place_in`,
  `clean_water`, `dedupe_names`.
- `floods/registry.py`: `Registry` (`id_for`, `canonical`, `aliases_of`, `open_episode`, `keys_of`, `write`),
  `get_registry()`, `gauge_episode_key`, `write_last_known`, `read_last_known`, `iter_last_known`.
- `floods/store.py`: `valid_id`, `flood_dir`, `registry_path`, `last_known_path`, `load_flood_manifest`, `bundle_state`,
  `list_flood_bundles`.
- `api/floods.py` (`router`, mounted in `api/app.py` by one import and one `include_router` line): `GET /api/floods`
  (live; historical answers an empty list whose `iem_archive` source says `PAST_NOT_YET` until backend-flood-live M2),
  `GET /api/floods/status` (from the list: `last_refresh_ms` = its build time, `next_refresh_ms` = + TTL,
  `auto_build` = `AUTO_BUILD_FLOODS and LIVE_ENABLED`), `GET /api/floods/{id}` (404 `{"detail": "This flood is not
  listed."}`, 503 `{"detail": FLOOD_LISTS_503}`).

### Deviations and interpretations (catalog)

1. **Rule 2 for areal products:** an FA.* product links a gauge at action or worse inside its polygon (+ 2 km) on the
   water its text names ("along the Silver Creek"), by the same test as river products. Without it today's list had
   two "Silver Creek flood"s (a gauge-only flood and an areal warning on the same creek). Such a flood is kind river.
2. **Forecast-only members:** a gauge linked by H-VTEC / IEM that is observed below action but forecast at minor or
   worse is a member with `observed_category: "unknown"` (the national answers only list gauges at action or above).
3. **Gauge names in the list:** `riv_gauges` has no NWPS gauge name, so `FloodGaugeRef.name` is "<location>
   (<waterbody>)", both verbatim NWS fields ("Agency (Platte River)"); the detail routes use NWPS's own name.
4. **Waterbody values that name no river** ("Tide Station", "... Tide Gauge") never join by same river and never name a
   flood (the nearest gazetteer place does); datum notes ("(in NAVD88)") are dropped from names.
5. **Duplicate names:** the state, then a place-based name, then a number ("San Juan River flood (UT, 2)").
6. **Gauge episodes:** an open episode is reused only when its flood was last built within `GAUGE_ACTIVE_H`;
   otherwise it is retired and a new episode (new id) starts. Episodes of ids unseen for `INACTIVE_LISTED_H` are
   retired too.
7. **Last-known summaries** are written for every flood built from the current lists (the file's mtime is "last
   seen"); floods that left the lists are listed as `inactive` for 48 h from that time.
8. **`resolved_from` for a synthetic bundle** (`fixture-flood`) is `"live"` (as the fixture server's canned detail),
   so the views do not show `FLOOD_LAST_KNOWN` on the demo; a real bundle answers `"bundle"`.
9. **Stale copies:** a failed source answers from its last cached copy (`status: available`, `stale: true`, reason from
   `STALE_REASON`); only without one does the source answer `unavailable` with `FLOOD_NWS_DOWN` /
   `FLOOD_GAUGES_DOWN` / `FLOOD_LISTS_DOWN` / `RFC_DOWN`.
10. **Watches attached to a flood** are listed in its `products` but their keys are not registered to it (a watch can
    attach to several floods).

## For the next roles

- **backend-flood-bundle-api:** `api/floods.py` is yours next (add the routes there). Use `catalog.resolve` for the build
  gate and summaries, `nwps.river_gauge` for `RiverGauge`, `catalog.product_geom` / `zone_counties` for zone-based
  products (`ZONES_AS_COUNTIES`), `nws.NationalAnswer.local_flood` for `local-alerts?hazard=flood`, the `SOURCE_*`
  dicts and strings of `floods/copy.py`, `make_fixture._sat_palette_rgba` as the palette reference.
- **backend-flood-live:** call `catalog.flood_list(refresh=True)` each cycle; `nws.product_hvtec(alert)` is the
  background H-VTEC fetch (the list reads it back with `cached_product_hvtec`); put the loop's times into
  `/api/floods/status`; add the year step to `catalog.resolve` and the historical lists to `GET /api/floods`.
- **web roles:** the fixture's historical lists are separate files (`list-2025.json`, `list-2026.json`);
  `detail.json` has `resolved_from: "live"`; synthetic answers' `source.credit` starts "Synthetic data for testing".
