import { signal } from '@preact/signals'
import { fold } from '../domain/entities'
import type { InvoiceRecord } from '../domain/types'

/** Issue months 'YYYY-MM', both ends inclusive. null = all invoices. */
export type MonthRange = { from: string; to: string } | null

export type YearGroup = { year: string; records: InvoiceRecord[]; count: number; total: number }

/** Heading of the group that holds the lone PDFs (no issue date to group by). */
export const OTHER_GROUP = 'Ostatní'

/** The range chosen in the Historie toolbar; "Vše" until the range picker sets it. */
export const historyRange = signal<MonthRange>(null)

const amountOf = (r: InvoiceRecord): number => (r.kind === 'invoice' ? (r.invoice.amount ?? 0) : 0)

/** Invoices issued in the range. Lone PDFs have no issue date: kept for "all", dropped for any range. */
export function filterByRange(recs: InvoiceRecord[], r: MonthRange): InvoiceRecord[] {
  if (r === null) return recs
  return recs.filter(rec => {
    if (rec.kind !== 'invoice') return false
    const month = rec.invoice.issueDate.slice(0, 7)
    return month >= r.from && month <= r.to
  })
}

export function totals(recs: InvoiceRecord[]): { count: number; total: number } {
  return { count: recs.length, total: recs.reduce((sum, r) => sum + amountOf(r), 0) }
}

/** Newest year first, records in the given order; lone PDFs go last under "Ostatní". */
export function groupByYear(recs: InvoiceRecord[]): YearGroup[] {
  const byYear = new Map<string, InvoiceRecord[]>()
  const others: InvoiceRecord[] = []
  for (const r of recs) {
    if (r.kind !== 'invoice') {
      others.push(r)
      continue
    }
    const year = r.invoice.issueDate.slice(0, 4)
    byYear.set(year, [...(byYear.get(year) ?? []), r])
  }
  const groups = [...byYear.keys()].sort().reverse().map(year => ({ year, records: byYear.get(year)!, ...totals(byYear.get(year)!) }))
  if (others.length > 0) groups.push({ year: OTHER_GROUP, records: others, ...totals(others) })
  return groups
}

/** Matches invoice number, customer name and IČO (lone PDFs: file name), ignoring case and diacritics. */
export function searchRecords(recs: InvoiceRecord[], q: string): InvoiceRecord[] {
  const needle = fold(q.trim())
  if (needle === '') return recs
  return recs.filter(r => {
    const hay = r.kind === 'invoice' ? [r.invoice.number, r.invoice.customer.name, r.invoice.customer.ico] : [r.fileName]
    return hay.some(s => fold(s).includes(needle))
  })
}

export type Preset = 'all' | 'thisYear' | 'lastYear' | 'last6' | 'last12'

const pad = (n: number) => String(n).padStart(2, '0')
const ym = (year: number, month0: number) => {
  const t = new Date(Date.UTC(year, month0, 1))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`
}

/** The range behind a preset; `today` is injected so nothing here reads the clock. */
export function presetRange(p: Preset, today: Date): MonthRange {
  const y = today.getFullYear()
  const m = today.getMonth()
  if (p === 'all') return null
  if (p === 'thisYear') return { from: `${y}-01`, to: `${y}-12` }
  if (p === 'lastYear') return { from: `${y - 1}-01`, to: `${y - 1}-12` }
  return { from: ym(y, m - (p === 'last6' ? 5 : 11)), to: ym(y, m) }
}

export const MONTH_NAMES = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec']
const monthName = (m: string) => `${MONTH_NAMES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`

/** Label of a range: "Vše", "listopad 2026", "červen 2026 – listopad 2026", or for whole years "2025 – 2026". */
export function formatRange(r: MonthRange): string {
  if (r === null) return 'Vše'
  if (r.from.endsWith('-01') && r.to.endsWith('-12')) {
    const [a, b] = [r.from.slice(0, 4), r.to.slice(0, 4)]
    return a === b ? a : `${a} – ${b}`
  }
  return r.from === r.to ? monthName(r.from) : `${monthName(r.from)} – ${monthName(r.to)}`
}

/** Number of months in a range, both ends inclusive. */
export function monthCount(r: NonNullable<MonthRange>): number {
  const n = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5))
  return n(r.to) - n(r.from) + 1
}

/** Czech plural: 1 faktura, 2-4 faktury, 0 and 5+ faktur. */
export function plural(n: number, one: string, few: string, many: string): string {
  return `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`
}
