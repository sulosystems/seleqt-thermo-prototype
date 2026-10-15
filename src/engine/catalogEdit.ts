import { EDGE_COLUMN, colourName, findRow } from './catalog'
import type { Catalog, PricingContext, Section } from './catalog'

/** Pure helpers behind the admin screen. Every edit returns a new catalog; nothing is mutated. */

export const SECTION_LABEL: Record<Section, string> = {
  item: 'Items',
  back: 'Backs',
  thick: 'Thickness',
  style: 'Styles',
  colour: 'Colours',
}

export interface Change {
  kind: 'price' | 'edge' | 'param' | 'added' | 'retired' | 'restored' | 'customer'
  label: string
  before?: string
  after?: string
}

export interface Validation {
  /** Block publishing */
  errors: string[]
  /** Existing data problems, shown but not blocking */
  warnings: string[]
}

const clone = <T,>(x: T): T => structuredClone(x)
const dash = '-'
const fmt = (v: number | undefined) => (v === undefined ? dash : v.toFixed(2))

/** The row an edit applies to: the first match, which is also the one pricing uses. */
function editableRow(cat: Catalog, key: string | number) {
  return findRow(cat, key)
}

export function getPrice(cat: Catalog, key: string | number, colour: string): number | undefined {
  const col = cat.colourCols[colour]
  return col === undefined ? undefined : editableRow(cat, key)?.cells[String(col)]
}

/** Set (or clear, with undefined) the price of a style/item/back/thickness for one colour. */
export function setPrice(cat: Catalog, key: string | number, colour: string, value: number | undefined): Catalog {
  const next = clone(cat)
  const col = next.colourCols[colour]
  const row = editableRow(next, key)
  if (col === undefined || !row) return next
  if (value === undefined || Number.isNaN(value)) delete row.cells[String(col)]
  else row.cells[String(col)] = value
  return next
}

export const getEdgeAdd = (cat: Catalog, key: string | number): number | undefined => editableRow(cat, key)?.cells[String(EDGE_COLUMN)]

export function setEdgeAdd(cat: Catalog, key: string | number, value: number | undefined): Catalog {
  const next = clone(cat)
  const row = editableRow(next, key)
  if (!row) return next
  if (value === undefined || Number.isNaN(value)) delete row.cells[String(EDGE_COLUMN)]
  else row.cells[String(EDGE_COLUMN)] = value
  return next
}

export function toggleRetired(cat: Catalog, name: string | number): Catalog {
  const next = clone(cat)
  const n = String(name)
  next.retired = next.retired.includes(n) ? next.retired.filter((r) => r !== n) : [...next.retired, n]
  return next
}

const nextRowId = (cat: Catalog) => Math.max(0, ...cat.rows.map((r) => r.row)) + 1

export const nameTaken = (cat: Catalog, section: 'item' | 'style' | 'colour', name: string) =>
  cat.lists[section].some((x) => String(x).trim().toLowerCase() === name.trim().toLowerCase())

export interface AddOptions {
  /** Colours only: copy every price from this existing colour. */
  copyPricesFrom?: string
  /** Styles only: profile edge add. */
  edgeAdd?: number
}

export function addEntry(cat: Catalog, section: 'item' | 'style' | 'colour', rawName: string, opts: AddOptions = {}): Catalog {
  const name = rawName.trim()
  if (!name || nameTaken(cat, section, name)) return cat
  const next = clone(cat)
  next.lists[section].push(name)
  if (section === 'colour') {
    const col = Math.max(0, ...Object.values(next.colourCols)) + 1
    next.colourCols[name] = col
    const src = opts.copyPricesFrom ? next.colourCols[opts.copyPricesFrom] : undefined
    if (src !== undefined) {
      for (const r of next.rows) if (r.cells[String(src)] !== undefined) r.cells[String(col)] = r.cells[String(src)]
    }
    next.rows.push({ row: nextRowId(next), key: name, cells: {} }) // PVC-skin lookup row
  } else {
    const cells: Record<string, number> = {}
    if (section === 'style' && opts.edgeAdd !== undefined) cells[String(EDGE_COLUMN)] = opts.edgeAdd
    next.rows.push({ row: nextRowId(next), key: name, cells })
  }
  return next
}

