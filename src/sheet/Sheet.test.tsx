import { render } from '@testing-library/preact'
import { describe, expect, test, vi } from 'vitest'
import { formatCzk } from '../domain/money'
import { fixtureInvoice } from '../test/fixtures'
import { A4, LAYOUT, mmToPt } from './layout'
import { Sheet, type SheetEditApi } from './Sheet'

describe('Sheet (static)', () => {
  test('renders the fixed copy and invoice values', () => {
    const { container, getByText } = render(<Sheet invoice={fixtureInvoice} mode="static" />)
    expect(getByText('Faktura')).toBeInTheDocument()
    expect(getByText('Nejsem plátce DPH')).toBeInTheDocument()
    expect(getByText('30. 11. 2026')).toBeInTheDocument()
    expect(container.textContent).toContain(formatCzk(42000))
    expect(container.textContent).toContain('DIČ: CZ12345679')
    expect(container.textContent).toContain('Fyzická osoba zapsaná')
  })

  test('hides DIČ when showDic is false', () => {
    const { container } = render(<Sheet invoice={{ ...fixtureInvoice, showDic: false }} mode="static" />)
    expect(container.textContent).not.toContain('DIČ')
  })

  test('shows an empty amount, not 0, when amount is null', () => {
    const { container } = render(<Sheet invoice={{ ...fixtureInvoice, amount: null }} mode="static" />)
    expect(container.textContent).not.toContain('Kč')
    expect(container.textContent).not.toMatch(/\b0,-/)
  })

  test('omits the note line when empty', () => {
    const { container } = render(<Sheet invoice={{ ...fixtureInvoice, supplier: { ...fixtureInvoice.supplier, note: '' } }} mode="static" />)
    expect(container.textContent).not.toContain('Fyzická osoba')
  })

  test('renders no editing controls', () => {
    const { container } = render(<Sheet invoice={fixtureInvoice} mode="static" />)
    expect(container.querySelector('.controls')).toBeNull()
  })

  test('the sheet is exactly A4 in mm', () => {
    const { container } = render(<Sheet invoice={fixtureInvoice} mode="static" />)
    const sheet = container.querySelector('.sheet') as HTMLElement
    expect(sheet.style.width).toBe('210mm')
    expect(sheet.style.height).toBe('297mm')
  })
})

const api = (over: Partial<SheetEditApi> = {}): SheetEditApi => ({
  setField: vi.fn(),
  setAmount: vi.fn(),
  setDate: vi.fn(),
  numberTaken: false,
  ...over,
})

/** Position, size and font of every printed box, plus the printed text: what must match between modes. */
function paper(container: Element) {
  const sheet = container.querySelector('.sheet') as HTMLElement
  const clone = sheet.cloneNode(true) as HTMLElement
  clone.querySelectorAll('.controls').forEach(n => n.remove())
  const boxes = [...clone.querySelectorAll<HTMLElement>('.abs, .fit, .rule')].map(e =>
    [e.className.replace(/\s+/g, ' ').trim(), e.style.left, e.style.right, e.style.top, e.style.width, e.style.fontSize, e.dataset.h].join('|'),
  )
  return { boxes, text: clone.textContent, style: sheet.getAttribute('style') }
}

