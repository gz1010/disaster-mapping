Recorded 2026-11-05T00:11:27Z by `backend/scripts/record_test_samples_flood_maps.py` (5 real requests through `fire3d.http`, 16 read back from an earlier run's --cache-dir, one at a time, User-Agent "Fire-3d/0.1 test-sample recorder", no key or token). Area: gauge AGYM7, box `-94.80,39.62,-94.60,39.76`. Untrimmed answers.

FEMA National Flood Hazard Layer (effective), provided "as is" by FEMA (https://www.arcgis.com/home/item.html?id=ae38b6f94eaf4abf97f986fa01921e13).

* `zones.json`: layer 28, `SFHA_TF='T' OR ZONE_SUBTY LIKE '0.2%'` (3 zones, simplified 0.0002 deg).
* `availability.json`: layer 0 (NFHL availability).
* `panels.json`: layer 3 FIRM panels, `EFF_DATE` only (13).
