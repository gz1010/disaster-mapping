// The national map's list in Floods (brief 5, PLAN-5 §4.3): "Floods in the lower 48", the OverviewPanel's look and
// classes (styles/overview.css) with the flood words. Top to bottom: the OFFICIAL NOW block ("Flood products (NWS) · 42
// in effect in the lower 48 · checked 2 min ago", the NWS pink frame), the tabs Active / 2026 / 2025 (user decision U1),
// the "Show watches" switch (U2: off by default; point checks always list every product), the source line, the lists'
// notices (NWS down, gauges down, both down), "12 floods in this view · Show all 31", the rows ("San Juan Co., NM · Flood
// Warning · Minor at Shiprock", the stage in mono, a DEMO tag on every synthetic row), and the foot: WATCHES_HIDDEN while
// watches are hidden, the past years' rule, FLOOD_LIST_ABSENCE. A row opens the flood's view for the preset (D14).
// Also here: the phones' peek bar, the "Show details" pill in Floods, the notices for a dead flood link (FLOOD_NOT_LISTED,
// FLOOD_LISTS_503) and the list's outage banner while the list is closed.
import { ChevronDown, ChevronRight, ChevronUp, Droplets, Layers, RefreshCw, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import type { FloodSummary } from '../../api/types'
import { fmtRelative } from '../../lib/time'
import { nationalGaugesDown, useNationalGauges } from '../../map/floodGaugeStatus'
import { useMapRuntime } from '../../map/mapStore'
import { pickFlood, useFlood, type FloodListKey } from '../../state/flood'
import { FLOOD_PAST_YEARS, getSlot } from '../../state/floodCatalog'
import { floodListHealth, floodListUnreadable, floodsInView, hiddenWatches, knownFloodCount, shownFloods, sortFloods } from '../../state/floodOverview'
import { useWorkspace } from '../../state/workspace'
import { Segmented, Spinner } from '../controls'
import { useNow } from '../hooks'
import { floodDetailsPillLabel, floodInViewLine, floodListNotices, floodRowSub, floodRowValue, officialProductsLine } from '../public/floodOverviewText'
import {
  DEMO_TAG,
  FLOOD_LIST_ABSENCE,
  FLOOD_LIST_ABSENCE_SHORT,
  FLOOD_LIST_EMPTY,
  FLOOD_LIST_EMPTY_VIEW,
  FLOOD_LISTS_503,
  FLOOD_NOT_LISTED,
  FLOOD_OVERVIEW,
  PAST_PREPARING,
  PAST_RULE_NOTE,
  PAST_RULE_NOTE_FALLBACK,
  watchesHidden,
} from './floodCopy'
import { NARROW_QUERY, useDrawerFocus, useMediaQuery } from './hooks'
import '../../styles/flood-overview.css'

const TABS: { value: string; key: FloodListKey; label: string; tip: string }[] = [
  { value: 'live', key: 'live', label: FLOOD_OVERVIEW.tabActive, tip: 'Floods with an NWS flood product in effect or a river gauge at flood stage now' },
  ...FLOOD_PAST_YEARS.map((y) => ({ value: String(y), key: y as FloodListKey, label: String(y), tip: `Past floods of ${y} (archived NWS products)` })),
]

/** The list data of the current tab: rows (watches as the switch says, ranked), loading / error, health, counts. */
function useFloodListData() {
  const s = useFlood(
    useShallow((st) => ({
      filter: st.filter,
      slot: getSlot(st.lists, st.filter),
      live: getSlot(st.lists, 'live'),
      showWatches: st.showWatches,
      floodId: st.floodId,
    })),
  )
  const r = s.slot.response
  const rows = useMemo(() => (r ? sortFloods(shownFloods(r.floods, s.showWatches)) : []), [r, s.showWatches])
  return {
    ...s,
    response: r,
    rows,
    hidden: r ? hiddenWatches(r.floods, s.showWatches) : 0,
    health: floodListHealth(s.slot),
    loading: s.slot.loading,
    error: s.slot.error,
    status: s.slot.status,
  }
}

function FloodRow({ flood, index, size, current, onPick }: { flood: FloodSummary; index: number; size: number; current: boolean; onPick: (f: FloodSummary) => void }) {
  const units = useWorkspace((s) => s.units)
  const value = floodRowValue(flood, units)
  const tone = flood.emergency ? 'emergency' : flood.level
  return (
    <li aria-setsize={size} aria-posinset={index + 1}>
      <button type="button" className={`ov-row fxo-row${current ? ' is-current' : ''}`} data-row={index} aria-current={current ? 'true' : undefined} onClick={() => onPick(flood)}>
        <span className={`ov-dot fxo-dot is-${tone}`} aria-hidden="true" />
        <span className="ov-main">
          <span className="ov-name">
            {flood.name}
            {flood.synthetic && <span className="fxo-demo">{DEMO_TAG}</span>}
          </span>
          <span className="ov-sub">{floodRowSub(flood)}</span>
        </span>
        <span className="ov-side">{value && <span className="ov-acres mw-mono">{value}</span>}</span>
      </button>
    </li>
  )
}

/** The rows; arrow keys, Home and End move between them (as the fire list does). */
function FloodRows({ rows, onPick }: { rows: FloodSummary[]; onPick: (f: FloodSummary) => void }) {
  const current = useFlood((s) => s.floodId)
  const ref = useRef<HTMLUListElement | null>(null)
  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])
    const i = items.indexOf(document.activeElement as HTMLElement)
    const go = (k: number) => items[Math.max(0, Math.min(items.length - 1, k))]?.focus()
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(items.length - 1)
    else return
    e.preventDefault()
  }
  return (
    <ul className="ov-list" ref={ref} aria-label="Floods" data-size={rows.length} onKeyDown={onKey}>
      {rows.map((f, i) => (
        <FloodRow key={f.id} flood={f} index={i} size={rows.length} current={f.id === current} onPick={onPick} />
      ))}
    </ul>
  )
}

