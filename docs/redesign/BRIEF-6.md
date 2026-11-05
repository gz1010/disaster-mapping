# Brief 6: rename to Disaster Mapping, flood time steps, a clearer 3D flood view, dimming off by default (Nov 5, 2026)

Starting point: `main` at 6eaaa8f (brief 5, floods, merged by the user as PR #5). The branch `claude/cool-mayer-ki7to6`
was restarted from it.

## The request (user's words, lightly cleaned)

- "I changed the name to disaster-mapping, we need a new README." "Update the README and everything from Fire-3d to
  Disaster Mapping."
- "Why can't I have flood animation? Is there no data for this?"
- "Forensic in flood doesn't have a great effect because the terrain is flat and we can't really see the affected
  areas. What should be the fix?"
- "You know how we have the zooming-in dimming? Let's default that to off, with an option to turn it on."

## Decisions (answered Nov 5, 2026)

1. **Rename: name and docs.** "Disaster Mapping" replaces "Fire-3d" everywhere a person sees it:
   - in the app: logo text, page title, top bar, every user-facing sentence, sent by either the web or the backend;
   - in the docs: README.md, rewritten as a new README for a fires-and-floods app, plus CLAUDE.md, SPEC.md's title and
     intro, and the current-facing parts of docs/;
   - in the outgoing User-Agent, which names the app.

   Internal code names stay, so `.env`, `data/`, saved preferences and old links keep working: the `fire3d` Python
   package, the `FIRE3D_*` settings, URL parameters, storage keys and CSS classes. Historical documents keep their
   wording, because they record what was built and when: earlier BRIEF-*.md, PLAN-*.md, reports, audits and progress
   notes. The GitHub repository is now `gz1010/disaster-mapping` (renamed by the user on Nov 5; the old URL redirects): docs that name the repository or its clone URL use the new name. The rule "never use the name FireTrace" still applies.
2. **Flood animation: satellite passes and NWS warnings over time.** For an open flood, the time handle in Command (the
   river-level chart) and in Forensic (its dock) gains Play and step controls:
   - **Satellite passes:** they step one by one through the flood's usable passes. Each shows its own date and age, with
     no-view hatching for clouds or missing data.
   - **NWS warnings:** they appear and disappear at their own issue and end times, from the live NWS feed and the IEM
     archive for earlier products of the same event.

   Nothing is drawn between passes. No water is interpolated or invented between two images, and the app says so ("No
   satellite image between Oct 29 and Nov 3"). The river-level line keeps its measured and forecast parts. The Public
   view stays without a timeline, as decided for fires in brief 4.
3. **The 3D flood view, all four fixes:**
   - **Automatic height boost** in flat places, from the relief of the flood's area. The factor is always on screen
     ("Height ×5"), and the user can change it.
   - **Water as a 3D surface with depth tint**, where the data allows. Inside the mapped water (satellite water, or the
     NWS forecast area where no image exists), a water surface is estimated from the terrain height along the water's
     edge (the published FwDET method: Cohen et al., Floodwater Depth Estimation Tool). Deeper water is a darker blue.
     It is labelled "Estimated depth (from the terrain at the water's edge), experimental", and it is never shown
     where there is no mapped water.
   - **Low-ground shading:** height above the nearest river channel (HAND, computed from the terrain and the river
     lines the flood bundle already has). Land within a few metres of the river is tinted. It is labelled "Height above
     the river (from terrain). Not a flood map", and it is off by default.
   - **Closer framing:** when a flood opens, a lower, closer camera along the main river.
4. **Zoom dimming (the globe-like vignette) is off by default.** A switch in the Layers / settings panel turns it on.
   The choice is remembered in this browser.

Process: the brief-5 pattern at a smaller scale. Roles with disjoint files build in parallel, at most two at once.
Each role gets one independent review (design and contract fidelity, plus behaviour and safety) and a fix step. Then
a final check runs the gates, takes screenshots, and scans for secrets and banned wording.

## Roles

| Order | Role | Owns | Depends on |
|---|---|---|---|
| 1 | `rename-docs` | Every user-facing string that says Fire-3d (web/src, backend/fire3d copy and messages, index.html title, the User-Agent), with their tests updated deliberately; README.md (new), CLAUDE.md (name only; the rules unchanged), docs/validation.md and other current-facing docs; the dimming switch (map/MapAtmosphere.tsx, styles/atmosphere.css, its toggle in the Layers / settings panel, the workspace or preference state that holds it). Not: SPEC.md (role 2 renames its title), new files of other roles. | — |
| 1 | `backend-flood-time-3d` | New backend modules for (a) a flood's satellite pass history (every usable pass in the flood window, each with its own image, time, cloud and no-data share, from the existing OPERA / Earthdata GIS route) and its NWS product history (all products of the flood's events with polygons and issue / end times, live plus the IEM archive); (b) 3D terrain products in the flood bundle: relief statistics for the automatic height boost, HAND (height above the nearest channel from the DEM and the NWM flowlines) and the FwDET depth estimate per mapped water layer, as rasters. Owns the related routes in api/floods.py, floods/build.py additions, contracts (contracts.py, web/src/api/floodTypes.ts), SPEC.md (its new sections and the title line rename), the backend tests. New user-facing strings go in a new module, not into existing copy files. | — |
| 2 | `web-flood-playback` | The Play and step controls and keyframes on the river-level chart (ui/timeline/Hydrograph*, hydrographModel), a pure shared helper web/src/state/floodTimeline.ts (keyframes, pass at time, products at time) pushed as its first milestone, the 2D map layers following the selected pass (map/floodAreaLayers.ts, map/floodCommandLayers.ts), wording for gaps. | backend-flood-time-3d |
| 2 | `web-forensic-flood-3d` | scene/flood/** and the flood parts of the Forensic scene: height boost and its label and control, water surface with depth tint, low-ground shading layer (off by default), closer framing, drapes following the pass from floodTimeline.ts. | backend-flood-time-3d, and web-flood-playback's first milestone (floodTimeline.ts) |
| 3 | `final-check` | Gates, screenshots (renamed app, flood playback steps, 3D before / after on two real floods, dimming off and on, fire views unchanged apart from the name), scans, report with a plain-words user summary. | all |

## Standing rules (unchanged)

All rules of CLAUDE.md and BRIEF-5 apply. Their safety parts:
- Model and estimate output is experimental and never evacuation advice.
- Official information keeps its issuer, its own times, verbatim wording and a link, and is never merged with model
  output. Its absence is never an all-clear.
- Dry or no-data pixels, an empty height-above-river tint or a shallow depth estimate are never an all-clear.
- Every view keeps "Research prototype — not for operational use" and "Not an all-clear. Follow local officials."
- Every animation stops under `prefers-reduced-motion`. Playback must not autoplay under reduced motion.
- Secrets: `FIRMS_MAP_KEY` and `EARTHDATA_TOKEN`, count-only scans.
- No new dependency unless clearly needed.
- No file names in one folder that differ only by case.
- Gates: backend `uv run pytest -q`; web `npm run typecheck && npm run lint && npm test && npm run build`. The lint
  baseline is 55 warnings, all in `src/scene`; add none.
