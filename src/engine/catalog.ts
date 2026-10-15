import data from '../data/pricing.json'

/** One row of the workbook's 'Pricing Data' tab. `cells` is sparse: column number -> price. */
export interface PriceRow {
  row: number
  key: string | number
  cells: Record<string, number>
}

export interface Lists {
  item: string[]
  back: string[]
  thick: (string | number)[]
  style: string[]
  colour: string[]
}

export type Section = keyof Lists

export interface Catalog {
  rows: PriceRow[]
  /** colour name -> price column number */
  colourCols: Record<string, number>
  lists: Lists
  /** Names hidden from dropdowns but kept so old orders still price. */
  retired: string[]
}

/** Business parameters that used to be hard-coded in formulas. */
export interface Params {
  /** Billable-area multiplier for CASH / HST WITH WASTE accounts (1.1475 = 14.75%). */
  wasteFactor: number
  hstRate: number
}

export interface PricingContext {
  catalog: Catalog
  params: Params
}

/** Column that holds the "Profile Edge Add" on style rows (VLOOKUP col 4 in the workbook). */
export const EDGE_COLUMN = 4

export const defaultParams: Params = { wasteFactor: 1.1475, hstRate: 0.13 }

const raw = data as unknown as { rows: PriceRow[]; colourCols: Record<string, number>; lists: Lists }
const uniq = <T,>(xs: T[]) => [...new Set(xs)]

/** The catalog as extracted from the workbook (exact duplicates in the dropdown lists removed). */
export const defaultCatalog = (): Catalog =>
  structuredClone({
    rows: raw.rows,
    colourCols: raw.colourCols,
    lists: {
      item: uniq(raw.lists.item),
      back: uniq(raw.lists.back),
      thick: uniq(raw.lists.thick),
      style: uniq(raw.lists.style),
      colour: uniq(raw.lists.colour),
    },
    retired: [],
  })

export const defaultContext = (): PricingContext => ({ catalog: defaultCatalog(), params: { ...defaultParams } })

const norm = (v: string | number) => (typeof v === 'number' ? v : v.toLowerCase())

/** First row whose key matches, like VLOOKUP(..., FALSE) (case-insensitive). */
export function findRow(catalog: Catalog, key: string | number): PriceRow | undefined {
  const k = typeof key === 'string' && key.trim() !== '' && !isNaN(Number(key)) ? Number(key) : key
  return catalog.rows.find((r) => norm(r.key) === norm(k))
}

/** Active (non-retired) dropdown values. */
export function activeLists(catalog: Catalog): Lists {
  const hidden = new Set(catalog.retired.map(String))
  const keep = <T extends string | number>(xs: T[]) => xs.filter((x) => !hidden.has(String(x)))
  return {
    item: keep(catalog.lists.item),
    back: keep(catalog.lists.back),
    thick: keep(catalog.lists.thick),
    style: keep(catalog.lists.style),
    colour: keep(catalog.lists.colour),
  }
}

export const colourName = (catalog: Catalog, col: number) =>
  Object.keys(catalog.colourCols).find((c) => catalog.colourCols[c] === col)
