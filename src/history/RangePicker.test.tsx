import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact'
import { RangePicker } from './RangePicker'
import type { MonthRange } from './historyModel'

afterEach(cleanup)

const TODAY = new Date(2026, 10, 9)
const WITH = new Set(['2026-06', '2026-11', '2025-10'])

function mount(value: MonthRange = null, extra: Partial<Parameters<typeof RangePicker>[0]> = {}) {
  const onChange = vi.fn()
  render(<RangePicker value={value} monthsWithInvoices={WITH} onChange={onChange} today={TODAY} {...extra} />)
  return onChange
}
const openPicker = () => fireEvent.click(screen.getByRole('button', { name: /^Období/ }))
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const apply = () => click('Použít')
const footer = () => document.querySelector('.rp-foot span')?.textContent

describe('field', () => {
  it('shows the formatted range and opens a popover', () => {
    mount({ from: '2026-06', to: '2026-11' })
    const field = screen.getByRole('button', { name: /^Období/ })
    expect(field).toHaveTextContent('Období: červen 2026 – listopad 2026')
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(field)
    expect(screen.getByRole('dialog', { name: 'Vybrat období' })).toBeInTheDocument()
  })

  it('defaults to Vše', () => {
    mount()
    expect(screen.getByRole('button', { name: /^Období/ })).toHaveTextContent('Období: Vše')
  })
})

