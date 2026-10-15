import { EDGE_COLUMN, activeLists, defaultContext, defaultParams, findRow } from './catalog'
import type { Catalog, Lists, Params, PricingContext } from './catalog'
import type { Customer, LineInput, PricedLine, PricedOrder } from './types'

/**
 * Port of the SO-Order Entry formulas (cols I..U) and Invoice totals.
 * Excel references are given in comments so results can be traced back to the workbook.
 * Prices and parameters come from a PricingContext so the admin screen can change them;
 * the calculation steps themselves stay here, in tested code.
 */

export const WASTE_FACTOR = defaultParams.wasteFactor // M15: 14.75% waste for CASH / HST WITH WASTE accounts
export const HST_RATE = defaultParams.hstRate // Invoice!K9
const PVC_SKIN_COLUMN = 2 // N15: PVC skin is priced from col B by colour name

const baseContext: PricingContext = defaultContext()

/** VLOOKUP(key, 'Pricing Data'!A5:JH1082, col, FALSE): first match, blank cell -> 0, no match -> undefined (#N/A). */
export function vlookup(key: string | number, col: number, catalog: Catalog = baseContext.catalog): number | undefined {
  const hit = findRow(catalog, key)
  if (!hit) return undefined
  return hit.cells[String(col)] ?? 0
}

/** R15: HLOOKUP(colour, 'Pricing Data'!E2:JH4, 3, FALSE): column that holds this colour's prices. */
export function colourColumn(colour: string, catalog: Catalog = baseContext.catalog): number | undefined {
  const name = Object.keys(catalog.colourCols).find((c) => c.toLowerCase() === colour.toLowerCase())
  return name === undefined ? undefined : catalog.colourCols[name]
}

/** Dropdown lists of the default catalog (exact duplicates removed; VLOOKUP only ever uses the first). */
export const lists: Lists = activeLists(baseContext.catalog)

/** Catalog problems worth cleaning up before go-live. */
export const catalogIssues = {
  coloursWithoutPriceColumn: lists.colour.filter((c) => colourColumn(c) === undefined),
  placeholders: lists.style.filter((s) => /temp/i.test(s)),
}

const round = (n: number, dp: number) => Math.round((n + Number.EPSILON) * 10 ** dp) / 10 ** dp
export const round2 = (n: number) => round(n, 2)
export const round3 = (n: number) => round(n, 3)

export const hasWaste = (c: Customer) => c.accountType === 'CASH' || c.accountType === 'HST WITH WASTE'
export const chargesHst = (c: Customer) => c.accountType !== 'CASH'

export function priceLine(line: LineInput, customer: Customer, ctx: PricingContext = baseContext): PricedLine {
  const { catalog, params } = ctx
  const issues: string[] = []
  const { hIn, wIn, qty } = line
  const hMm = hIn * 25.4
  const wMm = wIn * 25.4
  const thick = Number(line.thick) || 0

  // S15: door edge sq ft per piece (only for customers flagged "Door Edge")
  const edgeSqFt = customer.doorEdge ? (thick * (hIn * 2 + wIn * 2)) / 144 : 0

  // M15: billable sq ft per piece
  let sqFtEach = 0
  if (hMm + wMm !== 0) {
    const area = (hIn * wIn) / 144
    const factor = hasWaste(customer) ? params.wasteFactor : 1
    // Pieces under 1 sq ft are billed as the minimum (1, or the waste factor with waste)
    sqFtEach = (area > 1 ? area * factor : factor) + edgeSqFt
  }

  let pricePerSqFt = 0
  if (sqFtEach !== 0) {
    if (line.item.trim().toLowerCase() === 'pvc skin') {
      const p = vlookup(line.colour, PVC_SKIN_COLUMN, catalog)
      if (p === undefined) issues.push(`PVC skin colour "${line.colour}" not found`)
      pricePerSqFt = p ?? 0
    } else {
      const col = colourColumn(line.colour, catalog)
      if (col === undefined) {
        issues.push(`Colour "${line.colour}" has no price column (Excel shows #N/A)`)
      } else {
        const parts: [string, string | number][] = [
          ['item', line.item],
          ['back', line.back],
          ['thickness', line.thick],
          ['style', line.style],
        ]
        for (const [label, key] of parts) {
          const v = vlookup(key, col, catalog)
          if (v === undefined) issues.push(`Unknown ${label} "${key}"`)
          pricePerSqFt += v ?? 0
        }
        if (line.edge !== line.style) {
          const e = vlookup(line.edge, EDGE_COLUMN, catalog)
          if (e === undefined) issues.push(`Unknown profile edge "${line.edge}"`)
          pricePerSqFt += e ?? 0
        }
        if (pricePerSqFt === 0) issues.push('Price is $0.00 - no price on file for this combination')
      }
    }
  }

  const unitPrice = hIn === 0 ? 0 : pricePerSqFt * sqFtEach // O15
  const total = qty > 0 ? unitPrice * qty : 0 // P15
  return {
    hMm,
    wMm,
    sqFtEach,
    edgeSqFt,
    pricePerSqFt,
    unitPrice,
    total,
    totalSqFt: sqFtEach === 0 ? 0 : sqFtEach * qty, // T15
    perimeterIn: (hIn * 2 + wIn * 2) * qty, // U15
    issues,
  }
}

export function priceOrder(lines: LineInput[], customer: Customer, discount = 0, ctx: PricingContext = baseContext): PricedOrder {
  const priced = lines.map((l) => priceLine(l, customer, ctx))
  const totalQty = lines.reduce((s, l) => s + (l.qty || 0), 0) // O12
  const totalSqFt = priced.reduce((s, l) => s + l.totalSqFt, 0)
  const subtotal = priced.reduce((s, l) => s + l.total, 0)
  const taxableSubtotal = subtotal * (1 - discount) // Invoice!K8
  const hst = chargesHst(customer) ? taxableSubtotal * ctx.params.hstRate : 0 // Invoice!K9

  const warnings: string[] = []
  // I11 "Call Customer - WASTE ISSUE": qty not divisible by 9 and first line under $8/sf.
  // Meaning not confirmed with the client yet (looks like a tray-packing check).
  if (totalQty > 0 && totalQty % 9 !== 0 && priced[0] && priced[0].pricePerSqFt < 8) {
    warnings.push('Call Customer - WASTE ISSUE (qty not a multiple of 9 and price/sf under $8) - rule to be confirmed')
  }
  return { lines: priced, totalQty, totalSqFt, subtotal, discount, taxableSubtotal, hst, total: taxableSubtotal + hst, warnings }
}

export type { Params }
