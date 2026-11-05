Recorded 2026-11-05T00:11:27Z by `backend/scripts/record_test_samples_flood_maps.py` (5 real requests through `fire3d.http`, 16 read back from an earlier run's --cache-dir, one at a time, User-Agent "Fire-3d/0.1 test-sample recorder", no key or token). Area: gauge AGYM7, box `-94.80,39.62,-94.60,39.76`. Untrimmed answers.

NASA JPL OPERA DSWx (PO.DAAC, doi:10.5067/OPDSW-PL3V1), contains modified Copernicus Sentinel data; NASA open data (CC0). No login was used.

* `egis_query.json`: Earthdata GIS DSWx-HLS catalog, last 20 days (15 granules, 9 passes).
* `egis_probe_0.tif`: pass `DSWx-HLS_20261029T1706_L8` locked (160 x 112 px, lon/lat; clear share 0.00).
* `egis_probe_1.tif`: pass `DSWx-HLS_20261025T1714_S2B` locked (160 x 112 px, lon/lat; clear share 0.99).
* `egis_probe_2.tif`: pass `DSWx-HLS_20261023T1654_L9` locked (160 x 112 px, lon/lat; clear share 0.73).
* `egis_probe_3.tif`: pass `DSWx-HLS_20261022T1703_S2B` locked (160 x 112 px, lon/lat; clear share 1.00).
* `egis_export.tif`: pass `DSWx-HLS_20261025T1714_S2B` locked, 400 x 361 px (classes [0, 1, 2, 252, 253]).
* `cmr_s1.json`, `cmr_hls.json`: NASA CMR granule searches (no login).
* `gibs_domain.xml`: GIBS DescribeDomains of `OPERA_L3_Dynamic_Surface_Water_Extent-HLS`.
