import { useCallback, useEffect, useState } from 'react'
import type { OrderSnapshot } from './engine/snapshot'
import type { CustomerProfile, LineInput } from './engine/types'

export type OrderStatus = 'draft' | 'confirmed'

export interface HistoryEntry {
  at: string
  text: string
}

export interface Order {
  id: string
  jo: string
  status: OrderStatus
  /** Present only while confirmed: the prices the order was locked at */
  snapshot?: OrderSnapshot
  history: HistoryEntry[]
  customerId: string
  shipToId: string
  rep: string
  po: string
  orderDate: string
  shipDate: string
  /** Special instructions / notes: printed on the cut list */
  notes: string
  /** Customer message: printed on the packing slip and invoice, sent to QuickBooks as the memo */
  customerMessage: string
  discountPct: number
  lines: LineInput[]
}

export const blankLine = (): LineInput => ({
  item: 'Door', back: 'NA/None', thick: 0.75, style: 'SLAB', edge: 'SAME', colour: 'GLACIER WHITE (O)', qty: 1, hIn: 0, wIn: 0,
})

const today = () => new Date().toISOString().slice(0, 10)
const entry = (text: string): HistoryEntry => ({ at: new Date().toISOString(), text })
export const addHistory = (o: Order, text: string): Order => ({ ...o, history: [...o.history, entry(text)] })

const uid = () => `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** Next job order number: one more than the highest numeric JO in use. */
export function nextJo(orders: Pick<Order, 'jo'>[], start = 30790): string {
  const nums = orders.map((o) => Number(o.jo)).filter((n) => Number.isFinite(n) && n > 0)
  return String(nums.length ? Math.max(...nums) + 1 : start)
}

export function newOrder(jo: string, customer: CustomerProfile): Order {
  return {
    id: uid(), jo, status: 'draft', history: [entry('Order created')],
    customerId: customer.id, shipToId: customer.shipTos[0].id, rep: customer.defaultRep,
    po: '', orderDate: today(), shipDate: '', notes: '', customerMessage: '', discountPct: 0,
    lines: [blankLine()],
  }
}

// JO 30789 from the workbook: 60 x 45 door, expected $75.00 / $84.75 with HST
export function sampleOrder(jo: string, customer: CustomerProfile): Order {
  return {
    ...newOrder(jo, customer),
    po: '289962-00 SPRINGER 2',
    lines: [
      { item: 'Door', back: 'WHT', thick: 0.75, style: 'Classic Manhattan-MISSISSAUGA', edge: 'SAME', colour: 'ACAJOU MAHOGANY (O)-', qty: 1, hIn: 60, wIn: 45 },
      { item: 'Door', back: 'NA/None', thick: 0.75, style: 'SLAB', edge: 'SAME', colour: 'GLACIER WHITE (O)', qty: 4, hIn: 30, wIn: 17.5 },
      { item: 'Filler', back: 'NA/None', thick: 0.75, style: 'SLAB', edge: 'SAME', colour: 'GLACIER WHITE (O)', qty: 5, hIn: 3, wIn: 30 },
    ],
  }
}

interface Store {
  orders: Order[]
  currentId: string
}

const KEY = 'seleqt-prototype-orders-v2'
const LEGACY_KEY = 'seleqt-prototype-order-v1' // single-order version of the prototype

function load(defaultCustomer: CustomerProfile): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = JSON.parse(raw) as Store
      if (Array.isArray(s.orders) && s.orders.length > 0) return { orders: s.orders, currentId: s.orders.some((o) => o.id === s.currentId) ? s.currentId : s.orders[0].id }
    }
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const base = sampleOrder('30790', defaultCustomer)
      const o: Order = { ...base, ...(JSON.parse(legacy) as Partial<Order>), id: base.id, status: 'draft', history: base.history }
      delete o.snapshot
      return { orders: [o], currentId: o.id }
    }
  } catch {
    /* storage unavailable or corrupt: start from the sample */
  }
  const o = sampleOrder('30790', defaultCustomer)
  return { orders: [o], currentId: o.id }
}

export function useOrders(defaultCustomer: CustomerProfile) {
  const [store, setStore] = useState<Store>(() => load(defaultCustomer))

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(store))
    } catch {
      /* ignore */
    }
  }, [store])

  const current = store.orders.find((o) => o.id === store.currentId) ?? store.orders[0]

  const update = useCallback((id: string, fn: (o: Order) => Order) => {
    setStore((s) => ({ ...s, orders: s.orders.map((o) => (o.id === id ? fn(o) : o)) }))
  }, [])

  const select = useCallback((id: string) => setStore((s) => ({ ...s, currentId: id })), [])

  const create = useCallback((customer: CustomerProfile) => {
    setStore((s) => {
      const o = newOrder(nextJo(s.orders), customer)
      return { orders: [...s.orders, o], currentId: o.id }
    })
  }, [])

  /** Copy an order's lines and header into a fresh draft: it gets today's live prices. */
  const duplicate = useCallback((id: string) => {
    setStore((s) => {
      const src = s.orders.find((o) => o.id === id)
      if (!src) return s
      const o: Order = {
        ...structuredClone(src), id: uid(), jo: nextJo(s.orders), status: 'draft', snapshot: undefined,
        orderDate: today(), shipDate: '', history: [entry(`Duplicated from JO ${src.jo}`)],
      }
      delete o.snapshot
      return { orders: [...s.orders, o], currentId: o.id }
    })
  }, [])

  /** Only drafts can be deleted: a confirmed order is a record. */
  const remove = useCallback((id: string) => {
    setStore((s) => {
      const target = s.orders.find((o) => o.id === id)
      if (!target || target.status === 'confirmed' || s.orders.length <= 1) return s
      const orders = s.orders.filter((o) => o.id !== id)
      return { orders, currentId: s.currentId === id ? orders[0].id : s.currentId }
    })
  }, [])

  return { orders: store.orders, current, update, select, create, duplicate, remove }
}