/** OFFICIAL NOW: how many NWS flood products are in effect in the lower 48, and when that was checked. */
export function FloodOfficialBlock() {
  const nowMs = useNow(30_000)
  const live = useFlood((s) => getSlot(s.lists, 'live').response)
  const nws = live?.sources.find((x) => x.id === 'nws_alerts') ?? null
  const n = live && nws?.status === 'available' ? live.products_in_effect : null
  return (
    <section className="on is-overview fxo-official" aria-labelledby="fxo-on-title">
      <header className="on-head" data-tip="NWS's own flood products, with their wording, issuer, times and a link, in each flood's view">
        <h3 id="fxo-on-title">Official now</h3>
      </header>
      <ul className="on-rows">
        <li className="on-row is-alert">
          <div className="on-row-head">
            <span className="on-row-label">{FLOOD_OVERVIEW.officialTitle}</span>
          </div>
          <p className="on-line">{live ? officialProductsLine(n, nws?.retrieved_ms ?? null, nowMs) : FLOOD_OVERVIEW.checkingProducts}</p>
        </li>
      </ul>
    </section>
  )
}

/** "12 floods in this view · Show all 31" (or the way back). */
function ViewLine({ total, inViewCount, showAll }: { total: number; inViewCount: number; showAll: boolean }) {
  const set = useWorkspace((s) => s.setOverviewShowAll)
  const t = floodInViewLine(inViewCount, total)
  return (
    <p className="ov-viewline" aria-live="polite">
      {showAll ? (
        <>
          <span>{`All ${total.toLocaleString('en-US')} listed floods`}</span> ·{' '}
          <button type="button" className="mw-link-btn" onClick={() => set(false)}>
            Show the floods in this view
          </button>
        </>
      ) : (
        <>
          <span>{t.inView}</span>
          {total > inViewCount && (
            <>
              {' · '}
              <button type="button" className="mw-link-btn" onClick={() => set(true)}>
                {t.all}
              </button>
            </>
          )}
        </>
      )}
    </p>
  )
}

/** The "Show watches" switch (U2): hidden by default; the list foot and the bar say how many are hidden. */
function WatchesSwitch() {
  const on = useFlood((s) => s.showWatches)
  return (
    <button type="button" role="switch" aria-checked={on} className="fxo-switch" onClick={() => useFlood.getState().setShowWatches(!on)} data-tip="Flood Watches where no flooding is reported yet">
      <span className="fxo-switch-track" aria-hidden="true">
        <span className="fxo-switch-knob" />
      </span>
      {FLOOD_OVERVIEW.showWatches}
    </button>
  )
}

