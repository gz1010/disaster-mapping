# brief 6 · web-forensic-flood-3d · progress

Role: the 3D flood view's height boost, depth surface, low-ground (HAND) layer, closer framing, drapes following the
playback pass. Ports API 8764, Vite 5224.

- [x] Read BRIEF-6, contract6/backend-flood-time-3d.md, contract5/web-flood-forensic.md, CONTRACT §16-17.
- [x] Before screenshots: docs/screenshots/brief6-web-forensic-flood-3d-before-{fixture,stjohns,calcasieu}.png
- [x] M1 height boost (auto from manifest.terrain3d.relief or the same rule on the grid, "Height ×N · auto" in the view dock, kept on phones; key line; per-flood user choice; fire value restored)
- [x] M2 depth surface (FwDET mesh, depth tint) + height above the river (HAND drape, off by default) + key / Layers tab / hover rows
- [x] M3 river view (lower, closer, along the main river; 'River view' entry control; hand-off keeps it when the map was wider)
- [x] M4 drapes follow passAt(handle): kept pass classes + own depth from the bundle, else the route's picture (no depth, said so), else nothing before the first pass; key, Layers tab date, hover readout and the image edge follow
- [x] Final: screenshots (after fixture / St Johns / Calcasieu, low ground fixture + Calcasieu, St Johns kept pass with its depth and a picture-only pass, phone, fire regression), gates (backend 1466 passed; web typecheck, lint 55 all src/scene, 149 test files pass, build), report, contract6 note, CONTRACT 17 pointer

Notes:
- The orchestrator's snapshot ee6ac13 holds most of M1-M3's code; the milestone commit adds the rest.
- WIP screenshots in the scratchpad looked right on fixture-flood, St Johns (×10, river view looking north) and
  Calcasieu (×10; satellite water there is a few ponds, the NWS forecast area and the no-view hatch dominate).
- Final polish: phones show "River" and the dock keeps "Height ×3" (depth of field and full screen give way); the
  3D warning lines and the hover's NWS rows follow productsAt (time history before now).
