import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { parseSavedData } from './dataStore'
import { parseInvoice } from './invoiceStore'

const fixture = (name: string) =>
  readFileSync(resolve(process.cwd(), 'src/test/fixtures/v0.1.0', name), 'utf8')

describe('v0.1.0 compatibility', () => {
  it('v0.1.0 data file loads', () => {
    const data = parseSavedData(fixture('faktura-data.json'))
    expect(data).not.toBeNull()
    expect(data!.suppliers.length).toBe(1)
    expect(data!.settings.theme).toBe('dark')
    expect(data!.settings.dueRule).toEqual({ kind: 'daysAfterIssue', days: 21 })
    expect(data!.settings.showDicDefault).toBe(false)
  })

  it('v0.1.0 invoice loads', () => {
    const inv = parseInvoice(fixture('2026-11_faktura-202611.json'))
    expect(inv).not.toBeNull()
    expect(inv!.number).toBe('202611')
    expect(inv!.amount).toBe(42000)
    expect(inv!.customer.ico).toBe('25596641')
  })
})
