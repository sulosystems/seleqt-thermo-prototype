import { describe, expect, it } from 'vitest'
import { priceOrder } from './pricing'
import { toQbSalesOrder, toQbxml } from './quickbooks'
import { addressLines } from './types'
import type { CustomerProfile, LineInput } from './types'
import { DEFAULT_CUSTOMERS, normalizeCustomer, restoreMissingDetails } from '../state'

const cabinetPro = DEFAULT_CUSTOMERS[0]
const line: LineInput = { item: 'Filler', back: 'NA/None', thick: 0.75, style: 'SLAB', edge: 'SLAB', colour: 'GLACIER WHITE (O)', qty: 5, hIn: 3, wIn: 10 }

describe('customer details (from the QuickBooks sample sales order)', () => {
  it('prints the address the way QuickBooks shows it', () => {
    expect(addressLines('Cabinet Pro', cabinetPro.billTo)).toEqual(['Cabinet Pro', '648 McKay St', 'Kingston, ON K7M 5V9'])
  })

  it('skips empty address parts', () => {
    expect(addressLines('X', { street: '', city: '', province: 'ON', postal: '' })).toEqual(['X'])
    expect(addressLines('X', { street: '1 A St', city: 'Kingston', province: 'ON', postal: '' })).toEqual(['X', '1 A St', 'Kingston, ON'])
  })

  it('fills in missing fields on older saved customers', () => {
    const c = normalizeCustomer({ id: 'C9', name: 'Old Customer', accountType: 'CASH', doorEdge: false })
    expect(c.terms).toBe('Net 30')
    expect(c.shipTos).toHaveLength(1)
    expect(c.shipTos[0].label).toBe('Ship To 1')
    expect(c.shipTos[0].name).toBe('Old Customer')
  })

  it('puts customer, addresses, PO, terms, rep, dates and message in the qbXML header', () => {
    const priced = priceOrder([line], cabinetPro)
    const so = toQbSalesOrder(
      {
        refNumber: '30673', customer: cabinetPro.name, poNumber: '760385-00B', orderDate: '2026-07-29', shipDate: '2026-08-14',
        terms: 'Net 30', rep: 'AB', memo: 'Deliver & call <ahead>',
        billName: cabinetPro.name, billTo: cabinetPro.billTo, shipName: 'Cabinet Pro', shipTo: cabinetPro.shipTos[0].address,
      },
      [line], priced, true,
    )
    const xml = toQbxml(so)
    expect(xml).toContain('<FullName>Cabinet Pro</FullName>')
    expect(xml).toContain('<TxnDate>2026-07-29</TxnDate>')
    expect(xml).toContain('<RefNumber>30673</RefNumber>')
    expect(xml).toContain('<Addr2>648 McKay St</Addr2>')
    expect(xml).toContain('<PostalCode>K7M 5V9</PostalCode>')
    expect(xml).toContain('<PONumber>760385-00B</PONumber>')
    expect(xml).toContain('<TermsRef><FullName>Net 30</FullName></TermsRef>')
    expect(xml).toContain('<SalesRepRef><FullName>AB</FullName></SalesRepRef>')
    expect(xml).toContain('<ShipDate>2026-08-14</ShipDate>')
    expect(xml).toContain('<Memo>Deliver &amp; call &lt;ahead&gt;</Memo>')
    // schema order: bill address before PO, rep before ship date, memo before the lines
    expect(xml.indexOf('BillAddress')).toBeLessThan(xml.indexOf('PONumber'))
    expect(xml.indexOf('SalesRepRef')).toBeLessThan(xml.indexOf('ShipDate'))
    expect(xml.indexOf('<Memo>')).toBeLessThan(xml.indexOf('SalesOrderLineAdd'))
  })

  it('omits optional header fields that are empty', () => {
    const priced = priceOrder([line], cabinetPro)
    const so = toQbSalesOrder(
      {
        refNumber: '1', customer: 'C', poNumber: '', orderDate: '', shipDate: '', terms: '', rep: '', memo: '',
        billName: 'C', billTo: cabinetPro.billTo, shipName: 'C', shipTo: cabinetPro.billTo,
      },
      [line], priced, true,
    )
    const xml = toQbxml(so)
    for (const tag of ['PONumber', 'TermsRef', 'SalesRepRef', 'ShipDate', 'Memo', 'TxnDate']) expect(xml).not.toContain(tag)
  })
})

describe('restoring blank demo-customer details from older saved data', () => {
  const stale = (): CustomerProfile => ({
    ...structuredClone(DEFAULT_CUSTOMERS[0]),
    billTo: { street: '', city: '', province: 'ON', postal: '' },
    shipTos: [{ id: 'S1', label: 'Ship To 1', name: 'Cabinet Pro', address: { street: '', city: '', province: 'ON', postal: '' } }],
  })

  it('refills blank bill-to and ship-to addresses from the built-in sample', () => {
    const c = restoreMissingDetails(stale())
    expect(addressLines(c.name, c.billTo)).toEqual(['Cabinet Pro', '648 McKay St', 'Kingston, ON K7M 5V9'])
    expect(c.shipTos[0].address.street).toBe('648 McKay St')
  })

  it('keeps an address an admin typed in', () => {
    const typed = stale()
    typed.billTo = { street: '123 Sample Street', city: 'Toronto', province: 'ON', postal: 'L4L 5P7' }
    expect(restoreMissingDetails(typed).billTo.street).toBe('123 Sample Street')
  })

  it('leaves customers that are not built-in samples alone', () => {
    const other = normalizeCustomer({ id: 'C9', name: 'New Co', accountType: 'CASH', doorEdge: false })
    expect(restoreMissingDetails(other).billTo.street).toBe('')
  })

  it('gives the demo customers sample phone and fax numbers', () => {
    expect(DEFAULT_CUSTOMERS[1].phone).not.toBe('')
    expect(DEFAULT_CUSTOMERS[2].fax).not.toBe('')
  })
})