/** Tabs, the switch, the source line, notices, the rows and their states: the panel and Forensic's entry page. */
export function FloodList({ onPick }: { onPick: (f: FloodSummary) => void }) {
  const d = useFloodListData()
  const nowMs = useNow(30_000)
  const viewBox = useMapRuntime((s) => s.viewBox)
  const showAll = useWorkspace((s) => s.overviewShowAll)
  const inView = useMemo(() => (viewBox ? floodsInView(d.rows, viewBox) : d.rows), [d.rows, viewBox])
  const shown = showAll || !viewBox ? d.rows : inView
  const counts = useFlood(
    useShallow((st) => TABS.map((t) => {
      const r = getSlot(st.lists, t.key).response
      return r ? shownFloods(r.floods, st.showWatches).length : 0
    })),
  )
  const past = d.filter !== 'live'
  // a year tab loads its list on demand (and again after a failure only on Retry)
  useEffect(() => {
    if (past && !d.response && !d.loading && !d.error) void useFlood.getState().loadFloods(d.filter)
  }, [past, d.response, d.loading, d.error, d.filter])
  const checked = d.response?.sources.reduce<number | null>((m, x) => (x.retrieved_ms != null && (m == null || x.retrieved_ms > m) ? x.retrieved_ms : m), null) ?? null
  const notices = floodListNotices(d.health, d.response)
  const unreadable = floodListUnreadable(d.health)
  const preparing = past && d.response?.preparing === true
  // the past years' rule only when the backend says which rule its list follows (never for a list it could not read)
  const pastRule = past ? (d.response?.past_rule ?? null) : null
  const rule = pastRule === 'fallback' ? PAST_RULE_NOTE_FALLBACK : pastRule === 'moderate_or_worse' ? PAST_RULE_NOTE : null
  // nothing listed because the list could not be read: the body says why (never "No listed floods", WFO-R3)
  const bodyDown = unreadable && d.rows.length === 0 && !d.loading && !preparing && !d.error
  const emptyShown = shown.length === 0 && (d.rows.length > 0 || (!d.loading && !d.error))
  // the national gauge layer could not be read: the map shows the listed floods' own gauges only (WFO-R8)
  const nationalDown = useNationalGauges(nationalGaugesDown)
  const gaugesOn = useFlood((st) => st.layers.gauges)
  const gaugesDown = nationalDown && gaugesOn && !past
  return (
    <>
      <div className="ov-filters fxo-filters">
        <Segmented
          value={TABS.find((t) => t.key === d.filter)?.value ?? 'live'}
          onChange={(v) => useFlood.getState().setFilter(TABS.find((t) => t.value === v)?.key ?? 'live')}
          ariaLabel="Which floods"
          size="sm"
          className="mw-seg-fill"
          options={TABS.map((t, i) => ({
            value: t.value,
            tip: t.tip,
            label: (
              <>
                {t.label} {counts[i] > 0 && <span className="seg-count mono">{counts[i].toLocaleString('en-US')}</span>}
              </>
            ),
          }))}
        />
        <WatchesSwitch />
      </div>
      <p className="ov-source">
        <span className="mw-tag is-official">Official</span>
        <span>
          {past ? FLOOD_OVERVIEW.sourcePast : FLOOD_OVERVIEW.sourceLive}
          {unreadable ? <> · {FLOOD_OVERVIEW.sourceUnreadable}</> : checked != null && <> · checked {fmtRelative(checked, nowMs)}</>}
        </span>
        <button
          type="button"
          className="mw-icon-btn is-sm ov-refresh"
          aria-label="Reload the flood lists"
          data-tip={FLOOD_OVERVIEW.reload}
          disabled={d.loading}
          onClick={() => void useFlood.getState().loadFloods(d.filter)}
        >
          {d.loading ? <Spinner size={11} /> : <RefreshCw size={12} />}
        </button>
      </p>
      {!bodyDown &&
        notices.map((n) => (
          <p key={n} className="ov-warn" role="status">
            {n}
          </p>
        ))}
      {preparing && <p className="ov-warn">{PAST_PREPARING}</p>}
      {d.error && d.rows.length > 0 && (
        <p className="ov-warn" role="status">
          {d.status === 503 ? FLOOD_LISTS_503 : `The flood list could not be refreshed: ${d.error}`}
        </p>
      )}
      {viewBox && d.rows.length > 0 && <ViewLine total={d.rows.length} inViewCount={inView.length} showAll={showAll} />}
      <div className="ov-body">
        {shown.length > 0 ? (
          <FloodRows rows={shown} onPick={onPick} />
        ) : d.rows.length > 0 ? (
          <div className="ov-state is-empty">
            <p>{FLOOD_LIST_EMPTY_VIEW}</p>
            <p className="ov-absence">{FLOOD_LIST_ABSENCE}</p>
          </div>
        ) : d.loading || preparing ? (
          <p className="ov-state">
            <Spinner size={12} /> {preparing ? PAST_PREPARING : FLOOD_OVERVIEW.loadingLists}
          </p>
        ) : d.error ? (
          <div className="ov-state is-error" role="alert">
            <p>{d.status === 503 ? FLOOD_LISTS_503 : `Could not load the flood list: ${d.error}`}</p>
            <button type="button" className="mw-btn is-sm" onClick={() => void useFlood.getState().loadFloods(d.filter)}>
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        ) : bodyDown ? (
          <div className="ov-state is-error" role="status">
            {notices.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </div>
        ) : (
          <div className="ov-state is-empty">
            <p>{past ? FLOOD_LIST_EMPTY_VIEW : FLOOD_LIST_EMPTY}</p>
            <p className="ov-absence">{FLOOD_LIST_ABSENCE}</p>
          </div>
        )}
      </div>
      <footer className="ov-foot">
        {d.hidden > 0 && (
          <p className="fxo-watches">
            <button type="button" className="mw-link-btn" onClick={() => useFlood.getState().setShowWatches(true)}>
              {watchesHidden(d.hidden)}
            </button>
          </p>
        )}
        {gaugesDown && <p className="ov-absence fxo-gauges-down" role="note">{FLOOD_OVERVIEW.nationalGaugesDown}</p>}
        {rule && <p className="ov-absence">{rule}</p>}
        {(!emptyShown || bodyDown) && <p className="ov-absence">{FLOOD_LIST_ABSENCE}</p>}
      </footer>
    </>
  )
}

/** Phones, sheet closed (Command): one line, and the short list-absence line. */
export function FloodPeekBar() {
  const d = useFloodListData()
  const n = d.rows.length
  const open = () => useWorkspace.getState().setPanel('updates', true)
  const down = floodListUnreadable(d.health) && n === 0 ? (floodListNotices(d.health, d.response)[0] ?? null) : null
  const text = !d.response ? (d.loading ? 'Loading the floods…' : d.error ? 'Could not load the flood list · open to retry' : 'Loading the floods…') : (down ?? `${n.toLocaleString('en-US')} listed flood${n === 1 ? '' : 's'}`)
  return (
    <button type="button" className="ov-peek" data-panel-toggle="updates" aria-expanded={false} onClick={open}>
      <Droplets size={14} className="ov-peek-icon fxo-peek-icon" aria-hidden="true" />
      <span className="ov-peek-lines">
        <span className="ov-peek-text">{text}</span>
        <span className="ov-peek-absence" title={FLOOD_LIST_ABSENCE}>
          {FLOOD_LIST_ABSENCE_SHORT}
        </span>
      </span>
      {d.loading && <Spinner size={11} />}
      <ChevronUp size={15} aria-hidden="true" />
    </button>
  )
}

/** The list panel in Floods (the updates slot, as the fire list). */
export function FloodListPanel({ closeHidesDetails = false, sheetPeek = true }: { closeHidesDetails?: boolean; sheetPeek?: boolean } = {}) {
  const open = useWorkspace((s) => s.panels.updates)
  const setPanel = useWorkspace((s) => s.setPanel)
  const narrow = useMediaQuery(NARROW_QUERY)
  const heading = useRef<HTMLHeadingElement | null>(null)
  useDrawerFocus(open, heading, 'updates')
  if (!open) {
    if (narrow) return sheetPeek ? <FloodPeekBar /> : null
    return (
      <button type="button" className="mw-btn mw-updates-open" data-panel-toggle="updates" aria-expanded={false} onClick={() => setPanel('updates', true)}>
        <Droplets size={14} /> {FLOOD_OVERVIEW.listTitle}
      </button>
    )
  }
  const pick = (f: FloodSummary) => {
    pickFlood(f.id, 'list')
    if (narrow) setPanel('updates', false)
  }
  return (
    <section className="mw-updates-panel ov-panel fxo-panel" aria-labelledby="fxo-title" data-drawer="updates">
      <span className="mw-sheet-handle" aria-hidden="true" />
      <header className="mw-panel-head">
        <h2 id="fxo-title" ref={heading} tabIndex={-1} data-tip="Lower 48 states and DC; Alaska, Hawaii and the territories are not supported yet">
          {FLOOD_OVERVIEW.listTitle}
        </h2>
        {closeHidesDetails ? (
          <button
            type="button"
            className="mw-icon-btn ov-close"
            aria-label="Hide details"
            data-tip="Hide details (the flood list, map controls, readout, scale and legend)"
            onClick={() => useWorkspace.getState().setOverviewDetails(false)}
          >
            <X size={16} />
          </button>
        ) : (
          <button type="button" className="mw-icon-btn" aria-label={narrow ? 'Close the flood list' : 'Collapse the flood list'} aria-expanded={true} onClick={() => setPanel('updates', false)}>
            {narrow ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
        )}
      </header>
      <div className="mw-official-slot ov-official">
        <FloodOfficialBlock />
      </div>
      <FloodList onPick={pick} />
    </section>
  )
}

/** The "Show details" pill in Floods (the fire pill's look): its count is the number of listed floods. */
export function FloodShowDetailsPill({ sheet = false }: { sheet?: boolean }) {
  const details = useWorkspace((s) => s.overviewDetails)
  const listOpen = useWorkspace((s) => s.panels.updates)
  const { count, loading, unavailable } = useFlood(
    useShallow((st) => {
      const slot = getSlot(st.lists, st.filter)
      // never "0" for a list that could not be read (WFO-R3): no number, a dash
      const n = knownFloodCount(slot.response, st.showWatches)
      return { count: n, loading: slot.loading, unavailable: slot.response != null && n == null }
    }),
  )
  const open = sheet ? listOpen : details
  const label = floodDetailsPillLabel(open, count, unavailable)
  return (
    <button
      type="button"
      className={`ovw-pill fxo-pill${open ? ' is-open' : ''}`}
      aria-expanded={open}
      aria-label={label.aria}
      data-panel-toggle={sheet ? 'updates' : undefined}
      onClick={() => {
        const ws = useWorkspace.getState()
        if (sheet) ws.setPanel('updates', !open)
        else {
          ws.setOverviewDetails(!open)
          if (!open && !ws.panels.updates) ws.setPanel('updates', true)
        }
      }}
    >
      <Layers size={18} aria-hidden="true" className="ovw-pill-icon" />
      <span className="ovw-pill-text">{label.text}</span>
      <span className="ovw-pill-count mw-mono" aria-hidden="true">
        {count == null ? unavailable ? '–' : <Spinner size={10} /> : count.toLocaleString('en-US')}
        {count != null && loading && <Spinner size={9} />}
      </span>
    </button>
  )
}

/** A dead flood link (404: FLOOD_NOT_LISTED) or the lists down (503: FLOOD_LISTS_503, never "not found"). */
export function FloodMissingNotice() {
  const { id, reason } = useFlood(useShallow((s) => ({ id: s.missingFloodId, reason: s.missingReason })))
  if (!id || !reason) return null
  return (
    <div className="banner banner-info mw-missing" role="status">
      <span className="banner-text">
        {reason === 'lists_down' ? FLOOD_LISTS_503 : FLOOD_NOT_LISTED} (<span className="mw-mono">{id}</span>)
      </span>
      <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => useFlood.setState({ missingFloodId: null, missingReason: null })}>
        <X size={13} />
      </button>
    </div>
  )
}

/** App.tsx's top-centre slot (banners), once it is in the page. */
function useTopCentre(): HTMLElement | null {
  const [el, setEl] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEl(document.querySelector<HTMLElement>('.mw .top-center')))
    return () => cancelAnimationFrame(raf)
  }, [])
  return el
}

/** The list's outage notices while the list itself is not open (as the fire overview's ListNoticeBanner): a missing
 *  source must never read as an all-clear. Dismissable; a changed notice shows again. */
export function FloodListNoticeBanner() {
  // the shown list's own state (the bar and the markers follow the filter too)
  const slot = useFlood(useShallow((s) => getSlot(s.lists, s.filter)))
  const lines = floodListNotices(floodListHealth(slot), slot.response)
  const key = lines.join('\n')
  const [dismissed, setDismissed] = useState<string | null>(null)
  const topCentre = useTopCentre()
  if (!lines.length || dismissed === key) return null
  const banner = (
    <div className="banner banner-info mw-list-notice" role="status">
      <span className="banner-text">
        {lines.map((l) => (
          <span key={l} className="mw-list-notice-line">
            {l}
          </span>
        ))}
      </span>
      <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setDismissed(key)}>
        <X size={13} />
      </button>
    </div>
  )
  return topCentre ? createPortal(banner, topCentre) : banner
}
