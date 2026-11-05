# Brief 6 · final-check · as built

The last step of brief 6 (BRIEF-6 role table, order 3): gates, the final screenshot set, a scratch Playwright smoke
run, count-only scans, the README's flood text and pictures, and the report
`docs/redesign/reports/final-verification-6.json` (with the plain-words user summary). No app code was changed.

## What changed in the repository

| File | Change |
|---|---|
| `README.md` | Screenshots section re-shot with `brief6-final-*.png` (overviews, Public and Command flood, Command fire, Forensic fire, a "Flood time steps" pair and a 3D before / after pair on the real Calcasieu River flood, height above the river, time steps in 3D); new "Flood time steps (Command and Forensic)" paragraph; the Forensic flood paragraph now lists River view, Height boost, Estimated depth and Height above the river with their on-screen labels; the Keyboard line names Space, comma and full stop for floods; four new rows in "A few words explained" (Satellite pass, Height boost, Estimated depth, Height above the river); the experimental column of the "official / measured / experimental" table names the 3D estimates; two new Known limits → Floods items (time steps show only what was seen; the 3D estimates are rough); the demo-flood commands add `scripts/flood_3d.py fixture-flood` after `make_fixture.py --only flood` (without it the demo has one pass and no 3D terrain products); the docs map links `contract6/`. |
| `docs/screenshots/brief6-final-*.png` | 33 final screenshots (list in the report). |
| `docs/redesign/CONTRACT.md` | §17: a "Final check" pointer to this note. |
| `docs/redesign/progress/brief6-final-check.md`, `docs/redesign/reports/final-verification-6.json`, this note | the step's record. |

## Screenshot recipes (for a later re-shoot)

Run from `web/` with `node scripts/shot.mjs <url> <out> --backend swiftshader --w 1440 --h 1000` and:

- a flood step in Command or Forensic: `--reduced-motion --eval-after-wait "<js>"`, where the JS clicks
  `.hg-play-btn.is-play` once (reduced motion: one step per press, the first step) and then
  `[aria-label="Next time step"]` until `.hg-step-label` matches, e.g. `/Satellite pass Oct 25/` or `/NWS/`; the
  "NWS · n" list opens with `.hg-nws-btn`;
- the 3D "before" look: `--eval-after-wait "const f=window.__forensicFlood.getState(); f.setBoost('<id>',1.5);
  f.setLayerVisible('depth',false); window.__sceneStore.getState().issueCameraCommand('frame-fire')"` (brief 5's height
  and framing, no depth surface); "after" is the default open; height above the river:
  `window.__forensicFlood.getState().setLayerVisible('hand',true)`; Forensic needs `--quality low --shot-timeout 240000`
  and `--wait 45000` under SwiftShader;
- zoom dimming on: `--eval-after-wait "window.__workspace.getState().setZoomDimming(true)"`; the switch:
  `setPanel('layers', true)`, then scroll the label "Zoom dimming" into view.

## Smoke checks (scratch script, not in the repository)

`smoke6.mjs` in the session scratchpad: Chrome + SwiftShader against API 8767 / Vite 5227 (FIRE3D_LIVE=0, real network
for the live lists and the time history). Parts: `copy` (18 views: no old name seen or heard, the name in the bar where
the bar has a brand and in the page title, both fixed lines visible, no banned safety word outside `data-verbatim`
text, no console error), `playback` (Command, Calcasieu River: buttons and group name, no autoplay, Play runs and Pause
stops, Play stops at the latest step, comma / full stop / Space, pass label, the legend follows the pass, the
"Shown: …" gap words between passes, the "NWS · n" list, Public returns to now), `motion` (reduced motion in Command and
the Forensic dock: no autoplay, one step per press, no timer, no running animation) and `dimming` (off by default, the
switch in Layers & settings → Display, remembered across pages, off again).
