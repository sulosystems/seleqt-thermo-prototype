import type { Params, PricingContext } from './catalog'
import { priceOrder } from './pricing'
import type { CustomerProfile, LineInput, PricedOrder } from './types'

/**
 * What an order was priced with when it was confirmed. Confirmed orders (and everything printed
 * or sent to QuickBooks from them) read from this, never from the live catalog, so a later
 * price, parameter or customer change cannot silently alter an order that was already issued.
 */
export interface OrderSnapshot {
  takenAt: string
  /** Catalog version (number of admin publishes) in force at the time */
  catalogVersion: number
  params: Params
  /** The customer as it was: account type, door edge, terms and addresses */
  customer: CustomerProfile
  discountPct: number
  /** The fully priced order: per-line sq ft, $/sf, unit price and totals, plus HST */
  priced: PricedOrder
}

export function makeSnapshot(
  lines: LineInput[],
  customer: CustomerProfile,
  discountPct: number,
  ctx: PricingContext,
  catalogVersion: number,
  takenAt: string = new Date().toISOString(),
): OrderSnapshot {
  return structuredClone({
    takenAt,
    catalogVersion,
    params: ctx.params,
    customer,
    discountPct,
    priced: priceOrder(lines, customer, discountPct / 100, ctx),
  })
}

export interface LiveComparison {
  /** True when pricing today would differ from the locked prices */
  changed: boolean
  lockedTotal: number
  liveTotal: number
  delta: number
  /** Zero-based indexes of rows whose price would change */
  changedRows: number[]
}

/** Would re-pricing this order today give a different result than the snapshot? */
export function compareToLive(
  snapshot: OrderSnapshot,
  lines: LineInput[],
  liveCustomer: CustomerProfile | undefined,
  ctx: PricingContext,
): LiveComparison {
  const live = priceOrder(lines, liveCustomer ?? snapshot.customer, snapshot.discountPct / 100, ctx)
  const changedRows = lines
    .map((_, i) => i)
    .filter((i) => {
      const a = snapshot.priced.lines[i]
      const b = live.lines[i]
      return !a || !b || Math.abs(a.total - b.total) > 0.004 || Math.abs(a.sqFtEach - b.sqFtEach) > 1e-9
    })
  const delta = live.total - snapshot.priced.total
  return {
    changed: changedRows.length > 0 || Math.abs(delta) > 0.004,
    lockedTotal: snapshot.priced.total,
    liveTotal: live.total,
    delta,
    changedRows,
  }
}
