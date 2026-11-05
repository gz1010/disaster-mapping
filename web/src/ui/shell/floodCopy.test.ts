// The flood wording guard (PLAN-5 §5.1, CONTRACT §16.0, C24): every exported string of every `*[Ff]lood*[Cc]opy*.ts`
// file (test files excepted: they hold banned words as inputs) is free of the banned words in Disaster Mapping's own voice;
// rendered output is scanned with the issuers' own words (`data-verbatim`) stripped first. A planted banned word must
// make the guard fail. Rendered flood views of the other roles use floodWordingProblems + stripVerbatim the same way.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import * as copy from './floodCopy'
import { collectStrings, fillCopy, floodWordingProblems, stripVerbatim } from './floodCopy'

const modules = import.meta.glob('/src/**/*[Ff]lood*[Cc]opy*.ts', { eager: true }) as Record<string, Record<string, unknown>>
const copyFiles = Object.fromEntries(Object.entries(modules).filter(([path]) => !/\.test\.ts$/.test(path)))

/** The problems of every string a module exports: `{ "path#EXPORT": ["safe"] }`. */
function moduleProblems(mods: Record<string, Record<string, unknown>>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [path, mod] of Object.entries(mods))
    for (const [name, value] of Object.entries(mod))
      for (const s of collectStrings(value)) {
        const p = floodWordingProblems(s)
        if (p.length) out[`${path}#${name}`] = [...(out[`${path}#${name}`] ?? []), ...p]
      }
  return out
}

