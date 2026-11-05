# Progress: backend-flood-live (brief 5)

Role `backend-flood-live` (PLAN-5 §3.5-3.6, §10.1; plan5-roles.json). Ports API 8760 / Vite 5220.

## Status

- [ ] M1 live: `floods/live.py` (second task in the lifespan, refresh of ready bundles, prefetch budget, auto-build of
  4), `/api/floods/status` from the loop, CLI `catalog --hazard flood` / `build-flood`, `check_bundle --hazard flood`,
  SPEC §8.9, tests, one real cycle on 8760.
- [ ] M2 (cut line, U1 (a)) past floods: `floods/history.py`, `mode=historical&year=`, the detail chain's year step,
  IEM archive at past times, USGS observations, recorder + samples, tests.
- [ ] Final: gates, report, as-built note, push.

## Log

- 2026-11-05: read BRIEF-5, PLAN-5, CONTRACT §16, the part-1 results and the as-built notes. Started M1.
  Ownership: I do not own `floods/catalog.py`, `zones.py`, `gauges.py` or `build.py`; the year step and past answers
  are added in `api/floods.py` (mine) around them.