describe('months', () => {
  it('čvn then lis and Použít picks the range', () => {
    const onChange = mount()
    openPicker()
    click('čvn')
    click('lis')
    apply()
    expect(onChange).toHaveBeenCalledWith({ from: '2026-06', to: '2026-11' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('lis then čvn gives the same range', () => {
    const onChange = mount()
    openPicker()
    click('lis')
    click('čvn')
    apply()
    expect(onChange).toHaveBeenCalledWith({ from: '2026-06', to: '2026-11' })
  })

  it('the same month twice is a single month', () => {
    const onChange = mount()
    openPicker()
    click('lis')
    click('lis')
    apply()
    expect(onChange).toHaveBeenCalledWith({ from: '2026-11', to: '2026-11' })
  })

  it('a third click starts a new range', () => {
    const onChange = mount()
    openPicker()
    click('led')
    click('úno')
    click('říj')
    click('lis')
    apply()
    expect(onChange).toHaveBeenCalledWith({ from: '2026-10', to: '2026-11' })
  })

  it('the year arrows let a range cross a year boundary', () => {
    const onChange = mount({ from: '2026-03', to: '2026-03' })
    openPicker()
    click('Předchozí rok')
    click('říj')
    click('Následující rok')
    click('bře')
    apply()
    expect(onChange).toHaveBeenCalledWith({ from: '2025-10', to: '2026-03' })
  })

  it('shows the Czech short names and a dot on months with invoices', () => {
    mount({ from: '2026-06', to: '2026-06' })
    openPicker()
    const names = [...document.querySelectorAll('.rp-cell')].map(c => c.textContent)
    expect(names).toEqual(['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro'])
    const dotted = [...document.querySelectorAll('.rp-cell')].filter(c => c.querySelector('.rp-dot')).map(c => c.textContent)
    expect(dotted).toEqual(['čvn', 'lis'])
  })

  it('opens on the year of the end of the current range', () => {
    mount({ from: '2025-10', to: '2025-12' })
    openPicker()
    expect(document.querySelector('.rp-year')?.textContent).toBe('2025')
  })

  it('marks the start, the end and the months between', () => {
    mount({ from: '2026-06', to: '2026-11' })
    openPicker()
    const cell = (n: string) => screen.getByRole('button', { name: n })
    expect(cell('čvn')).toHaveClass('s')
    expect(cell('lis')).toHaveClass('e')
    expect(cell('srp')).toHaveClass('in')
    expect(cell('kvě')).not.toHaveClass('in')
    expect(cell('pro')).not.toHaveClass('in')
  })
})

describe('years', () => {
  it('2025 then 2026 maps to whole years', () => {
    const onChange = mount()
    openPicker()
    click('Roky')
    click('2025')
    click('2026')
    apply()
    expect(onChange).toHaveBeenCalledWith({ from: '2025-01', to: '2026-12' })
  })

  it('a year clicked twice is that one year', () => {
    const onChange = mount()
    openPicker()
    click('Roky')
    click('2026')
    click('2026')
    apply()
    expect(onChange).toHaveBeenCalledWith({ from: '2026-01', to: '2026-12' })
  })

  it('lists the years that have invoices, one more on each side', () => {
    mount()
    openPicker()
    click('Roky')
    expect([...document.querySelectorAll('.rp-cell')].map(c => c.textContent)).toEqual(['2024', '2025', '2026', '2027'])
  })

  it('with no invoices at all offers the years around today', () => {
    mount(null, { monthsWithInvoices: new Set() })
    openPicker()
    click('Roky')
    expect([...document.querySelectorAll('.rp-cell')].map(c => c.textContent)).toEqual(['2025', '2026', '2027'])
  })

  it('keeps the years of the current range reachable', () => {
    mount({ from: '2019-01', to: '2019-12' })
    openPicker()
    click('Roky')
    const years = [...document.querySelectorAll('.rp-cell')].map(c => c.textContent)
    expect(years).toContain('2019')
    expect(years).toContain('2026')
  })
})

describe('presets', () => {
  it('lists the five presets', () => {
    mount()
    openPicker()
    const names = within(document.querySelector('.rp-presets') as HTMLElement).getAllByRole('button').map(b => b.textContent)
    expect(names).toEqual(['Vše', 'Tento rok', 'Minulý rok', 'Posledních 6 měsíců', 'Posledních 12 měsíců'])
  })

  it('a preset sets the pending range but needs Použít', () => {
    const onChange = mount()
    openPicker()
    click('Posledních 6 měsíců')
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Posledních 6 měsíců' })).toHaveAttribute('aria-pressed', 'true')
    apply()
    expect(onChange).toHaveBeenCalledWith({ from: '2026-06', to: '2026-11' })
  })

  it('Vše applies null', () => {
    const onChange = mount({ from: '2026-06', to: '2026-11' })
    openPicker()
    click('Vše')
    apply()
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('Minulý rok applies the previous calendar year', () => {
    const onChange = mount()
    openPicker()
    click('Minulý rok')
    apply()
    expect(onChange).toHaveBeenCalledWith({ from: '2025-01', to: '2025-12' })
  })

  it('highlights the preset that equals the current range', () => {
    mount({ from: '2026-01', to: '2026-12' })
    openPicker()
    expect(screen.getByRole('button', { name: 'Tento rok' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Vše' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('footer', () => {
  it('counts months and invoices of the pending range', () => {
    mount(null, { countInvoices: r => (r === null ? 9 : 7) })
    openPicker()
    click('čvn')
    click('lis')
    expect(footer()).toBe('6 měsíců · 7 faktur')
  })

  it('uses the Czech plural forms', () => {
    mount(null, { countInvoices: () => 1 })
    openPicker()
    click('lis')
    expect(footer()).toBe('1 měsíc · 1 faktura')
    click('zář')
    expect(footer()).toBe('3 měsíce · 1 faktura')
  })

  it('for Vše shows only the invoice count', () => {
    mount({ from: '2026-06', to: '2026-11' }, { countInvoices: r => (r === null ? 9 : 7) })
    openPicker()
    expect(footer()).toBe('6 měsíců · 7 faktur')
    click('Vše')
    expect(footer()).toBe('9 faktur')
  })
})

describe('closing', () => {
  it('Esc cancels without applying', () => {
    const onChange = mount()
    openPicker()
    click('lis')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a click outside cancels', () => {
    const onChange = mount()
    openPicker()
    click('lis')
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('reopening starts from the applied range, not an abandoned pick', () => {
    mount({ from: '2026-06', to: '2026-11' })
    openPicker()
    click('led')
    fireEvent.keyDown(document, { key: 'Escape' })
    openPicker()
    expect(screen.getByRole('button', { name: 'čvn' })).toHaveClass('s')
    expect(screen.getByRole('button', { name: 'led' })).not.toHaveClass('s')
  })

  it('the field button toggles the popover', () => {
    mount()
    openPicker()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('button', { name: /^Období/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Období/ }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
