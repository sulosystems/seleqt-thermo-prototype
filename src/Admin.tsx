import { useMemo, useState } from 'react'
import { activeLists } from './engine/catalog'
import type { Catalog, PricingContext, Section } from './engine/catalog'
import { SECTION_LABEL, addEntry, diffContext, getEdgeAdd, getPrice, nameTaken, setEdgeAdd, setPrice, toggleRetired, validate } from './engine/catalogEdit'
import type { Change } from './engine/catalogEdit'
import { priceOrder } from './engine/pricing'
import { emptyAddress } from './engine/types'
import type { AccountType, Address, CustomerProfile, LineInput, ShipTo } from './engine/types'
import { normalizeCustomer } from './state'
import type { AppData } from './state'

const money = (n: number) => n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })
const ACCOUNT_TYPES: AccountType[] = ['HST ONLY', 'HST WITH WASTE', 'CASH']
const PRICE_SECTIONS: Section[] = ['style', 'item', 'back', 'thick']

type AdminTab = 'prices' | 'lists' | 'params' | 'customers' | 'log'

interface Props {
  data: AppData
  publish: (ctx: PricingContext, customers: CustomerProfile[], reps: string[], note: string, changes: Change[]) => void
  resetToWorkbook: () => void
  /** All saved orders: drafts show their price change in the review, confirmed orders are locked and unaffected. */
  preview: { orders: { jo: string; status: 'draft' | 'confirmed'; customerId: string; discountPct: number; lines: LineInput[] }[] }
}

const addrStr = (a: Address) => [a.street, a.city, a.province, a.postal].filter(Boolean).join(', ') || '(empty)'

function customerChanges(before: CustomerProfile[], after: CustomerProfile[]): Change[] {
  const out: Change[] = []
  const old = new Map(before.map((c) => [c.id, c]))
  for (const c of after) {
    const o = old.get(c.id)
    if (!o) {
      out.push({ kind: 'customer', label: `Added customer: ${c.name || '(unnamed)'}`, after: `${c.accountType}${c.doorEdge ? ' + door edge' : ''}` })
      continue
    }
    const text: [string, string, string][] = [
      ['name', o.name, c.name], ['account type', o.accountType, c.accountType], ['terms', o.terms, c.terms],
      ['default rep', o.defaultRep, c.defaultRep], ['phone', o.phone, c.phone], ['fax', o.fax, c.fax],
      ['door edge', o.doorEdge ? 'yes' : 'no', c.doorEdge ? 'yes' : 'no'], ['bill-to address', addrStr(o.billTo), addrStr(c.billTo)],
    ]
    for (const [label, x, y] of text) if (x !== y) out.push({ kind: 'customer', label: `${o.name || c.name}: ${label}`, before: x || '-', after: y || '-' })
    const oldShip = new Map(o.shipTos.map((st) => [st.id, st]))
    for (const st of c.shipTos) {
      const os = oldShip.get(st.id)
      if (!os) out.push({ kind: 'customer', label: `${c.name}: added ship-to ${st.label}`, after: addrStr(st.address) })
      else if (os.label !== st.label || os.name !== st.name || addrStr(os.address) !== addrStr(st.address))
        out.push({ kind: 'customer', label: `${c.name}: ship-to ${os.label}`, before: `${os.name} - ${addrStr(os.address)}`, after: `${st.name} - ${addrStr(st.address)}` })
    }
    for (const os of o.shipTos) if (!c.shipTos.some((st) => st.id === os.id)) out.push({ kind: 'customer', label: `${c.name}: removed ship-to ${os.label}` })
  }
  for (const o of before) if (!after.some((c) => c.id === o.id)) out.push({ kind: 'customer', label: `Removed customer: ${o.name}` })
  return out
}

function repChanges(before: string[], after: string[]): Change[] {
  return [
    ...after.filter((r) => !before.includes(r)).map((r): Change => ({ kind: 'customer', label: `Added rep: ${r}` })),
    ...before.filter((r) => !after.includes(r)).map((r): Change => ({ kind: 'customer', label: `Removed rep: ${r}` })),
  ]
}

