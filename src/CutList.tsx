import { useState } from 'react'
import logo from './assets/seleqt-logo.png'
import { formatInches, formatSheetDate, formatThickness, isNonStandardThickness, qcStation } from './engine/format'
import type { CustomerProfile, LineInput, PricedOrder, ShipTo } from './engine/types'
import { addressLines } from './engine/types'
import type { Order } from './orders'

interface Props {
  order: Order
  customer: CustomerProfile
  shipTo: ShipTo
  priced: PricedOrder
}

type Copy = 'OFFICE' | 'CUSTOMER'

const num = (n: number, dp: number) => (n === 0 ? '' : n.toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: dp }))
/** Millimetres as whole numbers with no thousands separator, like the sheet ("1372"). */
const mm = (v: number) => (v > 0 ? String(Math.round(v)) : '')
const sameAddress = (a: ShipTo, c: CustomerProfile) =>
  a.address.street === c.billTo.street && a.address.city === c.billTo.city && a.address.postal === c.billTo.postal

/** The cut list laid out like the client's "SPECS" sheet. */
export default function CutList({ order, customer, shipTo, priced }: Props) {
  const [copy, setCopy] = useState<Copy>('CUSTOMER')

  // Rows with dimensions, numbered in order
  const rows = order.lines
    .map((l, i) => ({ l, p: priced.lines[i] }))
    .filter((r): r is { l: LineInput; p: PricedOrder['lines'][number] } => r.p !== undefined && r.p.sqFtEach > 0)

  const addr = addressLines(customer.name, customer.billTo)
  const contact = [customer.phone && `Tel- ${customer.phone}`, customer.fax && `Fax- ${customer.fax}`].filter(Boolean).join('   ')
  const shipDate = formatSheetDate(order.shipDate)

  return (
    <div className="panel cutsheet-wrap">
      <div className="no-print cs-toolbar">
        <label className="f" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          Sheet
          <select value={copy} onChange={(e) => setCopy(e.target.value as Copy)}>
            <option value="CUSTOMER">Customer copy</option>
            <option value="OFFICE">Office copy</option>
          </select>
        </label>
        <button className="btn" onClick={() => window.print()}>Print</button>
      </div>

      <div className="cutsheet">
        <div className="cs-top">
          <div className="cs-brand">
            <img src={logo} alt="Seleqt Thermo" />
            <div className="cs-title">SPECS - {copy} COPY</div>
          </div>
          <div className="cs-trays">
            <div className="cs-lbl">&nbsp;# of TRAYS USED</div>
            <div className="cs-fillbox" />
          </div>
          <div className="cs-jo">
            <div className="cs-jorow"><span className="cs-lbl">JO</span><span className="cs-jonum">{order.jo}</span></div>
            <div className="cs-daterow"><span className="cs-lbl small">Order Date:</span><span>{formatSheetDate(order.orderDate)}</span></div>
            <div className="cs-daterow ship">
              <span className="cs-shiplbl">Estimated Ship/Pick-up Date:</span>
              <span className="cs-shipdate">{shipDate || 'TBD'}</span>
            </div>
          </div>
        </div>

        <div className="cs-mid">
          <div className="cs-box cs-customer">
            <div className="cs-boxhead">Customer</div>
            <div className="cs-addr">
              {addr.map((l, i) => <div key={i} className={i === 0 ? 'name' : undefined}>{l}</div>)}
              {contact && <div>{contact}</div>}
              {!sameAddress(shipTo, customer) && (
                <div className="cs-shipto">Ship to ({shipTo.label}): {addressLines(shipTo.name, shipTo.address).join(', ')}</div>
              )}
            </div>
          </div>
          <div className="cs-box cs-notes">
            <div className="cs-boxhead">SPECIAL INSTRUCTIONS / NOTES</div>
            <div className="cs-notetext">{order.notes}</div>
          </div>
          <div className="cs-side">
            <table className="cs-prod">
              <thead><tr><th /><th>SHEETS</th><th>TRAY</th></tr></thead>
              <tbody>
                <tr><th>CNC &amp; PRESS</th><td /><td /></tr>
                <tr><th>TOTAL OF SHEETS &amp; PVC</th><td /><td /></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="cs-meta">
          <div className="cs-metaleft">
            <div><b>CUST PO#</b> <span className="cs-poval">{order.po}</span></div>
            <div><b>Account Mngr:</b> <span className="cs-rep">{order.rep}</span></div>
          </div>
          <div className="cs-totals">
            <div><span>Total SF:</span><b>{num(priced.totalSqFt, 2) || '0'}</b></div>
            <div><span>Total Qty pcs:</span><b>{priced.totalQty}</b></div>
          </div>
        </div>

        <table className="cs-table">
          <thead>
            <tr>
              <th className="c-no">No.</th>
              <th className="c-style">Door/Panel<br />Style</th>
              <th className="c-colour">Colour</th>
              <th>Back</th>
              <th>Thick</th>
              <th>Profile<br />Edge</th>
              <th className="c-item">Item</th>
              <th>Qty</th>
              <th>H mm</th>
              <th>W mm</th>
              <th>H/D in</th>
              <th>W in</th>
              <th className="c-qc">QC<br />SIGN-OFF<br />(initial)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ l, p }, idx) => {
              const n = idx + 1
              const station = qcStation(n)
              return (
                <tr key={idx}>
                  <td className="c-no">{n}</td>
                  <td className="c-style">{l.style.trim()}</td>
                  <td className="c-colour">{l.colour.trim()}</td>
                  <td>{l.back}</td>
                  <td className={isNonStandardThickness(l.thick) ? 'c-flag' : undefined}>{formatThickness(l.thick)}</td>
                  <td>{l.edge === l.style ? 'SAME' : l.edge.trim()}</td>
                  <td className="c-item">{l.item.trim()}</td>
                  <td>{l.qty}</td>
                  <td>{mm(p.hMm)}</td>
                  <td>{mm(p.wMm)}</td>
                  <td className="c-in">{formatInches(l.hIn)}</td>
                  <td className="c-in">{formatInches(l.wIn)}</td>
                  <td className={`c-qc ${station ? 'box' : ''}`}>{n === 1 ? '' : station ?? '-'}</td>
                </tr>
              )
            })}
            {rows.length === 0 && <tr><td colSpan={13} className="muted">No rows with dimensions yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
