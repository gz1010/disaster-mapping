// The overview top bar's right side in Floods (brief 5, PLAN-5 §4.3): the viewer's local date and the number of listed
// floods ("NOV 4 2026 · 31 FLOODS", the count in #7fd4ff), with " · 3 WATCHES HIDDEN" while "Show watches" is off
// (C27); "LOADING FLOODS", "FLOOD LIST UNAVAILABLE" (the list or a year's archive could not be read), "FLOOD LISTS
// UNAVAILABLE" (NWS and the gauges down, even with floods listed from disk) otherwise, never "0" when a list could not
// be read (review WFO-R3, WFO-R4). Its tooltip says whose list it is and that a place with no marker is not an all-clear.
import { useShallow } from 'zustand/react/shallow'
import { useFlood } from '../../state/flood'
import { getSlot } from '../../state/floodCatalog'
import { floodListHealth, hiddenWatches, knownFloodCount } from '../../state/floodOverview'
import { useNow } from '../hooks'
import { FLOOD_COUNT_TIP, floodCountPart } from './floodOverviewText'
import { barDate } from './overviewText'

export function FloodStatus() {
  const nowMs = useNow(60_000)
  const s = useFlood(
    useShallow((st) => {
      const slot = getSlot(st.lists, st.filter)
      const r = slot.response
      const health = floodListHealth(slot)
      return {
        count: knownFloodCount(r, st.showWatches),
        hidden: r ? hiddenWatches(r.floods, st.showWatches) : 0,
        loaded: r != null,
        loading: slot.loading,
        failed: slot.error != null,
        bothDown: health === 'both_down',
        archiveDown: health === 'archive_down',
      }
    }),
  )
  const part = floodCountPart({ count: s.count, loaded: s.loaded, loading: s.loading, failed: s.failed, bothDown: s.bothDown, archiveDown: s.archiveDown, hiddenWatches: s.hidden })
  return (
    <span className="ovw-status fxo-status" data-tip={FLOOD_COUNT_TIP}>
      <span className="ovw-status-date">{barDate(nowMs)}</span>
      <span className="ovw-status-sep" aria-hidden="true">
        {' · '}
      </span>
      <span className={`ovw-status-count is-${part.tone}`}>{part.text}</span>
      <span className="mw-sr-only">. {FLOOD_COUNT_TIP}</span>
    </span>
  )
}
