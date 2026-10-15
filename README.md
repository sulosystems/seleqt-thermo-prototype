# Seleqt Thermo order-entry prototype

Prototype of the replacement for `SELEQT SO_ORDER ENTRY TEMPLATE.xlsm`.

- `src/engine/pricing.ts` - port of the SO-Order Entry formulas (sq ft, waste, door edge, $/sf lookup, HST)
- `src/engine/quickbooks.ts` - groups per-piece rows into QuickBooks Sales Order lines + qbXML preview
- `src/engine/catalog.ts`, `catalogEdit.ts` - editable price catalog + parameters; pure edit / validate / diff helpers
- `src/Admin.tsx`, `src/state.ts` - admin screen (draft -> review & impact preview -> publish -> change log); stored in localStorage for now
- `src/engine/snapshot.ts`, `src/orders.ts`, `src/OrdersList.tsx` - saved orders (draft / confirmed); confirming stores a price snapshot that the order, its documents and the QuickBooks payload read from
- `src/engine/engine.test.ts` - tests incl. JO 30789 from the workbook and the QuickBooks screenshot (JO 30673)
- `scripts/extract_pricing.py` - re-extracts the 'Pricing Data' tab: `python scripts/extract_pricing.py "<workbook.xlsm>"`

Run: `npm install`, `npm run dev`, `npx vitest run`.

Demo customers only; nothing is sent to QuickBooks. Open questions are marked ASSUMPTION / "to be confirmed" in the code.

## Confidentiality

`src/data/pricing.json` is extracted from the client's price workbook, and the sample customer and logo are the client's. Keep this repository private.