export function validate(ctx: PricingContext): Validation {
  const errors: string[] = []
  const warnings: string[] = []
  const { catalog, params } = ctx

  if (!(params.wasteFactor >= 1 && params.wasteFactor <= 2)) errors.push('Waste factor must be between 1.00 (no waste) and 2.00')
  if (!(params.hstRate >= 0 && params.hstRate <= 0.5)) errors.push('HST rate must be between 0% and 50%')

  for (const r of catalog.rows) {
    for (const [col, v] of Object.entries(r.cells)) {
      if (!Number.isFinite(v) || v < 0) errors.push(`Invalid price for ${r.key} (${colourName(catalog, Number(col)) ?? `column ${col}`}): ${v}`)
    }
  }
  for (const s of ['item', 'style', 'colour'] as const) {
    const seen = new Set<string>()
    for (const n of catalog.lists[s]) {
      const k = String(n).trim().toLowerCase()
      if (seen.has(k)) errors.push(`Duplicate ${s}: ${n}`)
      seen.add(k)
    }
  }
  const retired = new Set(catalog.retired)
  const noCol = catalog.lists.colour.filter((c) => catalog.colourCols[c] === undefined && !retired.has(c))
  if (noCol.length) warnings.push(`${noCol.length} active colours have no price column (they cannot be priced): ${noCol.slice(0, 4).join(', ')}${noCol.length > 4 ? ', ...' : ''}`)
  return { errors, warnings }
}

/** Human-readable list of everything that differs between the published and draft catalog/parameters. */
export function diffContext(before: PricingContext, after: PricingContext): Change[] {
  const out: Change[] = []
  const b = before.catalog
  const a = after.catalog

  if (before.params.wasteFactor !== after.params.wasteFactor)
    out.push({ kind: 'param', label: 'Waste factor', before: String(before.params.wasteFactor), after: String(after.params.wasteFactor) })
  if (before.params.hstRate !== after.params.hstRate)
    out.push({ kind: 'param', label: 'HST rate', before: `${(before.params.hstRate * 100).toFixed(2)}%`, after: `${(after.params.hstRate * 100).toFixed(2)}%` })

  const sectionOf = (key: string | number): string => {
    for (const s of ['style', 'item', 'back', 'thick'] as const) if (a.lists[s].some((x) => String(x) === String(key))) return s
    return 'row'
  }

  const newColours = Object.keys(a.colourCols).filter((c) => !(c in b.colourCols))
  const newCols = new Set(newColours.map((c) => String(a.colourCols[c])))
  for (const c of newColours) {
    const n = a.rows.filter((r) => r.cells[String(a.colourCols[c])] !== undefined).length
    out.push({ kind: 'added', label: `Colour: ${c}`, after: `${n} prices` })
  }
  for (const s of ['item', 'style'] as const) {
    for (const n of a.lists[s].filter((x) => !b.lists[s].includes(x))) {
      const cnt = Object.keys(findRow(a, n)?.cells ?? {}).length
      out.push({ kind: 'added', label: `${s === 'style' ? 'Style' : 'Item'}: ${n}`, after: cnt ? `${cnt} values` : 'no prices yet' })
    }
  }

  const beforeRows = new Map(b.rows.map((r) => [r.row, r]))
  for (const r of a.rows) {
    const old = beforeRows.get(r.row)
    if (!old) continue // new rows are reported above
    const cols = new Set([...Object.keys(old.cells), ...Object.keys(r.cells)])
    for (const col of cols) {
      if (newCols.has(col)) continue
      const x = old.cells[col]
      const y = r.cells[col]
      if (x === y) continue
      const colNo = Number(col)
      if (colNo === EDGE_COLUMN) out.push({ kind: 'edge', label: `${sectionOf(r.key)}: ${r.key} - profile edge add`, before: fmt(x), after: fmt(y) })
      else if (colourName(a, colNo)) out.push({ kind: 'price', label: `${sectionOf(r.key)}: ${String(r.key).trim()} x ${colourName(a, colNo)}`, before: fmt(x), after: fmt(y) })
    }
  }

  const bRet = new Set(b.retired)
  const aRet = new Set(a.retired)
  for (const n of aRet) if (!bRet.has(n)) out.push({ kind: 'retired', label: `Retired: ${n.trim()}` })
  for (const n of bRet) if (!aRet.has(n)) out.push({ kind: 'restored', label: `Restored: ${n.trim()}` })
  return out
}
