import type { PricingContext } from './engine/catalog'
import { priceOrder } from './engine/pricing'
import type { CustomerProfile } from './engine/types'
import type { Order } from './orders'

const money = (n: number) => n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })

interface Props {
  orders: Order[]
  customers: CustomerProfile[]
  ctx: PricingContext
  currentId: string
  onOpen: (id: string) => void
  onNew: () => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
}

export default function OrdersList({ orders, customers, ctx, currentId, onOpen, onNew, onDuplicate, onDelete }: Props) {
  const rows = [...orders].reverse().map((o) => {
    const customer = customers.find((c) => c.id === o.customerId) ?? customers[0]
    const total = o.snapshot ? o.snapshot.priced.total : priceOrder(o.lines, customer, o.discountPct / 100, ctx).total
    return { o, name: o.snapshot ? o.snapshot.customer.name : customer.name, total }
  })
  return (
    <div className="panel">
      <div className="note info" style={{ marginTop: 0 }}>
        A <b>draft</b> order uses today's live prices. When you <b>confirm</b> it, the prices it was calculated with are locked in,
        so later price, parameter or customer changes in Admin never change an order that was already issued.
      </div>
      <div className="scroll" style={{ marginTop: 10 }}>
        <table>
          <thead>
            <tr><th>JO</th><th>Customer</th><th>PO</th><th>Order date</th><th>Status</th><th className="num">Total (incl. HST)</th><th /></tr>
          </thead>
          <tbody>
            {rows.map(({ o, name, total }) => (
              <tr key={o.id} className={o.id === currentId ? 'current' : undefined}>
                <td><b>{o.jo}</b></td>
                <td>{name}</td>
                <td>{o.po || <span className="muted">-</span>}</td>
                <td>{o.orderDate}</td>
                <td>
                  {o.status === 'confirmed' ? (
                    <span className="badge ok" title={`Locked ${o.snapshot ? new Date(o.snapshot.takenAt).toLocaleString('en-CA') : ''}`}>Confirmed - prices locked</span>
                  ) : (
                    <span className="badge draft">Draft - live prices</span>
                  )}
                </td>
                <td className="num">{money(total)}</td>
                <td>
                  <div className="actions" style={{ margin: 0, justifyContent: 'flex-end' }}>
                    <button className="btn small" onClick={() => onOpen(o.id)}>Open</button>
                    <button className="btn ghost small" onClick={() => onDuplicate(o.id)} title="Copy into a new draft at today's prices">Duplicate</button>
                    <button
                      className="btn ghost small"
                      disabled={o.status === 'confirmed' || orders.length <= 1}
                      title={o.status === 'confirmed' ? 'Confirmed orders are a record and cannot be deleted' : 'Delete this draft'}
                      onClick={() => onDelete(o.id)}
                    >Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="actions"><button className="btn" onClick={onNew}>+ New order</button></div>
    </div>
  )
}
