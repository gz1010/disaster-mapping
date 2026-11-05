# Brief 5: floods across the lower 48 states (Nov 4, 2026)

The user asked: "Execute the flood part, 48 states, you have the UI." The design is the flood screen of the brief-4 handoff
(`docs/redesign/handoff-4/screens/FloodView.dc.html`, rendered in `handoff-4/renders/FloodView.jpg`). Its layout matches
the Public fire view. Its hazard circle shows muddy grey-green rushing water (two noise layers scrolling sideways, a mist
band, slanted rain, grain), and every value on it is a placeholder.

Starting point: branch `claude/cool-mayer-ki7to6` at 2179fb5. That is brief 4 merged in `main` (8b00b9e), plus the macOS
file-name fix.

## Decisions (answered Nov 4, 2026)

1. **One flood = warnings + gauges.** A flood event is a group of the following, gathered per river or area and named like
   "Animas River flood":
   - NWS flood products in effect: Flood Warning, Flash Flood Warning, Flood Watch, Flood Advisory, and their statements;
   - river gauges at or above flood stage.

   Floods share the national map with fires, behind a **Fires / Floods** switch.
2. **Flooded area: official maps plus satellite water.** These layers, each with its own source, time and wording:
   - NWS / NOAA forecast-based flooded-area maps where they exist;
   - the warning polygons;
   - gauges coloured by flood category;
   - FEMA's 100-year floodplain as background;
   - **water seen by satellite** (NASA OPERA).

   The satellite layer needs a free NASA Earthdata login. That is a **second secret**, approved by the user in this
   answer. The app must work without it, and say plainly when it is not set up.
3. **Forecast: NWS river forecasts + NOAA's National Water Model.**
   - NWS forecasts are official information: keep the issuer, its own times, verbatim wording and a link.
   - The National Water Model is labelled as experimental **model output** and is never merged with official
     information.
   - There is **no Fire-3d flood model**.
4. **Views: all three.** The Public overview and flood view (from the design), a Command flood view, and a Forensic 3D
   flood view (the flood extent draped on the terrain). Command and Forensic have no flood mockups: derive them from
   the fire versions in the same design system.

Process: as brief 4. Audit and research, then plan, then build in parallel waves. Each part gets one independent review,
then a final check with the gates and screenshots. Report at milestones.

## Data sources seen working from the cloud (Nov 4, 2026; terms still to be checked on each official page)

- **NWS alerts:** `api.weather.gov/alerts`. 42 active flood products at the time of the check, 35 of them Flood Warnings.
  Past alerts come from the IEM archive, as brief 3 does for Red Flag Warnings.
- **NOAA National Water Prediction Service gauges:** `api.water.noaa.gov/nwps/v1/gauges`. It gives flood categories,
  observed and forecast stage and flow, and RFC forecasts. A bbox query works by region; one lower-48 query timed out.
- **NOAA water map services:** `maps.water.noaa.gov/server/rest/services`. The folders are `rfc`, `nwm`, `fim_libs` and
  `flash`; `rfc/rfc_based_5day_max_inundation_extent` is an official forecast-based flooded area.
- **USGS water data:** `api.waterdata.usgs.gov/ogcapi/v0`. It has measured stage and discharge. The legacy
  `waterservices.usgs.gov/nwis` also answers but is being retired.
- **FEMA National Flood Hazard Layer:** `hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer`. It answers, but
  the connection drops at times.
- **NASA OPERA surface water (DSWx):** found in NASA's catalogue (CMR); downloading the data needs Earthdata login.

## Standing rules (unchanged unless said)

- Model output is experimental and never advice on when to evacuate ("Follow local officials"). Never say "safe" or
  "low risk"; outside the mapped or modeled area is unknown, not low. A gauge below flood stage, a missing warning or
  dry satellite pixels are **never an all-clear**.
- Official information (NWS products, RFC forecasts, flood categories, evacuation orders, FEMA zones) keeps its issuer,
  its own times, its verbatim wording and a link. It is never merged with model output, and its absence is never an
  all-clear.
- Every view keeps "Research prototype — not for operational use" and "Not an all-clear. Follow local officials."
  Every animation stops under `prefers-reduced-motion`.
- No Google data, no paid map services, no Nominatim. Credit every source, and check the terms of each new source on
  its official page. Use polite request rates through `fire3d.http`.
- Secrets: `FIRMS_MAP_KEY` and now the NASA Earthdata user token `EARTHDATA_TOKEN` (decision 2). Both come only from the environment or
  the gitignored `.env`. Never print, log, commit or copy either one. Check for leaks with count-only scans.
- Never use the name "FireTrace". Never commit `data/` or `.env`. Add a dependency only when it is clearly needed, and
  say why. No file names in one folder that differ only by case (`web/src/lib/fileNames.test.ts`).
- Gates: `cd backend && uv run pytest -q`; `cd web && npm run typecheck && npm run lint && npm test && npm run build`.
  The lint baseline is 55 warnings, all in `src/scene`; add none. Keep `SPEC.md`, `backend/fire3d/contracts.py` and
  `web/src/api/types.ts` consistent.
- Keep everything that works for fires working. Brief 4's UI decisions stay (PLAN-4 §11), including the simple
  selected-point marker.
