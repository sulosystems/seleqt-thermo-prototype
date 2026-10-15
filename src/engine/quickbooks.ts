import { round2, round3 } from './pricing'
import type { Address, LineInput, PricedOrder } from './types'

/**
 * Turns per-piece order-entry rows into the grouped lines staff currently key into the
 * QuickBooks Sales Order (ITEM / THICK / STYLE / COLOUR / QTY / SQ FT / $/SQFT / AMOUNT).
 *
 * ASSUMPTIONS to confirm with the client:
 *  - lines group by item + thickness + style + colour + rate
 *  - Sq Ft is rounded to 3 decimals, Amount to 2 (matches 30.189 x 9.97 = 300.98 in the screenshot)
 *  - the item names below are guessed from one screenshot
 */
export const QB_ITEM_NAMES: Record<string, string> = {
  door: 'MDF Doors',
  drawer: 'MDF Drawer',
  'toe kick 4.5"': 'MDF Toe Kick',
  filler: 'Filler',
  'light val': 'Light Valance',
  panel: 'MDF Panel',
}

export interface QbLine {
  item: string
  thick: string
  style: string
  colour: string
  qty: number
  sqFt: number
  rate: number
  amount: number
  /** HST tax code on the line ('H' in the screenshot) */
  tax: 'H' | ''
}

/** Header fields of the Sales Order (the customer block at the top of the QuickBooks form). */
export interface QbHeader {
  refNumber: string
  customer: string
  poNumber: string
  orderDate: string
  shipDate: string
  terms: string
  rep: string
  /** Customer message / special instructions */
  memo: string
  billName: string
  billTo: Address
  shipName: string
  shipTo: Address
}

export interface QbSalesOrder extends QbHeader {
  lines: QbLine[]
  subtotal: number
}

export const qbItemName = (item: string) => QB_ITEM_NAMES[item.trim().toLowerCase()] ?? item.trim()

const fmtThick = (t: number | string) => {
  const n = Number(t)
  if (!n) return ''
  const eighths = Math.round(n * 8)
  if (Math.abs(n * 8 - eighths) < 1e-6) {
    const g = (a: number, b: number): number => (b ? g(b, a % b) : a)
    const d = g(eighths, 8)
    return eighths % 8 === 0 ? String(eighths / 8) : `${eighths / d}/${8 / d}`
  }
  return String(n)
}

export function toQbLines(inputs: LineInput[], priced: PricedOrder, taxable: boolean): QbLine[] {
  const groups = new Map<string, QbLine>()
  inputs.forEach((l, i) => {
    const p = priced.lines[i]
    if (!p || p.totalSqFt === 0 || l.qty <= 0) return
    const item = qbItemName(l.item)
    const thick = fmtThick(l.thick)
    const style = l.style.trim()
    const key = [item, thick, style, l.colour, p.pricePerSqFt].join('|')
    const g = groups.get(key) ?? { item, thick, style, colour: l.colour, qty: 0, sqFt: 0, rate: p.pricePerSqFt, amount: 0, tax: taxable ? 'H' : '' }
    g.qty += l.qty
    g.sqFt += p.totalSqFt
    groups.set(key, g)
  })
  return [...groups.values()].map((g) => {
    const sqFt = round3(g.sqFt)
    return { ...g, sqFt, amount: round2(sqFt * g.rate) }
  })
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The qbXML a QuickBooks Web Connector job would send for this order.
 * Prototype only: Qty / Thick / Style / Colour custom columns are folded into Desc until we
 * confirm how the client's custom line-item columns are defined (DataExt on the line).
 */
const addrXml = (tag: string, name: string, a: Address) =>
  `        <${tag}>
          <Addr1>${esc(name)}</Addr1>${a.street ? `
          <Addr2>${esc(a.street)}</Addr2>` : ''}${a.city ? `
          <City>${esc(a.city)}</City>` : ''}${a.province ? `
          <State>${esc(a.province)}</State>` : ''}${a.postal ? `
          <PostalCode>${esc(a.postal)}</PostalCode>` : ''}
        </${tag}>`

export function toQbxml(so: QbSalesOrder): string {
  const lines = so.lines
    .map(
      (l) => `      <SalesOrderLineAdd>
        <ItemRef><FullName>${esc(l.item)}</FullName></ItemRef>
        <Desc>${esc([`${l.qty} pcs`, l.thick && `${l.thick}"`, l.style, l.colour].filter(Boolean).join(' / '))}</Desc>
        <Quantity>${l.sqFt}</Quantity>
        <Rate>${l.rate}</Rate>${l.tax ? `
        <SalesTaxCodeRef><FullName>${l.tax}</FullName></SalesTaxCodeRef>` : ''}
      </SalesOrderLineAdd>`,
    )
    .join('\n')
  // Element order follows the qbXML SalesOrderAdd schema.
  // ASSUMPTION: the customer message goes in Memo; CustomerMsgRef only accepts messages already defined in QuickBooks.
  const head = [
    `        <CustomerRef><FullName>${esc(so.customer)}</FullName></CustomerRef>`,
    so.orderDate && `        <TxnDate>${so.orderDate}</TxnDate>`,
    `        <RefNumber>${esc(so.refNumber)}</RefNumber>`,
    addrXml('BillAddress', so.billName, so.billTo),
    addrXml('ShipAddress', so.shipName, so.shipTo),
    so.poNumber && `        <PONumber>${esc(so.poNumber)}</PONumber>`,
    so.terms && `        <TermsRef><FullName>${esc(so.terms)}</FullName></TermsRef>`,
    so.rep && `        <SalesRepRef><FullName>${esc(so.rep)}</FullName></SalesRepRef>`,
    so.shipDate && `        <ShipDate>${so.shipDate}</ShipDate>`,
    so.memo && `        <Memo>${esc(so.memo)}</Memo>`,
  ]
    .filter(Boolean)
    .join('\n')
  return `<?xml version="1.0"?>
<?qbxml version="13.0"?>
<QBXML>
  <QBXMLMsgsRq onError="stopOnError">
    <SalesOrderAddRq>
      <SalesOrderAdd>
${head}
${lines}
      </SalesOrderAdd>
    </SalesOrderAddRq>
  </QBXMLMsgsRq>
</QBXML>`
}

/** QuickBooks rounds tax to the cent (650.43 x 13% = 84.56, total 734.99 in the screenshot). */
export function qbTotals(subtotal: number, taxable: boolean, hstRate = 0.13) {
  const hst = taxable ? round2(subtotal * hstRate) : 0
  return { subtotal: round2(subtotal), hst, total: round2(subtotal + hst) }
}

export function toQbSalesOrder(header: QbHeader, inputs: LineInput[], priced: PricedOrder, taxable: boolean): QbSalesOrder {
  const lines = toQbLines(inputs, priced, taxable)
  return { ...header, lines, subtotal: round2(lines.reduce((s, l) => s + l.amount, 0)) }
}
