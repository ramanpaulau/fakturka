import { describe, expect, it } from 'vitest'
import type { InvoiceRecord } from '../domain/types'
import { fixtureInvoice } from '../test/fixtures'
import { filterByRange, formatRange, groupByYear, historyRange, monthCount, plural, presetRange, searchRecords, totals } from './historyModel'

const rec = (number: string, issueDate: string, amount: number | null, customer = 'Příklad s.r.o.', ico = '87654321'): InvoiceRecord => ({
  kind: 'invoice',
  invoice: { ...fixtureInvoice, number, issueDate, amount, customer: { ...fixtureInvoice.customer, name: customer, ico } },
  jsonPath: `/f/${number}.json`,
  pdfPath: `/f/${number}.pdf`,
  baseName: number,
})
const lone: InvoiceRecord = { kind: 'pdfOnly', pdfPath: '/f/stara-faktura.pdf', fileName: 'stara-faktura.pdf' }

// Newest first, like listInvoices; 2025-10 .. 2026-12.
const fixture: InvoiceRecord[] = [
  rec('202612', '2026-12-31', 100),
  rec('202611', '2026-11-30', 200),
  rec('202606', '2026-06-30', 300),
  rec('202605', '2026-05-31', 400),
  rec('202603', '2026-03-31', 500),
  rec('202510', '2025-10-31', 600),
  lone,
]
const numbers = (rs: InvoiceRecord[]) => rs.map(r => (r.kind === 'invoice' ? r.invoice.number : r.fileName))

describe('filterByRange', () => {
  it('null keeps everything, lone PDFs included', () => {
    expect(filterByRange(fixture, null)).toEqual(fixture)
  })

  it('keeps the issue months of the range, both ends inclusive, and drops lone PDFs', () => {
    expect(numbers(filterByRange(fixture, { from: '2026-06', to: '2026-11' }))).toEqual(['202611', '202606'])
  })

  it('a range may cross years', () => {
    expect(numbers(filterByRange(fixture, { from: '2025-10', to: '2026-03' }))).toEqual(['202603', '202510'])
  })

  it('a single month works', () => {
    expect(numbers(filterByRange(fixture, { from: '2026-05', to: '2026-05' }))).toEqual(['202605'])
  })
})

describe('totals', () => {
  it('counts every record and sums the amounts (missing amount = 0)', () => {
    expect(totals([...fixture, rec('x', '2026-01-31', null)])).toEqual({ count: 8, total: 2100 })
    expect(totals([])).toEqual({ count: 0, total: 0 })
  })
})

describe('groupByYear', () => {
  it('orders years newest first, sums totals and puts lone PDFs last under "Ostatní"', () => {
    const groups = groupByYear(fixture)
    expect(groups.map(g => g.year)).toEqual(['2026', '2025', 'Ostatní'])
    expect(groups.map(g => [g.count, g.total])).toEqual([[5, 1500], [1, 600], [1, 0]])
    expect(numbers(groups[0].records)).toEqual(['202612', '202611', '202606', '202605', '202603'])
    expect(numbers(groups[2].records)).toEqual(['stara-faktura.pdf'])
  })

  it('has no "Ostatní" group without lone PDFs and no groups when empty', () => {
    expect(groupByYear(fixture.slice(0, 2)).map(g => g.year)).toEqual(['2026'])
    expect(groupByYear([])).toEqual([])
  })
})

describe('searchRecords', () => {
  const recs = [rec('202611', '2026-11-30', 1, 'Příklad s.r.o.', '87654321'), rec('20261002', '2026-10-31', 1, 'Firma Beta a.s.', '55667788'), lone]

  it('matches the customer name without regard to diacritics or case', () => {
    expect(numbers(searchRecords(recs, 'prik'))).toEqual(['202611'])
    expect(numbers(searchRecords(recs, 'BETA'))).toEqual(['20261002'])
  })

  it('matches the invoice number and the IČO', () => {
    expect(numbers(searchRecords(recs, '2026100'))).toEqual(['20261002'])
    expect(numbers(searchRecords(recs, '5566'))).toEqual(['20261002'])
  })

  it('matches the file name of a lone PDF', () => {
    expect(numbers(searchRecords(recs, 'stara'))).toEqual(['stara-faktura.pdf'])
  })

  it('an empty or blank query keeps everything', () => {
    expect(searchRecords(recs, '')).toEqual(recs)
    expect(searchRecords(recs, '  ')).toEqual(recs)
  })
})

describe('historyRange', () => {
  it('defaults to all (null)', () => {
    expect(historyRange.value).toBeNull()
  })
})

describe('presetRange', () => {
  const today = new Date(2026, 10, 9) // 9 Nov 2026

  it('all is null', () => {
    expect(presetRange('all', today)).toBeNull()
  })

  it('thisYear and lastYear are whole calendar years', () => {
    expect(presetRange('thisYear', today)).toEqual({ from: '2026-01', to: '2026-12' })
    expect(presetRange('lastYear', today)).toEqual({ from: '2025-01', to: '2025-12' })
  })

  it('last6 and last12 end with the current month', () => {
    expect(presetRange('last6', today)).toEqual({ from: '2026-06', to: '2026-11' })
    expect(presetRange('last12', today)).toEqual({ from: '2025-12', to: '2026-11' })
  })

  it('last6 crosses a year boundary', () => {
    expect(presetRange('last6', new Date(2026, 1, 1))).toEqual({ from: '2025-09', to: '2026-02' })
  })
})

describe('formatRange', () => {
  it('null is Vše', () => {
    expect(formatRange(null)).toBe('Vše')
  })

  it('a range of months names both ends', () => {
    expect(formatRange({ from: '2026-06', to: '2026-11' })).toBe('červen 2026 – listopad 2026')
  })

  it('a single month is named once', () => {
    expect(formatRange({ from: '2026-11', to: '2026-11' })).toBe('listopad 2026')
  })

  it('whole years show the years only', () => {
    expect(formatRange({ from: '2025-01', to: '2026-12' })).toBe('2025 – 2026')
    expect(formatRange({ from: '2026-01', to: '2026-12' })).toBe('2026')
  })

  it('a range that starts in January but does not end in December stays in months', () => {
    expect(formatRange({ from: '2026-01', to: '2026-06' })).toBe('leden 2026 – červen 2026')
  })
})

describe('monthCount and plural', () => {
  it('counts months inclusively across years', () => {
    expect(monthCount({ from: '2026-06', to: '2026-11' })).toBe(6)
    expect(monthCount({ from: '2025-10', to: '2026-03' })).toBe(6)
    expect(monthCount({ from: '2026-11', to: '2026-11' })).toBe(1)
  })

  it('uses the Czech plural forms', () => {
    expect(plural(1, 'měsíc', 'měsíce', 'měsíců')).toBe('1 měsíc')
    expect(plural(2, 'měsíc', 'měsíce', 'měsíců')).toBe('2 měsíce')
    expect(plural(6, 'měsíc', 'měsíce', 'měsíců')).toBe('6 měsíců')
    expect(plural(0, 'faktura', 'faktury', 'faktur')).toBe('0 faktur')
  })
})
