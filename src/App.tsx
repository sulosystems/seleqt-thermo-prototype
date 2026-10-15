import { useMemo, useState } from 'react'
import Admin from './Admin'
import logo from './assets/seleqt-logo.png'
import CutList from './CutList'
import OrdersList from './OrdersList'
import { activeLists } from './engine/catalog'
import { priceOrder, round2 } from './engine/pricing'
import { qbTotals, toQbSalesOrder, toQbxml } from './engine/quickbooks'
import { compareToLive, makeSnapshot } from './engine/snapshot'
import { addressLines } from './engine/types'
import type { LineInput } from './engine/types'
import { addHistory, blankLine, useOrders } from './orders'
import type { Order } from './orders'
import { useAppData } from './state'

/** Keep the row's current value selectable even if the admin has since retired it. */
const withCurrent = <T extends string | number>(list: T[], cur: T) => (list.some((x) => String(x) === String(cur)) ? list : [cur, ...list])
const money = (n: number) => n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })
const signed = (n: number) => `${n >= 0 ? '+' : '-'}${money(Math.abs(n))}`
const num = (n: number, dp = 3) => (n === 0 ? '' : n.toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: dp }))
const when = (iso: string) => new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })

type Tab = 'orders' | 'entry' | 'qb' | 'cut' | 'pack' | 'invoice' | 'admin'
type Role = 'Order entry' | 'Admin'
type Pending = 'confirm' | 'reprice' | 'reopen'
const TABS: [Tab, string][] = [
  ['orders', 'Orders'],
  ['entry', 'Order Entry'],
  ['qb', 'QuickBooks Sales Order'],
  ['cut', 'Cut List'],
  ['pack', 'Packing Slip'],
  ['invoice', 'Invoice'],
]
const ADMIN_TAB: [Tab, string] = ['admin', 'Admin']
const ORDER_TABS: Tab[] = ['entry', 'qb', 'cut', 'pack', 'invoice']

