import { describe, expect, it } from 'vitest'
import { defaultContext } from './catalog'
import { setPrice } from './catalogEdit'
import { priceOrder } from './pricing'
import { compareToLive, makeSnapshot } from './snapshot'
import type { LineInput } from './types'
import { addHistory, newOrder, nextJo, sampleOrder } from '../orders'
import { DEFAULT_CUSTOMERS } from '../state'

const cx = DEFAULT_CUSTOMERS[0]
const lines: LineInput[] = [
  { item: 'Door', back: 'NA/None', thick: 0.75, style: 'SLAB', edge: 'SLAB', colour: 'GLACIER WHITE (O)', qty: 4, hIn: 30, wIn: 17.5 },
  { item: 'Door', back: 'WHT', thick: 0.75, style: 'Classic Manhattan-MISSISSAUGA', edge: 'SAME', colour: 'ACAJOU MAHOGANY (O)-', qty: 1, hIn: 60, wIn: 45 },
]

describe('order price snapshot', () => {
  it('captures prices, parameters and the customer as they were', () => {
    const ctx = defaultContext()
    const snap = makeSnapshot(lines, cx, 0, ctx, 3, '2026-10-15T12:00:00Z')
    expect(snap.catalogVersion).toBe(3)
    expect(snap.takenAt).toBe('2026-10-15T12:00:00Z')
    expect(snap.params.hstRate).toBe(0.13)
    expect(snap.customer.name).toBe('Cabinet Pro')
    expect(snap.priced.lines[0].pricePerSqFt).toBe(9.97)
    expect(snap.priced.total).toBeCloseTo(priceOrder(lines, cx, 0, ctx).total)
  })

  it('does not change when the catalog, parameters or customer are edited afterwards', () => {
    const ctx = defaultContext()
    const snap = makeSnapshot(lines, cx, 0, ctx, 0)
    const before = JSON.stringify(snap)

    ctx.catalog = setPrice(ctx.catalog, 'SLAB', 'GLACIER WHITE (O)', 12.34)
    ctx.params.hstRate = 0.2
    cx.name = 'Renamed Customer'
    try {
      expect(JSON.stringify(snap)).toBe(before)
      expect(snap.priced.lines[0].pricePerSqFt).toBe(9.97)
      expect(snap.customer.name).toBe('Cabinet Pro')
    } finally {
      cx.name = 'Cabinet Pro'
    }
  })

  it('is a deep copy: mutating the source customer later cannot leak in', () => {
    const snap = makeSnapshot(lines, cx, 0, defaultContext(), 0)
    expect(snap.customer).not.toBe(cx)
    expect(snap.customer.billTo).not.toBe(cx.billTo)
  })
})

describe('comparing a snapshot with live prices', () => {
  it('reports no change while the catalog is untouched', () => {
    const ctx = defaultContext()
    const snap = makeSnapshot(lines, cx, 0, ctx, 0)
    const cmp = compareToLive(snap, lines, cx, ctx)
    expect(cmp.changed).toBe(false)
    expect(cmp.delta).toBeCloseTo(0)
    expect(cmp.changedRows).toEqual([])
  })

  it('reports which rows and how much after a price change', () => {
    const ctx = defaultContext()
    const snap = makeSnapshot(lines, cx, 0, ctx, 0)
    const live = { ...ctx, catalog: setPrice(ctx.catalog, 'SLAB', 'GLACIER WHITE (O)', 10.5) }
    const cmp = compareToLive(snap, lines, cx, live)
    expect(cmp.changed).toBe(true)
    expect(cmp.changedRows).toEqual([0])
    // 4 x 3.646 sf x $0.53 x 1.13 HST
    expect(cmp.delta).toBeGreaterThan(0)
    expect(cmp.liveTotal).toBeCloseTo(snap.priced.total + cmp.delta)
    expect(cmp.lockedTotal).toBe(snap.priced.total)
  })

  it('reports a parameter change (HST rate) even if no line price moved', () => {
    const ctx = defaultContext()
    const snap = makeSnapshot(lines, cx, 0, ctx, 0)
    const cmp = compareToLive(snap, lines, cx, { ...ctx, params: { ...ctx.params, hstRate: 0.15 } })
    expect(cmp.changed).toBe(true)
    expect(cmp.changedRows).toEqual([])
  })

  it('falls back to the snapshot customer when the live customer was deleted', () => {
    const ctx = defaultContext()
    const snap = makeSnapshot(lines, cx, 0, ctx, 0)
    expect(compareToLive(snap, lines, undefined, ctx).changed).toBe(false)
  })
})

describe('orders', () => {
  it('numbers new orders after the highest existing job order', () => {
    expect(nextJo([])).toBe('30790')
    expect(nextJo([{ jo: '30790' }, { jo: '30812' }, { jo: 'abc' }])).toBe('30813')
  })

  it('creates a draft with the customer defaults and records history', () => {
    const o = newOrder('30800', cx)
    expect(o.status).toBe('draft')
    expect(o.snapshot).toBeUndefined()
    expect(o.shipToId).toBe('S1')
    expect(addHistory(o, 'x').history.map((h) => h.text)).toEqual(['Order created', 'x'])
  })

  it('the sample order is the workbook JO 30789 line plus two more', () => {
    expect(sampleOrder('1', cx).lines).toHaveLength(3)
  })
})