export default function Admin({ data, publish, resetToWorkbook, preview }: Props) {
  const [draft, setDraft] = useState<PricingContext>(() => structuredClone(data.ctx))
  const [draftCustomers, setDraftCustomers] = useState<CustomerProfile[]>(() => structuredClone(data.customers))
  const [draftReps, setDraftReps] = useState<string[]>(() => [...data.reps])
  const [tab, setTab] = useState<AdminTab>('prices')
  const [reviewing, setReviewing] = useState(false)
  const [note, setNote] = useState('')

  const changes = useMemo(
    () => [...diffContext(data.ctx, draft), ...customerChanges(data.customers, draftCustomers), ...repChanges(data.reps, draftReps)],
    [data, draft, draftCustomers, draftReps],
  )
  const validation = useMemo(() => validate(draft), [draft])

  const setCatalog = (catalog: Catalog) => setDraft((d) => ({ ...d, catalog }))
  const discard = () => {
    setDraft(structuredClone(data.ctx))
    setDraftCustomers(structuredClone(data.customers))
    setDraftReps([...data.reps])
    setReviewing(false)
    setNote('')
  }
  const doPublish = () => {
    publish(draft, draftCustomers, draftReps, note.trim(), changes)
    setReviewing(false)
    setNote('')
  }

  const impact = useMemo(() => {
    const drafts = preview.orders.filter((o) => o.status === 'draft')
    const rows = drafts.map((o) => {
      const before = data.customers.find((c) => c.id === o.customerId) ?? data.customers[0]
      const after = draftCustomers.find((c) => c.id === o.customerId) ?? before
      const disc = o.discountPct / 100
      return { jo: o.jo, customer: before.name, before: priceOrder(o.lines, before, disc, data.ctx).total, after: priceOrder(o.lines, after, disc, draft).total }
    })
    return { rows, changed: rows.filter((r) => Math.abs(r.before - r.after) > 0.004), locked: preview.orders.length - drafts.length }
  }, [preview, data, draft, draftCustomers])

  const dirty = changes.length > 0
  const canPublish = validation.errors.length === 0 && note.trim() !== ''

  return (
    <>
      <div className={`panel draftbar ${dirty ? 'dirty' : ''}`}>
        <div>
          {dirty ? <b>{changes.length} unpublished change{changes.length === 1 ? '' : 's'}</b> : <span>No unpublished changes.</span>}{' '}
          <span className="muted">Edits stay in a draft until published. Order entry keeps using the live prices.</span>
        </div>
        <div className="actions" style={{ marginTop: 0 }}>
          <button className="btn ghost" disabled={!dirty} onClick={discard}>Discard draft</button>
          <button className="btn" disabled={!dirty} onClick={() => setReviewing((r) => !r)}>{reviewing ? 'Hide review' : 'Review & publish'}</button>
        </div>
      </div>

      {reviewing && dirty && (
        <div className="panel">
          <h2>Review changes</h2>
          <div className="scroll" style={{ maxHeight: 260 }}>
            <table>
              <thead><tr><th>Change</th><th>Before</th><th>After</th></tr></thead>
              <tbody>
                {changes.map((c, i) => (
                  <tr key={i}><td>{c.label}</td><td>{c.before ?? ''}</td><td>{c.after ?? ''}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2 style={{ marginTop: 14 }}>Impact on saved orders</h2>
          {impact.changed.length === 0 ? (
            <div className="note info">{impact.rows.length === 0 ? 'There are no draft orders for these changes to affect.' : `These changes do not change the price of ${impact.rows.length === 1 ? 'the 1 draft order' : `any of the ${impact.rows.length} draft orders`}.`}</div>
          ) : (
            <>
              <div className="scroll">
                <table>
                  <thead><tr><th>Draft JO</th><th>Customer</th><th className="num">Before</th><th className="num">After</th><th className="num">Change</th></tr></thead>
                  <tbody>
                    {impact.changed.map((r) => (
                      <tr key={r.jo}>
                        <td>{r.jo}</td><td>{r.customer}</td><td className="num">{money(r.before)}</td><td className="num">{money(r.after)}</td>
                        <td className="num">{r.after >= r.before ? '+' : '-'}{money(Math.abs(r.after - r.before))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="note warn">{impact.changed.length} of {impact.rows.length} draft order{impact.rows.length === 1 ? '' : 's'} would be priced differently from now on.</div>
            </>
          )}
          <div className="note info">
            {impact.locked === 0 ? 'No confirmed orders yet.' : impact.locked === 1 ? '1 confirmed order keeps its locked prices and is not affected.' : `${impact.locked} confirmed orders keep their locked prices and are not affected.`}
          </div>
          {validation.errors.map((e) => <div key={e} className="note bad">{e}</div>)}
          {validation.warnings.map((w) => <div key={w} className="note warn"><b>Existing issue, does not block publishing:</b> {w}</div>)}
          <label className="f" style={{ marginTop: 12, maxWidth: 520 }}>
            Step 1: type a reason for the change (required, saved in the change log)
            <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && canPublish) doPublish() }} placeholder="e.g. Supplier price increase Nov 2026" />
          </label>
          <div className="actions" style={{ alignItems: 'center' }}>
            <button className="btn" disabled={!canPublish} onClick={doPublish}>Step 2: Publish {changes.length} change{changes.length === 1 ? '' : 's'}</button>
            {!canPublish && (
              <span className="muted">
                {validation.errors.length > 0 ? 'Fix the errors above to publish.' : 'Publish is turned on once you enter a reason.'}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="tabs" role="tablist" aria-label="Admin sections">
        {(
          [['prices', 'Prices'], ['lists', 'Styles, colours & items'], ['params', 'Parameters'], ['customers', 'Customers'], ['log', `Change log (${data.log.length})`]] as [AdminTab, string][]
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'prices' && <PricesTab draft={draft} published={data.ctx.catalog} setCatalog={setCatalog} />}
      {tab === 'lists' && <ListsTab draft={draft} setCatalog={setCatalog} />}
      {tab === 'params' && <ParamsTab draft={draft} published={data.ctx} setDraft={setDraft} />}
      {tab === 'customers' && <CustomersTab customers={draftCustomers} setCustomers={setDraftCustomers} reps={draftReps} setReps={setDraftReps} />}
      {tab === 'log' && <LogTab data={data} resetToWorkbook={resetToWorkbook} />}
    </>
  )
}

/* ---------------------------------- Prices ---------------------------------- */

function PricesTab({ draft, published, setCatalog }: { draft: PricingContext; published: Catalog; setCatalog: (c: Catalog) => void }) {
  const cat = draft.catalog
  const [section, setSection] = useState<Section>('style')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | number | undefined>(undefined)
  const [colourFilter, setColourFilter] = useState('')
  const [pricedOnly, setPricedOnly] = useState(true)

  const keys = cat.lists[section].filter((k) => String(k).toLowerCase().includes(search.toLowerCase()))
  const key = selected !== undefined && cat.lists[section].some((k) => k === selected) ? selected : undefined
  const colours = cat.lists.colour.filter((c) => cat.colourCols[c] !== undefined)
  const pricedCount = (k: string | number) => colours.filter((c) => getPrice(cat, k, c) !== undefined).length

  const shown = key === undefined ? [] : colours
    .filter((c) => c.toLowerCase().includes(colourFilter.toLowerCase()))
    .filter((c) => !pricedOnly || getPrice(cat, key, c) !== undefined || getPrice(published, key, c) !== undefined)

  return (
    <div className="panel">
      <p className="muted" style={{ marginTop: 0 }}>
        Price per sq ft is looked up by style and colour, then item, back and thickness add-ons are summed. Leave a price empty if it is not offered.
      </p>
      <div className="adm-grid">
        <div>
          <div className="tabs" style={{ margin: '0 0 8px' }}>
            {PRICE_SECTIONS.map((s) => (
              <button key={s} aria-selected={section === s} onClick={() => { setSection(s); setSelected(undefined) }}>{SECTION_LABEL[s]}</button>
            ))}
          </div>
          <input type="search" placeholder={`Search ${SECTION_LABEL[section].toLowerCase()}`} aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: '100%', marginBottom: 6 }} />
          <ul className="picklist">
            {keys.map((k) => (
              <li key={String(k)}>
                <button aria-pressed={key === k} className={cat.retired.includes(String(k)) ? 'retired' : ''} onClick={() => setSelected(k)}>
                  <span>{String(k).trim()}</span>
                  <span className="muted">{pricedCount(k)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          {key === undefined ? (
            <div className="note info">Choose a {SECTION_LABEL[section].toLowerCase().replace(/s$/, '')} on the left to edit its prices.</div>
          ) : (
            <>
              <h2>{String(key).trim()}</h2>
              {section === 'style' && (
                <label className="f" style={{ maxWidth: 220, marginBottom: 10 }}>
                  Profile edge add ($/sq ft)
                  <input
                    type="number" min={0} step="0.01" inputMode="decimal"
                    className={getEdgeAdd(cat, key) !== getEdgeAdd(published, key) ? 'changed' : undefined}
                    value={getEdgeAdd(cat, key) ?? ''}
                    onChange={(e) => setCatalog(setEdgeAdd(cat, key, e.target.value === '' ? undefined : Number(e.target.value)))}
                  />
                </label>
              )}
              <div className="actions" style={{ margin: '0 0 8px', alignItems: 'center' }}>
                <input type="search" placeholder="Filter colours" aria-label="Filter colours" value={colourFilter} onChange={(e) => setColourFilter(e.target.value)} />
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={pricedOnly} onChange={(e) => setPricedOnly(e.target.checked)} /> Priced colours only
                </label>
                <span className="muted">{shown.length} of {colours.length} colours</span>
              </div>
              <div className="scroll" style={{ maxHeight: 460 }}>
                <table>
                  <thead><tr><th>Colour</th><th className="num">Column</th><th className="num">Price / sq ft</th><th className="num">Published</th></tr></thead>
                  <tbody>
                    {shown.map((c) => {
                      const now = getPrice(cat, key, c)
                      const was = getPrice(published, key, c)
                      return (
                        <tr key={c}>
                          <td>{c.trim()}{cat.retired.includes(c) ? <span className="muted"> (retired)</span> : ''}</td>
                          <td className="num muted">{cat.colourCols[c]}</td>
                          <td className="num">
                            <input
                              type="number" min={0} step="0.01" inputMode="decimal" aria-label={`Price for ${String(key).trim()} in ${c}`}
                              className={now !== was ? 'changed' : undefined}
                              value={now ?? ''}
                              onChange={(e) => setCatalog(setPrice(cat, key, c, e.target.value === '' ? undefined : Number(e.target.value)))}
                              style={{ width: 96, textAlign: 'right' }}
                            />
                          </td>
                          <td className="num muted">{was === undefined ? '-' : was.toFixed(2)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------ Styles / colours ------------------------------ */

function ListsTab({ draft, setCatalog }: { draft: PricingContext; setCatalog: (c: Catalog) => void }) {
  const cat = draft.catalog
  return (
    <div className="lists3">
      <ListBlock section="style" cat={cat} setCatalog={setCatalog} />
      <ListBlock section="colour" cat={cat} setCatalog={setCatalog} />
      <ListBlock section="item" cat={cat} setCatalog={setCatalog} />
    </div>
  )
}

function ListBlock({ section, cat, setCatalog }: { section: 'style' | 'colour' | 'item'; cat: Catalog; setCatalog: (c: Catalog) => void }) {
  const [name, setName] = useState('')
  const [copyFrom, setCopyFrom] = useState('')
  const [edgeAdd, setEdgeAddValue] = useState('')
  const [filter, setFilter] = useState('')
  const taken = name.trim() !== '' && nameTaken(cat, section, name)
  const active = activeLists(cat)[section]
  const singular = SECTION_LABEL[section].replace(/s$/, '').toLowerCase()

  const add = () => {
    setCatalog(addEntry(cat, section, name, { copyPricesFrom: copyFrom || undefined, edgeAdd: edgeAdd === '' ? undefined : Number(edgeAdd) }))
    setName(''); setCopyFrom(''); setEdgeAddValue('')
  }

  return (
    <div className="panel">
      <h2>{SECTION_LABEL[section]} <span className="muted">({active.length} active)</span></h2>
      <div className="addform">
        <input placeholder={`New ${singular} name`} aria-label={`New ${singular} name`} value={name} onChange={(e) => setName(e.target.value)} />
        {section === 'colour' && (
          <select aria-label="Copy prices from" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            <option value="">No prices yet</option>
            {active.map((c) => <option key={c} value={c}>Copy prices from {c.trim()}</option>)}
          </select>
        )}
        {section === 'style' && <input type="number" min={0} step="0.01" placeholder="Edge add $" aria-label="Edge add" value={edgeAdd} onChange={(e) => setEdgeAddValue(e.target.value)} style={{ width: 100 }} />}
        <button className="btn" disabled={name.trim() === '' || taken} onClick={add}>Add</button>
      </div>
      {taken && <div className="note bad">That {singular} already exists.</div>}
      <input type="search" placeholder="Filter" aria-label={`Filter ${section}`} value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: '100%', margin: '8px 0' }} />
      <ul className="picklist tall">
        {cat.lists[section].filter((n) => n.toLowerCase().includes(filter.toLowerCase())).map((n) => {
          const off = cat.retired.includes(n)
          return (
            <li key={n} className="rowflex">
              <span className={off ? 'retired' : ''}>{n.trim()}{section === 'colour' && cat.colourCols[n] === undefined ? <span className="issues"> - no price column</span> : ''}</span>
              <button className="btn ghost small" onClick={() => setCatalog(toggleRetired(cat, n))}>{off ? 'Restore' : 'Retire'}</button>
            </li>
          )
        })}
      </ul>
      <p className="muted" style={{ marginBottom: 0 }}>Retired entries disappear from order-entry dropdowns, but old orders still price correctly.</p>
    </div>
  )
}

/* -------------------------------- Parameters -------------------------------- */

function ParamsTab({ draft, published, setDraft }: { draft: PricingContext; published: PricingContext; setDraft: (f: (d: PricingContext) => PricingContext) => void }) {
  const wastePct = Math.round((draft.params.wasteFactor - 1) * 100 * 10000) / 10000
  const hstPct = Math.round(draft.params.hstRate * 100 * 10000) / 10000
  return (
    <div className="panel">
      <div className="hdr" style={{ maxWidth: 640 }}>
        <label className="f">
          Waste allowance (%)
          <input type="number" min={0} max={100} step="0.05" inputMode="decimal"
            className={draft.params.wasteFactor !== published.params.wasteFactor ? 'changed' : undefined}
            value={wastePct} onChange={(e) => setDraft((d) => ({ ...d, params: { ...d.params, wasteFactor: 1 + (Number(e.target.value) || 0) / 100 } }))} />
          <span className="muted">Added to billable area for CASH and HST WITH WASTE customers. Also the minimum billable area per piece. Live: {((published.params.wasteFactor - 1) * 100).toFixed(2)}%</span>
        </label>
        <label className="f">
          HST rate (%)
          <input type="number" min={0} max={50} step="0.01" inputMode="decimal"
            className={draft.params.hstRate !== published.params.hstRate ? 'changed' : undefined}
            value={hstPct} onChange={(e) => setDraft((d) => ({ ...d, params: { ...d.params, hstRate: (Number(e.target.value) || 0) / 100 } }))} />
          <span className="muted">Charged on every account type except CASH. Live: {(published.params.hstRate * 100).toFixed(2)}%</span>
        </label>
      </div>
      <div className="note info" style={{ marginTop: 14 }}>
        These values used to be typed inside Excel formulas. The calculation steps themselves (area x waste, minimum per piece, door edge, price lookup) are not editable here: they live in tested code, so one wrong edit cannot silently misprice every order.
      </div>
    </div>
  )
}

/* -------------------------------- Customers -------------------------------- */

function CustomersTab({
  customers, setCustomers, reps, setReps,
}: {
  customers: CustomerProfile[]
  setCustomers: (c: CustomerProfile[]) => void
  reps: string[]
  setReps: (r: string[]) => void
}) {
  const [newRep, setNewRep] = useState('')
  const update = (id: string, patch: Partial<CustomerProfile>) => setCustomers(customers.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  const add = () => {
    const n = Math.max(0, ...customers.map((c) => Number(c.id.replace(/\D/g, '')) || 0)) + 1
    setCustomers([...customers, normalizeCustomer({ id: `C${n}`, name: '', accountType: 'HST ONLY', doorEdge: false })])
  }
  const repTaken = newRep.trim() === '' || reps.some((r) => r.toLowerCase() === newRep.trim().toLowerCase())

  return (
    <>
      <div className="panel">
        <h2>Sales reps</h2>
        <p className="muted" style={{ marginTop: 0 }}>The Rep dropdown on the order. In QuickBooks, reps are set up from the Employee / Vendor / Other Name lists, so these should match their names there.</p>
        <div className="addform" style={{ maxWidth: 420 }}>
          <input placeholder="Rep name or initials" aria-label="New rep" value={newRep} onChange={(e) => setNewRep(e.target.value)} />
          <button className="btn" disabled={repTaken} onClick={() => { setReps([...reps, newRep.trim()]); setNewRep('') }}>Add rep</button>
        </div>
        <div className="chips">
          {reps.length === 0 && <span className="muted">No reps yet (the sample sales order has none selected).</span>}
          {reps.map((r) => (
            <span key={r} className="chip">{r}<button className="btn x" aria-label={`Remove rep ${r}`} onClick={() => { setReps(reps.filter((x) => x !== r)); setCustomers(customers.map((c) => (c.defaultRep === r ? { ...c, defaultRep: '' } : c))) }}>×</button></span>
          ))}
        </div>
      </div>

      <div className="panel">
        <p className="muted" style={{ marginTop: 0 }}>Demo list. In the real system customers sync from QuickBooks (name, addresses, terms), and the account type and door-edge flag are managed here.</p>
        {customers.map((c) => (
          <details key={c.id} className="custcard" open={c.name === ''}>
            <summary>
              <b>{c.name || '(new customer)'}</b> <span className="muted">{c.accountType}{c.doorEdge ? ' + door edge' : ''} - {c.billTo.city || 'no address'}</span>
            </summary>
            <div className="hdr" style={{ marginTop: 10 }}>
              <label className="f">Name<input value={c.name} onChange={(e) => update(c.id, { name: e.target.value })} aria-label="Customer name" /></label>
              <label className="f">Account type
                <select value={c.accountType} onChange={(e) => update(c.id, { accountType: e.target.value as AccountType })} aria-label="Account type">
                  {ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </label>
              <label className="f">Terms<input value={c.terms} onChange={(e) => update(c.id, { terms: e.target.value })} aria-label="Terms" /></label>
              <label className="f">Default rep
                <select value={c.defaultRep} onChange={(e) => update(c.id, { defaultRep: e.target.value })} aria-label="Default rep">
                  <option value="">(none)</option>
                  {reps.map((r) => <option key={r}>{r}</option>)}
                </select>
              </label>
              <label className="f">Phone<input value={c.phone} onChange={(e) => update(c.id, { phone: e.target.value })} aria-label="Phone" /></label>
              <label className="f">Fax<input value={c.fax} onChange={(e) => update(c.id, { fax: e.target.value })} aria-label="Fax" /></label>
              <label className="f" style={{ justifyContent: 'flex-end' }}>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--text)', fontSize: 14 }}>
                  <input type="checkbox" checked={c.doorEdge} onChange={(e) => update(c.id, { doorEdge: e.target.checked })} /> Door edge charge (add edge sq ft)
                </span>
              </label>
            </div>
            <h3>Bill-to address</h3>
            <AddressFields address={c.billTo} label="Bill-to" onChange={(a) => update(c.id, { billTo: a })} />
            <h3>Ship-to addresses</h3>
            {c.shipTos.map((st) => (
              <div key={st.id} className="shipcard">
                <div className="hdr">
                  <label className="f">Label<input value={st.label} aria-label="Ship-to label" onChange={(e) => update(c.id, { shipTos: c.shipTos.map((x) => (x.id === st.id ? { ...x, label: e.target.value } : x)) })} /></label>
                  <label className="f">Name on address<input value={st.name} aria-label="Ship-to name" onChange={(e) => update(c.id, { shipTos: c.shipTos.map((x) => (x.id === st.id ? { ...x, name: e.target.value } : x)) })} /></label>
                </div>
                <AddressFields address={st.address} label={st.label} onChange={(a) => update(c.id, { shipTos: c.shipTos.map((x) => (x.id === st.id ? { ...x, address: a } : x)) })} />
                <button className="btn ghost small" disabled={c.shipTos.length <= 1} onClick={() => update(c.id, { shipTos: c.shipTos.filter((x) => x.id !== st.id) })}>Remove this ship-to</button>
              </div>
            ))}
            <div className="actions">
              <button
                className="btn ghost"
                onClick={() => {
                  const n = Math.max(0, ...c.shipTos.map((x) => Number(x.id.replace(/\D/g, '')) || 0)) + 1
                  const st: ShipTo = { id: `S${n}`, label: `Ship To ${n}`, name: c.name, address: { ...emptyAddress() } }
                  update(c.id, { shipTos: [...c.shipTos, st] })
                }}
              >+ Add ship-to</button>
              <button className="btn ghost" disabled={customers.length <= 1} onClick={() => setCustomers(customers.filter((x) => x.id !== c.id))}>Remove customer</button>
            </div>
          </details>
        ))}
        <div className="actions"><button className="btn ghost" onClick={add}>+ Add customer</button></div>
      </div>
    </>
  )
}

function AddressFields({ address, label, onChange }: { address: Address; label: string; onChange: (a: Address) => void }) {
  const f = (k: keyof Address, text: string, aria: string) => (
    <label className="f">{text}<input aria-label={`${label} ${aria}`} value={address[k]} onChange={(e) => onChange({ ...address, [k]: e.target.value })} /></label>
  )
  return (
    <div className="hdr addrfields">
      {f('street', 'Street', 'street')}
      {f('city', 'City', 'city')}
      {f('province', 'Province', 'province')}
      {f('postal', 'Postal code', 'postal code')}
    </div>
  )
}

/* --------------------------------- Change log --------------------------------- */

function LogTab({ data, resetToWorkbook }: { data: AppData; resetToWorkbook: () => void }) {
  const [confirm, setConfirm] = useState(false)
  return (
    <div className="panel">
      {data.log.length === 0 && <div className="note info">Nothing published yet. Every published change is recorded here with who, when and why.</div>}
      {data.log.map((e) => (
        <details key={e.id} className="logentry">
          <summary>
            <b>#{e.id}</b> {new Date(e.at).toLocaleString('en-CA')} - {e.by} - {e.note || '(no reason given)'} <span className="muted">({e.changes.length} changes)</span>
          </summary>
          <table>
            <tbody>
              {e.changes.map((c, i) => (
                <tr key={i}><td>{c.label}</td><td className="muted">{c.before ?? ''}</td><td>{c.after ?? ''}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
      <div className="actions" style={{ marginTop: 16 }}>
        {!confirm ? (
          <button className="btn ghost" onClick={() => setConfirm(true)}>Reset everything to the workbook's catalog</button>
        ) : (
          <>
            <span className="note bad" style={{ margin: 0 }}>This discards all published edits and the change log.</span>
            <button className="btn" onClick={() => { resetToWorkbook(); setConfirm(false) }}>Yes, reset</button>
            <button className="btn ghost" onClick={() => setConfirm(false)}>Cancel</button>
          </>
        )}
      </div>
    </div>
  )
}

