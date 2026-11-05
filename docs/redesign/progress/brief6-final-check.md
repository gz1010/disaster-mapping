# Brief 6 final check: progress

Role: final-check. Ports: API 8767, Vite 5227 (fixture server, if needed: 8768). Started 2026-11-05T16:56Z.

## Steps

- [x] 1. Working tree clean at 3265d56 (nothing of the build uncommitted).
- [x] 2. Full gates at 3265d56: backend 1466 passed, 0 skipped; web typecheck ok, lint 55 warnings (all src/scene),
      151 files 1917 passed + 2 skipped, build ok.
- [x] 3. 27 final screenshots docs/screenshots/brief6-final-*.png, each viewed (list in the report).
- [x] 4. Scratch Playwright smoke: 134/134 (copy 108 on 18 views, playback 13, reduced motion 7, dimming 6); top-bar check 24/24.
- [x] 5. Count-only scans: FIRMS key 0 (tracked files, diffs, messages since 8ae4614), EARTHDATA_TOKEN not set, FireTrace 0 in code/UI, safe / low risk 0 in UI copy.
- [x] 6. README flood paragraphs and pictures, report final-verification-6.json (+ brief6-final-check.json pointer), as-built note contract6/final-check.md, CONTRACT §17 pointer; committed and pushed.

## Notes
- Smoke: the first copy run counted the Public / Command fire and flood bars (no brand by design since brief 4) as
  failures; the check now requires the name in the page title everywhere and in the bar only where it has a brand.
- Smoke: two playback runs failed on test timing under SwiftShader (a Pause click landing after Play's last step; a
  Previous loop on a disabled button), not on the app; the third run times Play/Pause inside the page: 13/13.
- Fire views vs brief 5 with dimming on: Public 0.06 %, Command 0.22 %, Forensic 0.02 % below the bar.
- README: corrected one known-limit clause after checking that the readout follows the step (WFP-R2 fixed it).
- Servers on 8767 and 5227 stopped at the end.
