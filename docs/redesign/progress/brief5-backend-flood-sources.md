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

## Next

- M2 fixture, M3 sources, M4 catalog + routes.
