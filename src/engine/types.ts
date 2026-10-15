export type AccountType = 'CASH' | 'HST ONLY' | 'HST WITH WASTE'

export interface Customer {
  id: string
  name: string
  accountType: AccountType
  /** "Door Edge" flag from Customer Data: edge sq ft is added to billable sq ft */
  doorEdge: boolean
}

/** One row of the order-entry grid. Dimensions are entered in inches (mm is derived). */
export interface LineInput {
  item: string
  back: string
  thick: number | string
  style: string
  /** Profile edge. 'SAME' (or equal to style) means no edge upcharge. */
  edge: string
  colour: string
  qty: number
  hIn: number
  wIn: number
}

export interface PricedLine {
  hMm: number
  wMm: number
  /** Billable sq ft per piece (waste factor, 1 sq ft minimum, door edge included) */
  sqFtEach: number
  edgeSqFt: number
  pricePerSqFt: number
  unitPrice: number
  total: number
  totalSqFt: number
  perimeterIn: number
  issues: string[]
}

export interface PricedOrder {
  lines: PricedLine[]
  totalQty: number
  totalSqFt: number
  subtotal: number
  discount: number
  taxableSubtotal: number
  hst: number
  total: number
  warnings: string[]
}

export interface Address {
  street: string
  city: string
  province: string
  postal: string
}

/** A named delivery address, like the "Ship To 1" dropdown in QuickBooks. */
export interface ShipTo {
  id: string
  label: string
  /** Name printed on the first address line (often the customer's name) */
  name: string
  address: Address
}

/** Customer as shown on the QuickBooks Sales Order: bill-to, ship-to options, rep, terms. */
export interface CustomerProfile extends Customer {
  phone: string
  fax: string
  terms: string
  defaultRep: string
  billTo: Address
  shipTos: ShipTo[]
}

export const emptyAddress = (): Address => ({ street: '', city: '', province: 'ON', postal: '' })

/** Address as it prints on a form: name, street, then "City, PROV Postal". */
export function addressLines(name: string, a: Address): string[] {
  // A bare default province ("ON") with nothing else is not an address
  const cityLine = a.city || a.postal ? [a.city, [a.province, a.postal].filter(Boolean).join(' ')].filter(Boolean).join(', ') : ''
  return [name, a.street, cityLine].filter((l) => l && l.trim() !== '')
}