describe('flood wording guard (PLAN-5 §5.1)', () => {
  it('finds this file set: floodCopy.ts at least, never a test file', () => {
    expect(Object.keys(copyFiles)).toContain('/src/ui/shell/floodCopy.ts')
    expect(Object.keys(copyFiles).some((p) => p.endsWith('.test.ts'))).toBe(false)
  })

  it('no exported string of any flood copy file uses a banned word', () => {
    expect(moduleProblems(copyFiles)).toEqual({})
  })

  it('a planted banned word fails the guard (strings, nested objects, every pattern)', () => {
    const planted = { '/planted.ts': { A: 'This area is safe.', B: { deep: ['The river receded.'] }, C: 'Status: ENDED', D: 'Low risk here' } }
    const p = moduleProblems(planted)
    expect(Object.keys(p).sort()).toEqual(['/planted.ts#A', '/planted.ts#B', '/planted.ts#C', '/planted.ts#D'])
    for (const word of ['safe', 'safely', 'safety', 'low risk', 'all clear', 'all-clear', 'no flooding', 'dry', 'receded', 'the flood is over', 'ended', 'normal level', 'no danger', 'you are outside the flood', 'minimal flood hazard', 'FireTrace'])
      expect(floodWordingProblems(`Disaster Mapping says ${word} here`), word).not.toEqual([])
  })

  it('word boundaries: "extended", "recommended", "unsafe" stems and "dryer" do not match; allowed phrases pass', () => {
    expect(floodWordingProblems('NWS extended the warning; evacuation is recommended')).toEqual([])
    expect(floodWordingProblems('Not an all-clear. Follow local officials.')).toEqual([])
    expect(floodWordingProblems('never an all-clear')).toEqual([])
    expect(floodWordingProblems('Unknown, not dry. Follow local officials.')).toEqual([])
    expect(floodWordingProblems('Clouds hide water: dry pixels do not mean no flooding.')).toEqual([])
    expect(floodWordingProblems('Readings do not mean no flooding.')).toEqual([])
    expect(floodWordingProblems('It does not establish the safety of a route or an area.')).toEqual([])
    // the allowed phrase does not excuse a second, free-standing banned word
    expect(floodWordingProblems('Not an all-clear, but the area is safe')).toEqual(['safe'])
    expect(floodWordingProblems('all clear')).toEqual(['all clear'])
  })

  it('rendered output: issuer text inside data-verbatim is not scanned, Disaster Mapping text is', () => {
    const view = createElement(
      'div',
      null,
      createElement('p', null, copy.NO_PRODUCT),
      createElement('blockquote', { 'data-verbatim': '' }, 'NWS: the river has receded below flood stage; roads are safe ', createElement('b', null, 'again'), '.'),
      createElement('span', null, 'NWS Albuquerque'),
      createElement('img', { alt: '' }),
    )
    const html = renderToStaticMarkup(view)
    const text = stripVerbatim(html)
    expect(text).toContain('No NWS flood product here right now')
    expect(text).toContain('NWS Albuquerque')
    expect(text).not.toContain('receded')
    expect(text).not.toContain('again')
    expect(floodWordingProblems(text)).toEqual([])
    // the same markup without the marker fails
    const unmarked = renderToStaticMarkup(createElement('p', null, 'the river has receded'))
    expect(floodWordingProblems(stripVerbatim(unmarked))).toEqual(['receded'])
  })

  it('slots fill and keep unknown slots visible', () => {
    expect(fillCopy(copy.GAUGE_OTHER_STREAM, { river: 'San Juan River' })).toBe('Nearest gauge on the San Juan River; another stream may be closer.')
    expect(fillCopy(copy.SAT_LABEL, { 'date, time': 'Oct 31, 4:06 PM', age: '4 d ago' })).toBe('Water seen by satellite · Oct 31, 4:06 PM (4 d ago)')
    expect(fillCopy('{a} {b}', { a: 1 })).toBe('1 {b}')
    expect(copy.watchesHidden(1)).toBe('1 Flood Watch hidden · Show')
    expect(copy.watchesHidden(3)).toBe('3 Flood Watches hidden · Show')
  })

  it('keeps the PLAN-5 §5 strings verbatim (spot checks) and every view line', () => {
    expect(copy.PROTOTYPE_LINE).toBe('Research prototype — not for operational use')
    expect(copy.NOT_ALL_CLEAR).toBe('Not an all-clear. Follow local officials.')
    expect(copy.FLOOD_LIST_ABSENCE).toBe(
      'Only floods with an NWS flood product or a river gauge at flood stage are listed. A place with no marker is not an all-clear. Follow local officials.',
    )
    expect(copy.CURSOR_FUTURE_PRODUCTS).toBe('NWS products in effect now; NWS has issued none for this future time. An NWS end time is not a forecast of when flooding stops.')
    expect(copy.NO_GAUGE_NEAR).toBe('No gauge reads at action stage or above within 25 km; streams without a gauge are not measured. Not an all-clear.')
    expect(copy.CIRCLE_STATUS.noProductNow).toBe('FLOOD · NO NWS WARNING NOW')
    // the circle never says ACTIVE, ENDED, OVER or CLEAR (D19)
    for (const s of Object.values(copy.CIRCLE_STATUS)) expect(s).not.toMatch(/\b(ACTIVE|ENDED|OVER|CLEAR)\b/)
    // every GaugeCategory has a short label and a sentence (C15)
    expect(Object.keys(copy.GAUGE_CATEGORY_DISPLAY).sort()).toEqual(
      ['action', 'fcst_not_current', 'low_threshold', 'major', 'minor', 'moderate', 'no_flooding', 'not_defined', 'obs_not_current', 'out_of_service', 'unknown'].sort(),
    )
    expect(copy.GAUGE_CATEGORY_DISPLAY.not_defined.sentence).toBe(copy.GAUGE_NOT_DEFINED)
  })

  it('the backend-sent (B) copies equal CONTRACT §16.14', () => {
    // the strings the backend sends, repeated here for a failed request (no answer to read the reason from)
    expect(copy.ALERTS_UNAVAILABLE).toBe('NWS flood products could not be reached right now. That is not an all-clear: follow local officials.')
    expect(copy.GAUGES_UNAVAILABLE).toBe('River gauge readings could not be loaded right now. That is not an all-clear.')
    expect(copy.FLOOD_LISTS_503).toBe('The flood lists could not be reached right now; try again later.')
    expect(copy.SAT_NOT_SET_UP).toMatch(/^NASA Earthdata login is not set up on this server\./)
  })
})
