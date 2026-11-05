#!/usr/bin/env node
// Checks that the overview top bar's items do not cover each other on desktop widths (brief 6 review RD-R1).
//
//   node scripts/check-topbar.mjs <base-url> [--widths 1024,1100,1180,1279,1280,1440] [--h 900] [--wait 4000]
//        [--backend auto|swiftshader]
//
// For every width, in Public and Command, for Fires and Floods (`/?preset=<p>&hazard=<h>`), it measures the
// overview bar (`.mw-header`): the left side's items (logo, name, place, the Fires | Floods switch), the centre view
// pill and the right side's items must not overlap, and the middle of each Fires / Floods / view button must hit that
// button (document.elementFromPoint). It prints one line per page and exits 1 when any check fails.
// The longer name "Disaster Mapping" covered the Floods button under the centre pill at 1024-1150 px (RD-R1); the name
// word now hides in that bar up to 1279 px (styles/map-layout.css), the logo and the accessible name stay.
import { chromium } from 'playwright'

function parseArgs(argv) {
  const opts = { widths: [1024, 1100, 1180, 1279, 1280, 1440], h: 900, wait: 4000, backend: 'auto' }
  const pos = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--widths') opts.widths = next().split(',').map(Number)
    else if (a === '--h') opts.h = Number(next())
    else if (a === '--wait') opts.wait = Number(next())
    else if (a === '--backend') opts.backend = next()
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`)
    else pos.push(a)
  }
  if (pos.length !== 1) throw new Error('usage: node scripts/check-topbar.mjs <base-url> [--widths a,b,c] [--h px] [--wait ms] [--backend auto|swiftshader]')
  return { base: pos[0].replace(/\/$/, ''), ...opts }
}

/** Runs in the page: the bar's item boxes and the hit test of every switch button. */
function measure() {
  const bar = document.querySelector('.mw-header')
  if (!bar) return { error: 'no .mw-header' }
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none'
  }
  const box = (el) => {
    const r = el.getBoundingClientRect()
    return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) }
  }
  // the leaves of each slot: the elements a person sees and clicks (text spans, buttons, the logo)
  const items = (slot) => {
    if (!slot) return []
    const out = []
    for (const el of slot.querySelectorAll('svg, button, .tb-brand-name, .mw-hdr-title, .tb-status, [class*="status"]')) {
      if (!visible(el)) continue
      if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue
      if (out.some((o) => o.el.contains(el))) continue
      out.push({ el, name: (el.getAttribute('aria-label') || el.textContent || el.className.baseVal || el.className || '').toString().trim().slice(0, 32), ...box(el) })
    }
    return out
  }
  const left = items(bar.querySelector('.tb-left'))
  const centre = bar.querySelector('.tb-centre')
  const centreBox = centre && visible(centre) && centre.firstElementChild && visible(centre.firstElementChild) ? box(centre.firstElementChild) : null
  const right = items(bar.querySelector('.tb-right'))
  const problems = []
  if (centreBox) {
    for (const it of left) if (it.r > centreBox.l && it.l < centreBox.r) problems.push(`left "${it.name}" ends at ${it.r}, centre pill starts at ${centreBox.l}`)
    for (const it of right) if (it.l < centreBox.r && it.r > centreBox.l) problems.push(`right "${it.name}" starts at ${it.l}, centre pill ends at ${centreBox.r}`)
  }
  const leftMax = Math.max(...left.map((i) => i.r), -Infinity)
  for (const it of right) if (it.l < leftMax) problems.push(`right "${it.name}" starts at ${it.l}, left side ends at ${leftMax}`)
  for (const btn of bar.querySelectorAll('.hz-btn, .tb-view-btn')) {
    if (!visible(btn)) continue
    const r = btn.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    if (!hit || !(hit === btn || btn.contains(hit))) problems.push(`"${btn.textContent.trim()}" is covered by ${hit ? hit.className || hit.tagName : 'nothing'}`)
  }
  const hz = bar.querySelector('.hz-switch')
  const brand = bar.querySelector('.tb-brand-name')
  return {
    hz: hz && visible(hz) ? box(hz) : null,
    centre: centreBox,
    brandShown: !!brand && visible(brand) && brand.getBoundingClientRect().width > 2,
    brandName: brand ? brand.textContent : null,
    problems,
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2))
  // the installed Chrome, as scripts/shot.mjs uses; the bar is DOM only, so software WebGL is enough
  const args = o.backend === 'swiftshader' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : []
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args })
  let failed = 0
  try {
    for (const w of o.widths) {
      for (const preset of ['public', 'command']) {
        for (const hazard of ['fire', 'flood']) {
          const page = await browser.newPage({ viewport: { width: w, height: o.h } })
          const url = `${o.base}/?preset=${preset}${hazard === 'flood' ? '&hazard=flood' : ''}`
          await page.goto(url, { waitUntil: 'domcontentloaded' })
          await page.waitForSelector('.mw-header', { timeout: 60000 })
          await page.waitForTimeout(o.wait)
          const m = await page.evaluate(measure)
          await page.close()
          const ok = !m.error && m.problems.length === 0
          if (!ok) failed++
          const hz = m.hz ? `switch ${m.hz.l}-${m.hz.r}` : 'switch hidden'
          const ce = m.centre ? `centre ${m.centre.l}-${m.centre.r}` : 'centre hidden'
          console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(w).padStart(4)} ${preset.padEnd(7)} ${hazard.padEnd(5)} ${hz.padEnd(18)} ${ce.padEnd(18)} name ${m.brandShown ? 'shown' : 'hidden'}${m.error ? ` ${m.error}` : ''}`)
          for (const p of m.problems ?? []) console.log(`       ${p}`)
        }
      }
    }
  } finally {
    await browser.close()
  }
  console.log(failed ? `${failed} page(s) with overlapping top-bar items` : 'no overlapping top-bar items')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
