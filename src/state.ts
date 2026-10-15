import { useCallback, useEffect, useState } from 'react'
import { defaultContext } from './engine/catalog'
import type { PricingContext } from './engine/catalog'
import type { Change } from './engine/catalogEdit'
import { emptyAddress } from './engine/types'
import type { Address, CustomerProfile } from './engine/types'

const addr = (street: string, city: string, province: string, postal: string): Address => ({ street, city, province, postal })

// Demo customers only - the real list will sync from QuickBooks. Cabinet Pro's address is from the client's sample sales order.
export const DEFAULT_CUSTOMERS: CustomerProfile[] = [
  {
    id: 'C1', name: 'Cabinet Pro', accountType: 'HST ONLY', doorEdge: false,
    phone: '', fax: '', terms: 'Net 30', defaultRep: '',
    billTo: addr('648 McKay St', 'Kingston', 'ON', 'K7M 5V9'),
    shipTos: [{ id: 'S1', label: 'Ship To 1', name: 'Cabinet Pro', address: addr('648 McKay St', 'Kingston', 'ON', 'K7M 5V9') }],
  },
  {
    id: 'C2', name: 'Demo Cash Customer', accountType: 'CASH', doorEdge: false,
    phone: '416-555-0142', fax: '416-555-0143', terms: 'Due on receipt', defaultRep: '',
    billTo: addr('100 Demo Rd', 'Toronto', 'ON', 'M1M 1M1'),
    shipTos: [{ id: 'S1', label: 'Ship To 1', name: 'Demo Cash Customer', address: addr('100 Demo Rd', 'Toronto', 'ON', 'M1M 1M1') }],
  },
  {
    id: 'C3', name: 'Demo Waste + Edge Customer', accountType: 'HST WITH WASTE', doorEdge: true,
    phone: '905-555-0178', fax: '905-555-0179', terms: 'Net 30', defaultRep: '',
    billTo: addr('200 Sample Ave', 'Mississauga', 'ON', 'L5B 1A1'),
    shipTos: [
      { id: 'S1', label: 'Ship To 1', name: 'Demo Waste + Edge Customer', address: addr('200 Sample Ave', 'Mississauga', 'ON', 'L5B 1A1') },
      { id: 'S2', label: 'Job site - Oakville', name: 'Demo Waste + Edge Customer', address: addr('15 Builder Ln', 'Oakville', 'ON', 'L6H 2B2') },
    ],
  },
]

export const DEFAULT_REPS: string[] = []

/** Fill in fields that older saved data (or a QuickBooks sync) may not have. */
export function normalizeCustomer(c: Partial<CustomerProfile> & Pick<CustomerProfile, 'id' | 'name' | 'accountType' | 'doorEdge'>): CustomerProfile {
  const billTo = { ...emptyAddress(), ...c.billTo }
  return {
    ...c,
    phone: c.phone ?? '',
    fax: c.fax ?? '',
    terms: c.terms ?? 'Net 30',
    defaultRep: c.defaultRep ?? '',
    billTo,
    shipTos: c.shipTos?.length ? c.shipTos : [{ id: 'S1', label: 'Ship To 1', name: c.name, address: { ...billTo } }],
  }
}

const isBlank = (a?: Address) => !a || !(a.street || a.city || a.postal)

/**
 * Older saved copies of the built-in demo customers may have blank addresses or contact details
 * (an earlier version saved them empty). Refill anything blank from the matching built-in customer.
 * Anything an admin has actually typed is kept.
 */
export function restoreMissingDetails(c: CustomerProfile): CustomerProfile {
  const merged = normalizeCustomer({ ...DEFAULT_CUSTOMERS.find((x) => x.id === c.id && x.name === c.name), ...c })
  const def = DEFAULT_CUSTOMERS.find((x) => x.id === c.id && x.name === c.name)
  if (!def) return merged
  return {
    ...merged,
    phone: merged.phone || def.phone,
    fax: merged.fax || def.fax,
    billTo: isBlank(merged.billTo) ? def.billTo : merged.billTo,
    shipTos: merged.shipTos.map((st) => {
      const d = def.shipTos.find((x) => x.id === st.id)
      return d && isBlank(st.address) ? { ...st, address: d.address } : st
    }),
  }
}

export interface LogEntry {
  id: number
  at: string
  by: string
  note: string
  changes: Change[]
}

/** Everything the admin screen controls. Prototype: kept in this browser's localStorage. */
export interface AppData {
  ctx: PricingContext
  customers: CustomerProfile[]
  reps: string[]
  log: LogEntry[]
}

const KEY = 'seleqt-prototype-admin-v1'

const fresh = (): AppData => ({ ctx: defaultContext(), customers: structuredClone(DEFAULT_CUSTOMERS), reps: [...DEFAULT_REPS], log: [] })

function load(): AppData {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const d = JSON.parse(raw) as AppData
      if (Array.isArray(d.ctx?.catalog?.rows) && Array.isArray(d.customers) && Array.isArray(d.log)) {
        return { ...d, customers: d.customers.map(restoreMissingDetails), reps: Array.isArray(d.reps) ? d.reps : [...DEFAULT_REPS] }
      }
    }
  } catch {
    /* storage unavailable or corrupt: start from the workbook's catalog */
  }
  return fresh()
}

export function useAppData() {
  const [data, setData] = useState<AppData>(load)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(data))
    } catch {
      /* ignore */
    }
  }, [data])

  /** Publish a draft: becomes the live catalog/parameters/customers and is recorded in the change log. */
  const publish = useCallback((ctx: PricingContext, customers: CustomerProfile[], reps: string[], note: string, changes: Change[]) => {
    setData((d) => ({
      ctx,
      customers,
      reps,
      log: [{ id: (d.log[0]?.id ?? 0) + 1, at: new Date().toISOString(), by: 'Admin (prototype)', note, changes }, ...d.log],
    }))
  }, [])

  const resetToWorkbook = useCallback(() => setData(fresh()), [])

  return { data, publish, resetToWorkbook }
}
