import { describe, expect, it } from 'vitest'
import { priceLine, priceOrder, colourColumn, vlookup, lists } from './pricing'
import { qbTotals, toQbLines } from './quickbooks'
import type { Customer, LineInput } from './types'

const hstOnly: Customer = { id: 'T1', name: 'Test HST only', accountType: 'HST ONLY', doorEdge: false }
const withWaste: Customer = { ...hstOnly, accountType: 'HST WITH WASTE' }
const cash: Customer = { ...hstOnly, accountType: 'CASH' }
const edgeCx: Customer = { ...hstOnly, doorEdge: true }

const base: LineInput = {
  item: 'Door', back: 'WHT', thick: 0.75, style: 'Classic Manhattan-MISSISSAUGA', edge: 'SAME',
  colour: 'ACAJOU MAHOGANY (O)-', qty: 1, hIn: 60, wIn: 45,
}
const slab = (over: Partial<LineInput>): LineInput => ({
  item: 'Door', back: 'NA/None', thick: 0.75, style: 'SLAB', edge: 'SLAB', colour: 'GLACIER WHITE (O)', qty: 1, hIn: 30, wIn: 20, ...over,
})

describe('price catalog lookups', () => {
  it('maps colour names to price columns', () => {
    expect(colourColumn('ACAJOU MAHOGANY (O)-')).toBe(8)
    expect(colourColumn('glacier white (o)')).toBe(131)
  })
  it('prices style x colour like the workbook (screenshot: SLAB and PILLOW Glacier White = 9.97)', () => {
    expect(vlookup('SLAB', 131)).toBe(9.97)
    expect(vlookup('PILLOW', 131)).toBe(9.97)
    expect(vlookup('SHAKER ', 131)).toBe(14.75)
  })
  it('exposes the dropdown lists', () => {
    expect(lists.item).toContain('Door')
    expect(lists.colour.length).toBeGreaterThan(100)
  })
})

describe('JO 30789 (cached values in the workbook)', () => {
  it('60 x 45 door at $4/sf for an HST ONLY customer -> 18.75 sf, $75.00, total $84.75', () => {
    const o = priceOrder([base], hstOnly)
    expect(o.lines[0].hMm).toBeCloseTo(1524)
    expect(o.lines[0].wMm).toBeCloseTo(1143)
    expect(o.lines[0].sqFtEach).toBeCloseTo(18.75)
    expect(o.lines[0].pricePerSqFt).toBe(4)
    expect(o.lines[0].perimeterIn).toBe(210)
    expect(o.subtotal).toBeCloseTo(75)
    expect(o.hst).toBeCloseTo(9.75)
    expect(o.total).toBeCloseTo(84.75)
  })
})

describe('square footage rules', () => {
  it('adds 14.75% waste for HST WITH WASTE and CASH accounts', () => {
    expect(priceLine(base, withWaste).sqFtEach).toBeCloseTo(18.75 * 1.1475)
    expect(priceLine(base, cash).sqFtEach).toBeCloseTo(18.75 * 1.1475)
  })
  it('bills pieces under 1 sq ft as the minimum', () => {
    const tiny = slab({ hIn: 6, wIn: 6 })
    expect(priceLine(tiny, hstOnly).sqFtEach).toBe(1)
    expect(priceLine(tiny, withWaste).sqFtEach).toBe(1.1475)
  })
  it('adds door edge sq ft for flagged customers', () => {
    const edge = (0.75 * (60 * 2 + 45 * 2)) / 144
    expect(priceLine(base, edgeCx).sqFtEach).toBeCloseTo(18.75 + edge)
  })
  it('bills nothing for an empty row', () => {
    const p = priceLine({ ...base, hIn: 0, wIn: 0 }, hstOnly)
    expect(p.sqFtEach).toBe(0)
    expect(p.total).toBe(0)
  })
})

describe('data problems are surfaced instead of silently priced', () => {
  it('flags a colour with no price column', () => {
    const p = priceLine({ ...base, colour: 'NORTHERN BEIGE (O)-' }, hstOnly)
    expect(p.issues.join()).toMatch(/no price column/)
  })
  it('flags a $0 combination', () => {
    expect(priceLine(slab({ style: 'SHAKER V GROOVE', edge: 'SHAKER V GROOVE' }), hstOnly).issues.join()).toMatch(/\$0/)
  })
  it('CASH customers are not charged HST', () => {
    expect(priceOrder([base], cash).hst).toBe(0)
  })
})

describe('QuickBooks sales order (screenshot JO 30673)', () => {
  it('five tiny fillers group to 5 sq ft x $9.97 = $49.85', () => {
    const lines = [slab({ item: 'Filler', style: 'SLAB', hIn: 3, wIn: 10, qty: 5 })]
    const [l] = toQbLines(lines, priceOrder(lines, hstOnly), true)
    expect(l).toMatchObject({ item: 'Filler', qty: 5, sqFt: 5, rate: 9.97, amount: 49.85, tax: 'H' })
  })
  it('merges identical item/style/colour rows into one QuickBooks line', () => {
    const lines = [slab({ qty: 2 }), slab({ qty: 3, hIn: 40, wIn: 15 })]
    const out = toQbLines(lines, priceOrder(lines, hstOnly), true)
    expect(out).toHaveLength(1)
    expect(out[0].qty).toBe(5)
    expect(out[0].item).toBe('MDF Doors')
  })
  it('subtotal 650.43 -> HST 84.56 -> total 734.99', () => {
    const amounts = [300.98, 118.84, 49.85, 49.85, 9.97, 120.94]
    expect(qbTotals(amounts.reduce((a, b) => a + b, 0), true)).toEqual({ subtotal: 650.43, hst: 84.56, total: 734.99 })
  })
  it('30.189 sq ft x 9.97 = 300.98', () => {
    expect(Math.round(30.189 * 9.97 * 100) / 100).toBe(300.98)
  })
})
