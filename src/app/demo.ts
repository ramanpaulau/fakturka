import type { Invoice, Party, SavedData, ThemePref } from '../domain/types'
import { MemoryBackend } from '../storage/memoryBackend'
import type { Backend } from '../storage/backend'
import { emptySavedData, saveSavedData } from '../storage/dataStore'
import { fixtureInvoice } from '../test/fixtures'

/**
 * Dev-only: fills the in-memory backend with fake data so the shell can be seen in a browser.
 * main.tsx calls this only behind `import.meta.env.DEV` + `?demo`; it is never reachable in a production build.
 */
export async function seedDemo(b: Backend, theme?: ThemePref): Promise<void> {
  if (!(b instanceof MemoryBackend)) return
  const party = (id: string, p: Omit<Party, 'id'> & { sourceId?: unknown }): Party => {
    const { sourceId: _, ...fields } = p
    return { id, ...fields }
  }
  const { supplier, customer, payment, text } = fixtureInvoice
  const base = emptySavedData()
  const data: SavedData = {
    ...base,
    suppliers: [party('demo-s1', supplier)],
    customers: [
      party('demo-c1', customer),
      // Same name, different company: the picker tells them apart by the second line.
      party('demo-c2', { ...customer, street: 'Polní 3', city: '301 00 Plzeň', ico: '11223344', dic: 'CZ11223344' }),
      party('demo-c3', { name: 'Firma Beta a.s.', street: 'Hlavní 1', city: '702 00 Ostrava', ico: '55667788', dic: '', note: '' }),
    ],
    payments: [{ id: 'demo-p1', method: payment.method, bank: payment.bank, account: payment.account }],
    texts: [{ id: 'demo-t1', text: text.text }],
    settings: { ...base.settings, theme: theme ?? base.settings.theme },
  }
  await saveSavedData(b, data)

  // A few saved invoices across two years (and one lone PDF) so Historie has something to show.
  const dir = await b.defaultInvoiceDir()
  const beta = { ...customer, name: 'Firma Beta a.s.', street: 'Hlavní 1', city: '702 00 Ostrava', ico: '55667788', dic: '' }
  const invoices: [string, string, string, number, Invoice['customer']][] = [
    ['202611', '2026-11-30', '2026-12-15', 42000, customer],
    ['20261002', '2026-10-31', '2026-11-15', 8500, beta],
    ['202610', '2026-10-31', '2026-11-15', 42000, customer],
    ['202609', '2026-09-30', '2026-10-15', 42000, customer],
    ['202512', '2025-12-31', '2026-01-15', 38000, customer],
    ['202511', '2025-11-30', '2025-12-15', 38000, beta],
  ]
  for (const [number, issueDate, dueDate, amount, cust] of invoices) {
    // Linked to the saved entries, so Uložené údaje shows how often each is used.
    const sourceId = cust.ico === beta.ico ? 'demo-c3' : 'demo-c1'
    const inv: Invoice = { ...fixtureInvoice, number, issueDate, dueDate, amount, supplier: { ...supplier, sourceId: 'demo-s1' }, customer: { ...cust, sourceId }, payment: { ...payment, sourceId: 'demo-p1' }, text: { ...text, sourceId: 'demo-t1' }, savedAt: `${issueDate}T10:00:00.000Z` }
    await b.writeInvoice(dir, `${issueDate.slice(0, 7)}_faktura-${number}`, new Uint8Array([37, 80, 68, 70]), JSON.stringify(inv))
  }
  b.files.set(b.join(dir, 'stara-faktura.pdf'), new Uint8Array([37, 80, 68, 70]))
}