export default function App() {
  const { data, publish, resetToWorkbook } = useAppData()
  const { ctx, customers: CUSTOMERS } = data
  const version = data.log[0]?.id ?? 0 // catalog version = number of admin publishes
  const { orders, current: order, update, select, create, duplicate, remove } = useOrders(CUSTOMERS[0])

  const [tab, setTab] = useState<Tab>('orders')
  const [role, setRole] = useState<Role>('Order entry')
  const [adminKey, setAdminKey] = useState(0)
  const [pendingAct, setPendingAct] = useState<{ id: string; action: Pending } | null>(null)
  const pending = pendingAct?.id === order.id ? pendingAct.action : null
  const lists = useMemo(() => activeLists(ctx.catalog), [ctx.catalog])

  // A confirmed order reads everything price-related from its snapshot, never from the live catalog.
  const snap = order.status === 'confirmed' ? order.snapshot : undefined
  const locked = snap !== undefined
  const liveCustomer = CUSTOMERS.find((c) => c.id === order.customerId) ?? CUSTOMERS[0]
  const customer = snap ? snap.customer : liveCustomer
  const params = snap ? snap.params : ctx.params
  const livePriced = useMemo(() => priceOrder(order.lines, liveCustomer, order.discountPct / 100, ctx), [order.lines, liveCustomer, order.discountPct, ctx])
  const priced = snap ? snap.priced : livePriced
  const cmp = useMemo(
    () => (snap ? compareToLive(snap, order.lines, CUSTOMERS.find((c) => c.id === order.customerId), ctx) : undefined),
    [snap, order.lines, order.customerId, CUSTOMERS, ctx],
  )

  const taxable = customer.accountType !== 'CASH'
  const shipTo = customer.shipTos.find((s) => s.id === order.shipToId) ?? customer.shipTos[0]
  const reps = withCurrent(data.reps, order.rep).filter((r) => r !== '')
  const so = useMemo(
    () =>
      toQbSalesOrder(
        {
          refNumber: order.jo, customer: customer.name, poNumber: order.po, orderDate: order.orderDate, shipDate: order.shipDate,
          terms: customer.terms, rep: order.rep, memo: order.customerMessage,
          billName: customer.name, billTo: customer.billTo, shipName: shipTo.name, shipTo: shipTo.address,
        },
        order.lines, priced, taxable,
      ),
    [order, customer, shipTo, priced, taxable],
  )
  const discountPct = snap ? snap.discountPct : order.discountPct
  const qb = qbTotals(so.subtotal * (1 - discountPct / 100), taxable, params.hstRate)
  const issueCount = priced.lines.reduce((s, l) => s + l.issues.length, 0)
  const hasPricedRows = priced.lines.some((l) => l.sqFtEach > 0)
  const canConfirm = issueCount === 0 && hasPricedRows

  const setOrder = (fn: (o: Order) => Order) => update(order.id, fn)
  const set = <K extends keyof Order>(k: K, v: Order[K]) => setOrder((o) => ({ ...o, [k]: v }))
  const setLine = (i: number, patch: Partial<LineInput>) =>
    setOrder((o) => ({ ...o, lines: o.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }))
  const pickCustomer = (id: string) => {
    const c = CUSTOMERS.find((x) => x.id === id) ?? CUSTOMERS[0]
    setOrder((o) => ({ ...o, customerId: c.id, shipToId: c.shipTos[0].id, rep: c.defaultRep }))
  }

  const doConfirm = () => {
    const s = makeSnapshot(order.lines, liveCustomer, order.discountPct, ctx, version)
    setOrder((o) => addHistory({ ...o, status: 'confirmed', snapshot: s }, `Confirmed: prices locked at ${money(s.priced.total)} (catalog v${version})`))
    setPendingAct(null)
  }
  const doReprice = () => {
    if (!snap) return
    const s = makeSnapshot(order.lines, liveCustomer, order.discountPct, ctx, version)
    setOrder((o) => addHistory({ ...o, snapshot: s }, `Repriced at current prices: ${money(snap.priced.total)} to ${money(s.priced.total)} (catalog v${version})`))
    setPendingAct(null)
  }
  const doReopen = () => {
    setOrder((o) => addHistory({ ...o, status: 'draft', snapshot: undefined }, 'Reopened as draft: prices unlocked'))
    setPendingAct(null)
  }
  const ask = (action: Pending) => setPendingAct({ id: order.id, action })
  const open = (id: string) => {
    select(id)
    setTab('entry')
  }

  const isOrderTab = ORDER_TABS.includes(tab)
  const isDocTab = tab === 'cut' || tab === 'pack' || tab === 'invoice' // printed documents: leave the entry screen out of the printout

  return (
    <div className="shell">
      <div className="topbar">
        <img className="brand" src={logo} alt="Seleqt Thermo" />
        <h1>Order Entry</h1>
        <span className="tag">Prototype - pricing engine ported from the SO-Order Entry workbook. Demo customers; nothing is sent to QuickBooks.</span>
        <label className="f role" title="Stand-in for real sign-in: only admins see the Admin tab">
          Viewing as
          <select
            value={role}
            onChange={(e) => {
              const r = e.target.value as Role
              setRole(r)
              if (r !== 'Admin' && tab === 'admin') setTab('orders')
            }}
          >
            <option>Order entry</option>
            <option>Admin</option>
          </select>
        </label>
      </div>

      <div className="tabs" role="tablist">
        {(role === 'Admin' ? [...TABS, ADMIN_TAB] : TABS).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'orders' && (
        <OrdersList
          orders={orders} customers={CUSTOMERS} ctx={ctx} currentId={order.id}
          onOpen={open}
          onNew={() => { create(CUSTOMERS[0]); setTab('entry') }}
          onDuplicate={(id) => { duplicate(id); setTab('entry') }}
          onDelete={remove}
        />
      )}

      {tab === 'admin' && role === 'Admin' && (
        <Admin
          key={adminKey}
          data={data}
          publish={publish}
          resetToWorkbook={() => { resetToWorkbook(); setAdminKey((k) => k + 1) }}
          preview={{ orders: orders.map((o) => ({ jo: o.jo, status: o.status, customerId: o.customerId, discountPct: o.discountPct, lines: o.lines })) }}
        />
      )}

      {isOrderTab && (
        <>
          <div className={`panel statusbar ${locked ? 'locked' : ''} ${isDocTab ? 'no-print' : ''}`} role="region" aria-label="Order status">
            <div className="statusrow">
              <div>
                <span className={`badge ${locked ? 'ok' : 'draft'}`}>{locked ? 'CONFIRMED' : 'DRAFT'}</span>{' '}
                <b>JO {order.jo}</b>{' '}
                {locked && snap ? (
                  <span>Prices locked {when(snap.takenAt)} (catalog v{snap.catalogVersion}) at <b>{money(snap.priced.total)}</b></span>
                ) : (
                  <span className="muted">Using live prices (catalog v{version}). They lock when you confirm the order.</span>
                )}
              </div>
              <div className="actions" style={{ margin: 0 }}>
                {!locked && (
                  <button className="btn" disabled={!canConfirm} onClick={() => ask('confirm')} title={canConfirm ? '' : 'Fix the pricing issues first'}>Confirm order & lock prices</button>
                )}
                {locked && cmp?.changed && <button className="btn ghost" onClick={() => ask('reprice')}>Reprice at current prices</button>}
                {locked && <button className="btn ghost" onClick={() => ask('reopen')}>Reopen as draft</button>}
              </div>
            </div>

            {!locked && !canConfirm && <div className="muted" style={{ marginTop: 6 }}>{issueCount > 0 ? `Fix ${issueCount} pricing issue(s) on the Order Entry tab to confirm.` : 'Add at least one row with dimensions to confirm.'}</div>}

            {pending === 'confirm' && (
              <div className="note warn">
                Confirm JO {order.jo} at <b>{money(livePriced.total)}</b>? The prices, waste and HST rate, and the customer's account type and addresses are frozen on this order.
                Rows, customer and discount can no longer be edited (you can reopen it later).
                <div className="actions"><button className="btn" onClick={doConfirm}>Yes, confirm and lock</button><button className="btn ghost" onClick={() => setPendingAct(null)}>Cancel</button></div>
              </div>
            )}
            {pending === 'reprice' && cmp && (
              <div className="note warn">
                Replace the locked price {money(cmp.lockedTotal)} with today's {money(cmp.liveTotal)} ({signed(cmp.delta)})? Only do this if the customer has agreed to the new price.
                <div className="actions"><button className="btn" onClick={doReprice}>Yes, reprice</button><button className="btn ghost" onClick={() => setPendingAct(null)}>Cancel</button></div>
              </div>
            )}
            {pending === 'reopen' && (
              <div className="note warn">
                Reopen JO {order.jo} as a draft? It will use live prices again and its locked prices are discarded.
                <div className="actions"><button className="btn" onClick={doReopen}>Yes, reopen</button><button className="btn ghost" onClick={() => setPendingAct(null)}>Cancel</button></div>
              </div>
            )}

            {locked && cmp && (cmp.changed ? (
              <div className="note info">
                Live prices have changed since this order was confirmed: priced today it would be <b>{money(cmp.liveTotal)}</b> ({signed(cmp.delta)}
                {cmp.changedRows.length > 0 && <>, rows {cmp.changedRows.map((i) => i + 1).join(', ')}</>}).
                This order keeps its locked price.
              </div>
            ) : (
              <div className="muted" style={{ marginTop: 6 }}>Live prices still match the locked prices.</div>
            ))}

            <details className="history">
              <summary>History ({order.history.length})</summary>
              <ul>
                {[...order.history].reverse().map((h, i) => <li key={i}><span className="muted">{when(h.at)}</span> {h.text}</li>)}
              </ul>
            </details>
          </div>

          <div className={`panel ${isDocTab ? 'no-print' : ''}`}>
            <div className="hdr">
              <label className="f">
                Customer
                <select value={order.customerId} disabled={locked} onChange={(e) => pickCustomer(e.target.value)}>
                  {withCurrent(CUSTOMERS.map((c) => c.id), customer.id).map((id) => (
                    <option key={id} value={id}>{CUSTOMERS.find((c) => c.id === id)?.name ?? customer.name}</option>
                  ))}
                </select>
              </label>
              <label className="f">
                Account type (from customer)
                <input readOnly value={`${customer.accountType}${customer.doorEdge ? ' + door edge' : ''}`} />
              </label>
              <label className="f">
                Terms (from customer)
                <input readOnly value={customer.terms} />
              </label>
              <label className="f">
                Rep
                <select value={order.rep} onChange={(e) => set('rep', e.target.value)}>
                  <option value="">(none)</option>
                  {reps.map((r) => <option key={r}>{r}</option>)}
                </select>
              </label>
              <label className="f">
                Job order # (S.O. No.)
                <input value={order.jo} readOnly={locked} onChange={(e) => set('jo', e.target.value)} />
              </label>
              <label className="f">
                Customer PO #
                <input value={order.po} onChange={(e) => set('po', e.target.value)} />
              </label>
              <label className="f">
                Order date
                <input type="date" value={order.orderDate} onChange={(e) => set('orderDate', e.target.value)} />
              </label>
              <label className="f">
                Ship date
                <input type="date" value={order.shipDate} onChange={(e) => set('shipDate', e.target.value)} />
              </label>
              <label className="f">
                Discount %
                <input type="number" min={0} max={100} value={discountPct} disabled={locked} onChange={(e) => set('discountPct', Number(e.target.value) || 0)} />
              </label>
            </div>
            <div className="addrrow">
              <AddressBlock title="Name / address (bill to)" lines={addressLines(customer.name, customer.billTo)} extra={[customer.phone && `Tel ${customer.phone}`, customer.fax && `Fax ${customer.fax}`]} />
              <div>
                <label className="f">
                  Ship to
                  <select value={shipTo.id} onChange={(e) => set('shipToId', e.target.value)}>
                    {customer.shipTos.map((st) => <option key={st.id} value={st.id}>{st.label}</option>)}
                  </select>
                </label>
                <AddressBlock lines={addressLines(shipTo.name, shipTo.address)} />
              </div>
              <label className="f">
                Special instructions / notes (cut list)
                <textarea rows={4} value={order.notes} onChange={(e) => set('notes', e.target.value)} />
              </label>
              <label className="f">
                Customer message (packing slip / invoice)
                <textarea rows={4} value={order.customerMessage} onChange={(e) => set('customerMessage', e.target.value)} />
              </label>
            </div>
          </div>
        </>
      )}

      {tab === 'entry' && (
        <>
          <div className="panel">
            {locked && <div className="note info" style={{ marginTop: 0, marginBottom: 10 }}>Rows are locked with the prices. Reopen the order as a draft to change them.</div>}
            <div className="scroll">
              <table className="grid">
                <thead>
                  <tr>
                    <th>#</th><th>Item</th><th>Back</th><th>Thick</th><th>Door/Panel style</th><th>Profile edge</th><th>Colour</th>
                    <th className="num">Qty</th><th className="num">H in</th><th className="num">W in</th>
                    <th className="num">H mm</th><th className="num">W mm</th><th className="num">Sq ft ea</th><th className="num">$/sf</th>
                    <th className="num">Unit $</th><th className="num">Total</th><th />
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((l, i) => {
                    const p = priced.lines[i]
                    return (
                      <tr key={i} className={p.issues.length ? 'row-issue' : undefined}>
                        <td>{i + 1}</td>
                        <td className="cell-item">
                          <select value={l.item} disabled={locked} onChange={(e) => setLine(i, { item: e.target.value })}>
                            {withCurrent(lists.item, l.item).map((x) => <option key={x}>{x}</option>)}
                          </select>
                        </td>
                        <td className="cell-small">
                          <select value={l.back} disabled={locked} onChange={(e) => setLine(i, { back: e.target.value })}>
                            {withCurrent(lists.back, l.back).map((x) => <option key={x}>{x}</option>)}
                          </select>
                        </td>
                        <td className="cell-small">
                          <select value={String(l.thick)} disabled={locked} onChange={(e) => setLine(i, { thick: e.target.value === 'NA/None' ? e.target.value : Number(e.target.value) })}>
                            {withCurrent(lists.thick, l.thick).map((x) => <option key={x}>{x}</option>)}
                          </select>
                        </td>
                        <td className="cell-style">
                          <input list="dl-style" value={l.style} disabled={locked} onChange={(e) => setLine(i, { style: e.target.value })} />
                        </td>
                        <td className="cell-style">
                          <input list="dl-edge" value={l.edge} disabled={locked} onChange={(e) => setLine(i, { edge: e.target.value })} />
                        </td>
                        <td className="cell-colour">
                          <input list="dl-colour" value={l.colour} disabled={locked} onChange={(e) => setLine(i, { colour: e.target.value })} />
                        </td>
                        <td className="cell-narrow"><input type="number" min={0} value={l.qty} disabled={locked} onChange={(e) => setLine(i, { qty: Number(e.target.value) || 0 })} /></td>
                        <td className="cell-narrow"><input type="number" min={0} step="0.125" value={l.hIn} disabled={locked} onChange={(e) => setLine(i, { hIn: Number(e.target.value) || 0 })} /></td>
                        <td className="cell-narrow"><input type="number" min={0} step="0.125" value={l.wIn} disabled={locked} onChange={(e) => setLine(i, { wIn: Number(e.target.value) || 0 })} /></td>
                        <td className="num">{num(p.hMm, 1)}</td>
                        <td className="num">{num(p.wMm, 1)}</td>
                        <td className="num">{num(p.sqFtEach)}</td>
                        <td className="num">{num(p.pricePerSqFt, 2)}</td>
                        <td className="num">{num(p.unitPrice, 2)}</td>
                        <td className="num">{p.total ? money(p.total) : ''}</td>
                        <td>
                          {!locked && <button className="btn x" title="Remove row" aria-label={`Remove row ${i + 1}`} onClick={() => set('lines', order.lines.filter((_, j) => j !== i))}>×</button>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <datalist id="dl-style">{lists.style.map((x) => <option key={x} value={x} />)}</datalist>
            <datalist id="dl-edge">{[...new Set(['SAME', ...lists.style])].map((x) => <option key={x} value={x} />)}</datalist>
            <datalist id="dl-colour">{lists.colour.map((x) => <option key={x} value={x} />)}</datalist>

            {priced.lines.map((p, i) =>
              p.issues.length ? (
                <div key={i} className="note bad">Row {i + 1}: {p.issues.join('; ')}</div>
              ) : null,
            )}
            {priced.warnings.map((w) => <div key={w} className="note warn">{w}</div>)}

            {!locked && (
              <div className="actions">
                <button className="btn" onClick={() => {
                  const last = order.lines.at(-1)
                  set('lines', [...order.lines, last ? { ...blankLine(), item: last.item, style: last.style, edge: last.edge, colour: last.colour, back: last.back, thick: last.thick } : blankLine()])
                }}>+ Add row</button>
              </div>
            )}
          </div>

          <div className="panel">
            <h2>Totals</h2>
            <div className="totals">
              <div className="stat"><div className="k">Total qty</div><div className="v">{priced.totalQty}</div></div>
              <div className="stat"><div className="k">Total sq ft</div><div className="v">{num(round2(priced.totalSqFt), 2) || '0'}</div></div>
              <div className="stat"><div className="k">Subtotal</div><div className="v">{money(priced.subtotal)}</div></div>
              <div className="stat"><div className="k">HST {round2(params.hstRate * 100)}%</div><div className="v">{money(priced.hst)}</div></div>
              <div className="stat big"><div className="k">Total</div><div className="v">{money(priced.total)}</div></div>
            </div>
            {issueCount > 0 && <div className="note bad">{issueCount} pricing issue(s) - fix before this order could be confirmed or sent to QuickBooks.</div>}
          </div>
        </>
      )}

      {tab === 'qb' && (
        <>
          <div className="panel">
            <h2>Sales Order as it would be created in QuickBooks</h2>
            <div className="note info">
              Per-piece rows are grouped by item + thickness + style + colour + rate, the way staff re-key them today.
              Quantity sent to QuickBooks is sq ft; pieces go in the description until we confirm the custom columns.
              {!locked && <> <b>This is a draft:</b> confirm the order so the prices sent to QuickBooks are the locked ones.</>}
            </div>
            <div className="scroll" style={{ marginTop: 10 }}>
              <table>
                <thead>
                  <tr><th>Item</th><th>Thick</th><th>Style</th><th>Colour</th><th className="num">Qty</th><th className="num">Sq ft</th><th className="num">$/sqft</th><th className="num">Amount</th><th>Tax</th></tr>
                </thead>
                <tbody>
                  {so.lines.map((l, i) => (
                    <tr key={i}>
                      <td>{l.item}</td><td>{l.thick}</td><td>{l.style}</td><td>{l.colour}</td>
                      <td className="num">{l.qty}</td><td className="num">{l.sqFt}</td><td className="num">{l.rate.toFixed(2)}</td>
                      <td className="num">{l.amount.toFixed(2)}</td><td>{l.tax}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="totals" style={{ marginTop: 12 }}>
              <div className="stat"><div className="k">Subtotal</div><div className="v">{money(qb.subtotal)}</div></div>
              <div className="stat"><div className="k">HST (ON) {round2(params.hstRate * 100)}%</div><div className="v">{money(qb.hst)}</div></div>
              <div className="stat big"><div className="k">Total</div><div className="v">{money(qb.total)}</div></div>
            </div>
            {Math.abs(qb.total - round2(priced.total)) > 0.005 && (
              <div className="note warn">
                Reconciliation: the per-piece total is {money(priced.total)} but the grouped QuickBooks total is {money(qb.total)}
                (rounding of grouped sq ft / amounts). This is the check the real sync will flag.
              </div>
            )}
          </div>
          <div className="panel">
            <h2>qbXML a Web Connector job would send</h2>
            <pre>{toQbxml(so)}</pre>
          </div>
        </>
      )}

      {tab === 'cut' && <CutList order={order} customer={customer} shipTo={shipTo} priced={priced} />}

      {(tab === 'pack' || tab === 'invoice') && (
        <div className="panel doc">
          <div className="dochead">
            <img src={logo} alt="Seleqt Thermo" />
            <h2>{tab === 'pack' ? 'Packing Slip - customer copy' : 'Invoice'}</h2>
          </div>
          <div className="meta">
            <span>JO: <b>{order.jo}</b></span>
            <span>PO: <b>{order.po || '-'}</b></span>
            <span>Rep: <b>{order.rep || '-'}</b></span>
            <span>Terms: <b>{customer.terms}</b></span>
            <span>Order date: <b>{order.orderDate}</b></span>
            <span>Ship date: <b>{order.shipDate || '-'}</b></span>
            {tab === 'invoice' && <span>Prices: <b>{snap ? `locked ${snap.takenAt.slice(0, 10)} (v${snap.catalogVersion})` : 'DRAFT - not yet locked'}</b></span>}
          </div>
          <div className="addrrow docaddr">
            <AddressBlock title="Bill to" lines={addressLines(customer.name, customer.billTo)} extra={[customer.phone && `Tel ${customer.phone}`, customer.fax && `Fax ${customer.fax}`]} />
            <AddressBlock title={`Ship to - ${shipTo.label}`} lines={addressLines(shipTo.name, shipTo.address)} />
          </div>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>No.</th>
                  {tab === 'pack' && <><th className="num">Qty req</th><th className="num">Qty ship</th></>}
                  <th>Item</th><th>Back</th><th>Thick</th><th>Style</th><th>Edge</th><th>Colour</th>
                  {tab !== 'pack' && <th className="num">Qty</th>}
                  {tab !== 'invoice' && <><th className="num">H mm</th><th className="num">W mm</th></>}
                  <th className="num">{tab === 'pack' ? 'Tot. sq ft' : 'Sq ft'}</th>
                  {tab === 'invoice' && <><th className="num">$/sf</th><th className="num">Unit $</th><th className="num">Total</th></>}
                  {tab === 'pack' && <th>QC</th>}
                </tr>
              </thead>
              <tbody>
                {order.lines.map((l, i) => {
                  const p = priced.lines[i]
                  if (p.sqFtEach === 0) return null
                  return (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      {tab === 'pack' && <><td className="num">{l.qty}</td><td className="num">{l.qty}</td></>}
                      <td>{l.item}</td><td>{l.back}</td><td>{l.thick}</td><td>{l.style}</td><td>{l.edge}</td><td>{l.colour}</td>
                      {tab !== 'pack' && <td className="num">{l.qty}</td>}
                      {tab !== 'invoice' && <><td className="num">{num(p.hMm, 1)}</td><td className="num">{num(p.wMm, 1)}</td></>}
                      <td className="num">{num(tab === 'invoice' ? p.sqFtEach : p.totalSqFt)}</td>
                      {tab === 'invoice' && <><td className="num">{p.pricePerSqFt.toFixed(2)}</td><td className="num">{p.unitPrice.toFixed(2)}</td><td className="num">{money(p.total)}</td></>}
                      {tab === 'pack' && <td>☐</td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {tab === 'invoice' && (
            <div className="totals" style={{ marginTop: 12 }}>
              <div className="stat"><div className="k">Sub total</div><div className="v">{money(priced.subtotal)}</div></div>
              {discountPct > 0 && <div className="stat"><div className="k">Discount {discountPct}%</div><div className="v">{money(priced.subtotal - priced.taxableSubtotal)}</div></div>}
              <div className="stat"><div className="k">HST</div><div className="v">{money(priced.hst)}</div></div>
              <div className="stat big"><div className="k">Total</div><div className="v">{money(priced.total)}</div></div>
            </div>
          )}
          {order.customerMessage.trim() !== '' && <p className="custmsg"><b>Message:</b> {order.customerMessage}</p>}
          <div className="actions"><button className="btn" onClick={() => window.print()}>Print</button></div>
        </div>
      )}
    </div>
  )
}

function AddressBlock({ title, lines, extra = [] }: { title?: string; lines: string[]; extra?: (string | false | undefined)[] }) {
  return (
    <div className="addr">
      {title && <div className="k">{title}</div>}
      {lines.map((l, i) => <div key={i}>{l}</div>)}
      {lines.length <= 1 && <div className="muted">No address on file</div>}
      {extra.filter(Boolean).map((l) => <div key={String(l)} className="muted">{l}</div>)}
    </div>
  )
}
