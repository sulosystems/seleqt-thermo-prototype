/** Formatting used on the printed cut list, which follows the client's sheet. */

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

/**
 * Inches as a mixed fraction to the nearest 1/16, the way the shop writes them:
 * 17.875 -> "17 7/8", 22.44 -> "22 7/16", 54 -> "54", 0.75 -> "3/4". Zero or invalid -> "".
 */
export function formatInches(value: number, denominator = 16): string {
  if (!Number.isFinite(value) || value <= 0) return ''
  const sixteenths = Math.round(value * denominator)
  const whole = Math.floor(sixteenths / denominator)
  const rem = sixteenths % denominator
  if (rem === 0) return String(whole)
  const g = gcd(rem, denominator)
  const frac = `${rem / g}/${denominator / g}`
  return whole === 0 ? frac : `${whole} ${frac}`
}

/** Thickness column: 0.75 -> "3/4", 0.625 -> "5/8"; non-numeric values (e.g. "NA/None") pass through. */
export function formatThickness(t: number | string): string {
  const n = Number(t)
  if (!Number.isFinite(n) || n <= 0) return String(t)
  return formatInches(n)
}

/** Pieces in the shop's standard thickness are not flagged; anything else is highlighted on the sheet. */
export const STANDARD_THICKNESS = 0.75
export const isNonStandardThickness = (t: number | string) => {
  const n = Number(t)
  return Number.isFinite(n) && n > 0 && Math.abs(n - STANDARD_THICKNESS) > 1e-9
}

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']

/** "2026-06-11" -> "JUNE 11-2026" (the sheet's date style). Empty or invalid -> "". */
export function formatSheetDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return ''
  const month = MONTHS[Number(m[2]) - 1]
  return month ? `${month} ${Number(m[3])}-${m[1]}` : ''
}

/**
 * QC sign-off column. On the sheet every 4th row (starting at row 2) carries a station box,
 * cycling CNC, SAND, SPRAY, PRESS; the other rows show "-" and row 1 is an empty box.
 * ASSUMPTION: this is a sampling pattern - to be confirmed with the client.
 */
export const QC_STATIONS = ['CNC', 'SAND', 'SPRAY', 'PRESS'] as const
export function qcStation(rowNumber: number): (typeof QC_STATIONS)[number] | null {
  if (rowNumber < 2 || (rowNumber - 2) % 4 !== 0) return null
  return QC_STATIONS[((rowNumber - 2) / 4) % QC_STATIONS.length]
}
