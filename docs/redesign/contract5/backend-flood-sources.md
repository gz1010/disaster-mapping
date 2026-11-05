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
6. **Gauge episodes** (changed by the review fixes, BFS-R5): an open episode is reused until its flood has been quiet
   longer than `INACTIVE_LISTED_H` (48 h), judged from the flood's last-known summary (active: quiet since it was
   last seen; inactive: since `ended_ms`, never before the episode began), as PLAN-5 rule 10 says. Fire-3d's own
   build gaps (a server off overnight) never close an episode. Episodes of ids unseen for `INACTIVE_LISTED_H` are
   retired too, never during an outage.
7. **Last-known summaries** are written for every flood built from the current lists (the file's mtime is "last
   seen"); floods that left the lists are listed as `inactive` for 48 h from that time (rule 8 as fixed, below).
   During an outage an existing last-known summary is not overwritten.
8. **`resolved_from` for a synthetic bundle** (`fixture-flood`) is `"live"` (as the fixture server's canned detail),
   so the views do not show `FLOOD_LAST_KNOWN` on the demo; a real bundle answers `"bundle"`.
9. **Stale copies:** a failed source answers from its last cached copy (`status: available`, `stale: true`, reason from
   `STALE_REASON`); only without one does the source answer `unavailable` with `FLOOD_NWS_DOWN` /
   `FLOOD_GAUGES_DOWN` / `FLOOD_LISTS_DOWN` / `RFC_DOWN`.
10. **Watches attached to a flood** are listed in its `products` but their keys are not registered to it (a watch can
    attach to several floods).

## Review fixes (docs/redesign/reports/review5-backend-flood-sources.json)

Commit "brief 5 backend-flood-sources: review fixes". New or changed names:

- **Rule 8, a flood that left the lists (BFS-R1):** `catalog.as_left(summary, seen_ms, now_ms, *, nws_ok, gauges_ok,
  current=None) -> dict`. NWS answered: every product that left NWS's active list is `phase: "ended"` (a product NWS
  still lists keeps its phase now, `current` = `catalog.current_phases(prods)`, VTEC key -> phase); NWS could not be
  read: each keeps its last-known phase until its own NWS end time. `status`, `level`, `expires_ms` and `emergency`
  follow the products still in effect; with none the flood is `inactive`, keeps the level it last had (as a past flood
  does), `expires_ms: null`, `emergency: false`. The list's carry-overs, and the alias, bundle and last-known steps of
  `GET /api/floods/{id}`, all answer through it. A carry-over's "ended" phases are saved into its last-known summary
  with its old last-seen time, so a later outage never shows a dropped product as in effect again.
- **Outages (BFS-R4):** `catalog._listable`: a flood that left the lists is listed (inactive) only when Fire-3d can tell
  it is quiet: NWS answered, the gauges answered when it has gauges, and none of its products is listed now with
  another flood; otherwise it is not listed ("cannot decide"; its detail answers its last-known summary). While NWS
  cannot be read (no earlier copy), gauges whose open episodes belong to one flood id stay joined (`group(inp, now,
  reg)`), so a river flood keeps its id and does not split; such rows are gauge-only with caveat `ALERTS_UNAVAILABLE`
  (never `GAUGE_ONLY_CAVEAT`); product-only floods are not listed then. `catalog.nws_down_row(summary, now)` and
  `catalog.gauges_down_row(summary)` give the outage row of a normal row; `make_fixture.write_flood_edges` writes
  `edge/list-nws-down.json` and `edge/list-gauges-down.json` with them, and `test_floods_catalog.py` checks them
  against `build_list` on the recorded day. `build_list` also returns internal `_nws_ok`, `_gauges_ok`, `_phases`
  (dropped by `public_list`).
- **Gauge-only caveat (BFS-R2):** `FloodSummary.caveat` of a `gauge_only` flood is now one of three backend-sent
  strings, `catalog.gauge_only_caveat(members, nws_ok)`: `ALERTS_UNAVAILABLE` (NWS could not be read),
  **`GAUGE_ONLY_COASTAL_CAVEAT`** (new, `copy.py`): "No NWS Flood or Flash Flood product names this gauge right now. It
  may measure tidal or lake water: Fire-3d does not read NWS Coastal Flood or Lakeshore Flood products, which may be in
  effect here." for a gauge that may measure tidal or lake water, else `GAUGE_ONLY_CAVEAT`. A gauge is tidal by
  `grouping.is_tidal_row(row)`: SHEF code `pedts` HM / HC (`grouping.TIDAL_PE_CODES`; `nwps.parse_riv_row` now keeps
  `pedts`), a tidal datum note ("(in MHHW)", `grouping.TIDAL_DATUM_RE`), or a coastal word in its waterbody
  (`grouping.COASTAL_WATER_RE`: tide, pier, intracoastal, ocean, gulf, bay, sound, harbor, inlet, lagoon, beach, coast,
  the five Great Lakes); `grouping.coastal_lids(rows)` adds gauges within `COASTAL_NEAR_KM` (10 km) of one;
  `grouping.ref_looks_tidal(ref)` for a `FloodGaugeRef`. Today 19 of the 25 gauge-only floods (Florida tide and canal
  gauges) say it. D1 kept: they stay listed river floods. A carried-over gauge-only flood gets its caveat decided again.
- **Rule 2 (BFS-R3):** `naming.WHERE_RE` also takes "from" ("* WHERE...The Little Colorado River from Winslow to
  Leupp"), `naming.ALONG_RE` also "Flooding of the <water>"; `naming.text_names_water(water, *texts)` links a gauge
  inside a FL / FA area (+ 2 km) whose waterbody the segment's own text names (`naming.own_text` drops the "<River> near
  <Place> affecting <County>" lines that list a whole product's rivers). "Winslow flood" and the gauge-only "Little
  Colorado River flood" are one flood now (`tests/data/floods/catalog/cases.json` updated by hand review).
- **Rule 10 (BFS-R5):** `catalog.reusable_episode(reg, lid, now) -> (episode key | None, flood id | None)` (deviation 6
  above); `Registry.first_seen_of(flood_id)`.
- **Rule 10, continuation (new, found on the real list in the fix step):** `catalog.continuations(rows, claims, now,
  reg)`, `grouping.CONTINUE_KINDS = ("flash", "areal")`. NWS Pueblo replaced its Conejos River Flood Warning
  KPUB.FA.W.0026 with a new one, KPUB.FA.W.0028; the list showed two "Conejos River flood"s, the old one inactive (the
  web's inactive meaning would say no NWS product is in effect there). A new flash or areal flood with no registered
  member whose own products cover at least `AREAL_OVERLAP` of the last-known area (`bbox_lonlat`) of a flash or areal
  flood that left the lists within `INACTIVE_LISTED_H` continues it: same id and start, listed once, no alias. **For
  PLAN-5 rule 10 / CONTRACT 16.8 (integration).**
- **Rule 3 (BFS-R7):** `grouping.issued_ms(alert)`: the oldest message of the CAP `references` chain, else the VTEC
  begin when not after this message, else `sent_ms`. The `AREAL_NEAR_H` join compares issue times, so a CON / EXT
  update never splits a joined flood.
- **Strings (BFS-R8)** now in `floods/copy.py` under `test_floods_copy.py`'s guard, `copy.LIST_STRINGS` (name ->
  text): `GAUGE_ONLY_COASTAL_CAVEAT`, `RFC_DOWN`, `STALE_NWS`, `STALE_GAUGES`, `STALE_RFC`, `STALE_IEM`,
  `IEM_JOIN_DOWN`, `PAST_NOT_YET`, `FLOOD_NOT_LISTED_DETAIL` ("This flood is not listed.", the 404 detail),
  `IEM_JOIN_NAME`; `copy.SOURCE_NAMES` (source id -> name). `catalog.SOURCE_NAMES`, `RFC_DOWN`, `STALE_REASON`,
  `PAST_NOT_YET` stay as names that point there. **For CONTRACT 16.14 (integration):** add these texts; the
  `FloodSummary.caveat` comment in 16.2 becomes "level gauge_only: GAUGE_ONLY_CAVEAT, GAUGE_ONLY_COASTAL_CAVEAT or
  ALERTS_UNAVAILABLE; else null" (done in `contracts.py` and `floodTypes.ts`), and `products` "in effect or upcoming
  (live; "ended" once the flood left the lists)".
- **IEM credit (BFS-R10):** the live list's `sources[]` has a fourth entry, `{id: "iem_archive", name:
  IEM_JOIN_NAME ("Iowa Environmental Mesonet (copy of NWS flood warnings, used to link river gauges)")}`, `available`
  when the join answered, else `unavailable` with `IEM_JOIN_DOWN`; its outage never shortens the list cache
  (`catalog.MAIN_SOURCES`). The fixture's lists keep three sources (the web reads `nws_alerts` / `nwps_gauges` for a
  live list's health and `iem_archive` only for year lists). SPEC §2 now has rows for the flood list's sources (NWS
  flood products, `riv_gauges`, `rfc_max_forecast`, IEM current flood warnings, NWPS per gauge) with credit lines.
- **Recorder (BFS-R9):** `record_test_samples_floods.py` writes the answers' own fetch time and the real request
  count also when a re-run reads them back from `--cache-dir`; both `PROVENANCE.md` files corrected (13 requests,
  2026-11-04T22:15:38Z).

### Deviation: GET /api/floods with both lists down (BFS-R6)

CONTRACT 16.7 says `GET /api/floods` answers 503 `FLOOD_LISTS_DOWN` "only when no source and no bundle answered".
As built it **always answers 200**: with both lists down it lists the ready, non-synthetic flood bundles on disk
(possibly none) as they left the lists (`as_left`), every source `unavailable` with reason `FLOOD_LISTS_DOWN`, and
`products_in_effect: null`. Why: the sources say exactly what is unknown, and the web (web-flood-overview) already
reads it as "both down" and shows `FLOOD_LISTS_DOWN` ("… Not an all-clear: follow local officials.") with the bar
`FLOOD LISTS UNAVAILABLE`, never `FLOOD_LIST_EMPTY`; a 503 would only show the shorter `FLOOD_LISTS_503`. The web
handles a 503 too, so either can be chosen later. **For CONTRACT 16.7 (integration):** replace the 503 note by "200
with every source unavailable (`FLOOD_LISTS_DOWN`) and the bundles on disk". `GET /api/floods/{id}` keeps its 503
`FLOOD_LISTS_503` when the lists could not decide and nothing is on disk. SPEC §6 says so.

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
- **web roles, after the review fixes:**
  - web-flood-overview: copy (plain `cp`) the three changed edge answers `backend/tests/data/floods/fixture_api/edge/
    {list-nws-down,list-gauges-down,detail-last-known}.json` into `web/src/api/__fixtures__/floods/edge/`: NWS down is
    now gauge-only rows with no product and caveat `ALERTS_UNAVAILABLE` (the real path's shape), gauges down has no
    gauge-only flood, and the last-known detail has its products `ended` and `expires_ms: null`.
  - web-flood-public (circle meaning, §5.2): show `summary.caveat` as sent for a `gauge_only` flood, or at least never
    `CIRCLE_MEANING.gaugeOnly` ("No NWS flood product names this flood right now; …") when the caveat is
    `GAUGE_ONLY_COASTAL_CAVEAT` or `ALERTS_UNAVAILABLE`: that sentence is false for tide gauges and during an NWS outage.
  - Every view: `CIRCLE_MEANING.noProductNow` ("No NWS flood product is in effect here right now, …") only while the
    list's `nws_alerts` source is `available` (D24). During an NWS outage a gauge-only flood whose reading at flood
    stage is older than 6 h is still listed as `inactive`, with caveat `ALERTS_UNAVAILABLE`.
  - A live list's `sources[]` may carry `iem_archive` (the IEM join, name `IEM_JOIN_NAME`): credit it where the list's
    sources are credited; do not read it as the year archive in live mode.