describe('Sheet (edit)', () => {
  test('the paper is identical to static mode once controls are removed', () => {
    const s = render(<Sheet invoice={fixtureInvoice} mode="static" />)
    const staticPaper = paper(s.container)
    s.unmount()
    const e = render(<Sheet invoice={fixtureInvoice} mode="edit" edit={api({ numberTaken: true })} />)
    expect(paper(e.container)).toEqual(staticPaper)
  })

  test('also identical without DIČ and with empty optional lines', () => {
    const inv = { ...fixtureInvoice, showDic: true, supplier: { ...fixtureInvoice.supplier, dic: '', note: '' } }
    const s = render(<Sheet invoice={inv} mode="static" />)
    const staticPaper = paper(s.container)
    s.unmount()
    const e = render(<Sheet invoice={inv} mode="edit" edit={api()} />)
    expect(paper(e.container)).toEqual(staticPaper)
    // the empty optional lines are there to be filled in, but only as controls
    const dic = e.container.querySelector('[data-field="supplier.dic"]')!
    expect(dic.closest('.controls')).not.toBeNull()
    expect(e.container.querySelector('[data-field="supplier.note"]')!.closest('.controls')).not.toBeNull()
  })

  test('every text field is editable, dates and the variabilní symbol are not', () => {
    const { container } = render(<Sheet invoice={fixtureInvoice} mode="edit" edit={api()} />)
    const editable = [...container.querySelectorAll('[contenteditable="true"]')].map(e => e.getAttribute('data-field'))
    expect(editable.sort()).toEqual(
      [
        'number',
        'supplier.name', 'supplier.street', 'supplier.city', 'supplier.ico', 'supplier.dic', 'supplier.note',
        'customer.name', 'customer.street', 'customer.city', 'customer.ico', 'customer.dic',
        'payment.method', 'payment.bank', 'payment.account',
        'text.text',
        'amount',
      ].sort(),
    )
  })

  test('commits through the edit api', () => {
    const edit = api()
    const { container } = render(<Sheet invoice={fixtureInvoice} mode="edit" edit={edit} />)
    const el = container.querySelector<HTMLElement>('[data-field="payment.bank"]')!
    el.textContent = 'Jiná banka'
    el.dispatchEvent(new Event('input', { bubbles: true }))
    expect(edit.setField).toHaveBeenCalledWith('payment.bank', 'Jiná banka')
  })

  test('static mode has no editable fields', () => {
    const { container } = render(<Sheet invoice={fixtureInvoice} mode="static" />)
    expect(container.querySelector('[contenteditable]')).toBeNull()
  })
})

describe('layout', () => {
  test('mmToPt converts A4 to PDF points', () => {
    expect(mmToPt(A4.w)).toBeCloseTo(595.28, 1)
    expect(mmToPt(A4.h)).toBeCloseTo(841.89, 1)
  })

  test('every box lies inside the page margins', () => {
    const boxes = [LAYOUT.header, LAYOUT.supplier, LAYOUT.customer, LAYOUT.payment, LAYOUT.dates, LAYOUT.text, LAYOUT.footer]
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(LAYOUT.margin)
      expect(b.y).toBeGreaterThanOrEqual(LAYOUT.margin)
      expect(b.x + b.w).toBeLessThanOrEqual(A4.w - LAYOUT.margin + 1e-9)
      expect(b.y + b.h).toBeLessThanOrEqual(A4.h - LAYOUT.margin + 1e-9)
    }
  })
})

describe('Sheet (edit): IČO check', () => {
  const api = (): SheetEditApi => ({ setField: vi.fn(), setAmount: vi.fn(), setDate: vi.fn(), numberTaken: false })
  test('marks an IČO with a bad checksum, not a valid or empty one', () => {
    const inv = { ...fixtureInvoice, customer: { ...fixtureInvoice.customer, ico: '12345678' } }
    const { container } = render(<Sheet invoice={inv} mode="edit" edit={api()} />)
    const bad = container.querySelector('[data-field="customer.ico"]')!
    expect(bad).toHaveAttribute('aria-invalid', 'true')
    expect(bad).toHaveAttribute('data-invalid', 'Neplatné IČO')
    expect(container.querySelector('[data-field="supplier.ico"]')).not.toHaveAttribute('aria-invalid')
    const empty = render(<Sheet invoice={{ ...inv, customer: { ...inv.customer, ico: '' } }} mode="edit" edit={api()} />)
    expect(empty.container.querySelector('[data-field="customer.ico"]')).not.toHaveAttribute('aria-invalid')
  })

  test('prints "IČO:" on the paper', () => {
    const { container } = render(<Sheet invoice={fixtureInvoice} mode="static" />)
    expect(container.textContent).toContain('IČO: 12345679')
  })
})
