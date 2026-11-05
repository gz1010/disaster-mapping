import { describe, expect, it } from 'vitest'
import { LIST, LIST_2025 } from '../api/__fixtures__/floods/edgeCases'
import { EMPTY_SLOT, findFloodIn, getSlot, slotApply, slotFail, slotKey, slotPending, type FloodListSlot } from './floodCatalog'

describe('flood list slots', () => {
  it('pending, applied and failed; a failed reload keeps the last answer', () => {
    let lists: Record<string, FloodListSlot> = { live: EMPTY_SLOT }
    lists = slotPending(lists, 'live')
    expect(getSlot(lists, 'live').loading).toBe(true)
    const r = LIST()
    lists = slotApply(lists, 'live', r)
    expect(getSlot(lists, 'live')).toMatchObject({ response: r, loading: false, error: null })
    lists = slotFail(slotPending(lists, 'live'), 'live', 'API 503', 503)
    expect(getSlot(lists, 'live')).toMatchObject({ response: r, loading: false, error: 'API 503', status: 503 })
    expect(slotKey(2025)).toBe('2025')
    expect(getSlot(lists, 2026)).toBe(EMPTY_SLOT)
  })

  it('finds a flood by id or alias, live first', () => {
    let lists = slotApply({ live: EMPTY_SLOT }, 'live', LIST())
    lists = slotApply(lists, 2025, LIST_2025())
    expect(findFloodIn(lists, 'fixture-flood')?.name).toBe('Ridge Fork River flood')
    expect(findFloodIn(lists, 'fixture-flood-past')?.mode).toBe('historical')
    expect(findFloodIn(lists, 'nope')).toBeNull()
  })
})
