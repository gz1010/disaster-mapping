// History flags shared by the fire and flood stores (brief 5, PLAN-5 §4.1, CONTRACT §16.10; C21). One event is open at
// a time, so a hazard switch closes the other event first: fire → flood is "close the fire, open the flood" and flood →
// fire the reverse. Each switch must be ONE history entry, so the close made on the way is not recorded:
//   - `crossingHazard(fn)`: while fn runs, state/history.ts records no entry for the event being closed (the opening
//     event's own entry follows);
//   - `replacingHistory(fn)`: while fn runs, an event change replaces the current entry instead of pushing one (a flood
//     detail answering with its canonical id after a merge, a dead link's fallback, openFlood({ replace: true })).
// A small module of its own so state/flood.ts and state/history.ts share it without importing each other.

let crossing = 0
let replacing = 0

/** Run `fn` while the other hazard's event is being closed for a switch: that close writes no history entry. */
export function crossingHazard<T>(fn: () => T): T {
  crossing++
  try {
    return fn()
  } finally {
    crossing--
  }
}

/** True while `crossingHazard` runs. */
export function isCrossingHazard(): boolean {
  return crossing > 0
}

/** Run `fn` with event changes recorded as replacements of the current entry. */
export function replacingHistory<T>(fn: () => T): T {
  replacing++
  try {
    return fn()
  } finally {
    replacing--
  }
}

/** True while `replacingHistory` runs. */
export function isReplacingHistory(): boolean {
  return replacing > 0
}
