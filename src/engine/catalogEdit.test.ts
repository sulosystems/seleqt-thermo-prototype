import { describe, expect, it } from 'vitest'
import { defaultContext, activeLists } from './catalog'
import { addEntry, diffContext, getPrice, setEdgeAdd, setPrice, toggleRetired, validate } from './catalogEdit'
import { priceLine } from './pricing'
import type { Customer, LineInput } from './types'

const cx: Customer = { id: 't', name: 't', accountType: 'HST ONLY', doorEdge: false }
const slabLine: LineInput = { item: 'Door', back: 'NA/None', thick: 0.75, style: 'SLAB', edge: 'SLAB', colour: 'GLACIER WHITE (O)', qty: 1, hIn: 24, wIn: 12 }

describe('admin catalog edits', () => {
  it('a price edit changes pricing, and leaves the original catalog untouched', () => {
    const base = defaultContext()
    expect(getPrice(base.catalog, 'SLAB', 'GLACIER WHITE (O)')).toBe(9.97)
    const catalog = setPrice(base.catalog, 'SLAB', 'GLACIER WHITE (O)', 10.5)
    expect(priceLine(slabLine, cx, { ...base, catalog }).pricePerSqFt).toBe(10.5)
    expect(priceLine(slabLine, cx, base).pricePerSqFt).toBe(9.97)
  })

  it('clearing a price makes the combination show as $0', () => {
    const base = defaultContext()
    const catalog = setPrice(base.catalog, 'SLAB', 'GLACIER WHITE (O)', undefined)
    expect(priceLine(slabLine, cx, { ...base, catalog }).issues.join()).toMatch(/\$0/)
  })

  it('waste factor and HST rate are parameters, not constants', () => {
    const base = defaultContext()
    const ctx = { ...base, params: { wasteFactor: 1.2, hstRate: 0.15 } }
    const waste: Customer = { ...cx, accountType: 'HST WITH WASTE' }
    expect(priceLine(slabLine, waste, ctx).sqFtEach).toBeCloseTo(2 * 1.2)
  })

  it('profile edge add feeds the edge upcharge', () => {
    const base = defaultContext()
    const catalog = setEdgeAdd(base.catalog, 'PILLOW', 1.5)
    const line = { ...slabLine, style: 'SLAB', edge: 'PILLOW' }
    expect(priceLine(line, cx, { ...base, catalog }).pricePerSqFt).toBeCloseTo(9.97 + 1.5)
  })

  it('retiring hides a style from dropdowns but old orders still price', () => {
    const base = defaultContext()
    const catalog = toggleRetired(base.catalog, 'SLAB')
    expect(activeLists(catalog).style).not.toContain('SLAB')
    expect(priceLine(slabLine, cx, { ...base, catalog }).pricePerSqFt).toBe(9.97)
    expect(activeLists(toggleRetired(catalog, 'SLAB')).style).toContain('SLAB')
  })

  it('adds a colour with prices copied from another colour', () => {
    const base = defaultContext()
    const catalog = addEntry(base.catalog, 'colour', 'TEST BLUE (O)', { copyPricesFrom: 'GLACIER WHITE (O)' })
    expect(getPrice(catalog, 'SLAB', 'TEST BLUE (O)')).toBe(9.97)
    expect(priceLine({ ...slabLine, colour: 'TEST BLUE (O)' }, cx, { ...base, catalog }).pricePerSqFt).toBe(9.97)
  })

  it('adds a style, refusing duplicates (case-insensitive)', () => {
    const base = defaultContext()
    const catalog = addEntry(base.catalog, 'style', 'New Style', { edgeAdd: 1 })
    expect(catalog.lists.style).toContain('New Style')
    expect(addEntry(catalog, 'style', 'new style').lists.style.filter((s) => /new style/i.test(s))).toHaveLength(1)
  })
})

describe('diff and validation', () => {
  it('reports changed prices with before/after', () => {
    const base = defaultContext()
    const catalog = setPrice(base.catalog, 'SLAB', 'GLACIER WHITE (O)', 10.5)
    const d = diffContext(base, { ...base, catalog })
    expect(d).toEqual([{ kind: 'price', label: 'style: SLAB x GLACIER WHITE (O)', before: '9.97', after: '10.50' }])
  })
  it('reports parameter, added and retired changes without flooding on a copied colour', () => {
    const base = defaultContext()
    let catalog = addEntry(base.catalog, 'colour', 'TEST BLUE (O)', { copyPricesFrom: 'GLACIER WHITE (O)' })
    catalog = toggleRetired(catalog, 'PILLOW')
    const d = diffContext(base, { catalog, params: { ...base.params, hstRate: 0.15 } })
    expect(d.map((c) => c.kind).sort()).toEqual(['added', 'param', 'retired'])
  })
  it('no changes -> empty diff', () => {
    const base = defaultContext()
    expect(diffContext(base, structuredClone(base))).toEqual([])
  })
  it('blocks negative prices and silly parameters, but only warns about legacy gaps', () => {
    const base = defaultContext()
    expect(validate(base).errors).toEqual([])
    expect(validate(base).warnings.join()).toMatch(/no price column/)
    const bad = setPrice(base.catalog, 'SLAB', 'GLACIER WHITE (O)', -1)
    expect(validate({ catalog: bad, params: base.params }).errors.join()).toMatch(/Invalid price/)
    expect(validate({ catalog: base.catalog, params: { ...base.params, wasteFactor: 0.5 } }).errors.join()).toMatch(/Waste factor/)
  })
})
