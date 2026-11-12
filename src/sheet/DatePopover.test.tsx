import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { DatePopover, monthGrid } from './DatePopover'

let anchor: HTMLButtonElement
beforeEach(() => {
  anchor = document.createElement('button')
  document.body.appendChild(anchor)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 9, 12))
})
afterEach(() => {
  cleanup()
  anchor.remove()
  vi.useRealTimers()
})

function setup(value = '2026-11-30') {
  const onSelect = vi.fn()
  const onClose = vi.fn()
  render(<DatePopover anchor={anchor} open value={value} onSelect={onSelect} onClose={onClose} />)
  return { onSelect, onClose }
}

const day = (label: string) => screen.getByRole('button', { name: label })

describe('monthGrid', () => {
  it('starts on Monday and always has 6 weeks', () => {
    const g = monthGrid(2026, 10) // listopad 2026, the 1st is a Sunday
    expect(g).toHaveLength(42)
    expect(g[0]).toBe('2026-10-26')
    expect(g[6]).toBe('2026-11-01')
    expect(g[41]).toBe('2026-12-06')
  })
})

describe('DatePopover', () => {
  it('shows the Czech month name and Monday-first weekday initials', () => {
    setup()
    expect(screen.getByText('listopad 2026')).toBeInTheDocument()
    const heads = screen.getAllByRole('columnheader').map(h => h.textContent)
    expect(heads).toEqual(['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'])
  })

  it('highlights the selected date and marks today', () => {
    setup()
    expect(day('30. 11. 2026')).toHaveAttribute('aria-pressed', 'true')
    expect(day('9. 11. 2026')).toHaveAttribute('aria-current', 'date')
    expect(day('10. 11. 2026')).not.toHaveAttribute('aria-current')
  })

  it('arrows navigate months', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Následující měsíc' }))
    expect(screen.getByText('prosinec 2026')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Následující měsíc' }))
    expect(screen.getByText('leden 2027')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Předchozí měsíc' }))
    fireEvent.click(screen.getByRole('button', { name: 'Předchozí měsíc' }))
    fireEvent.click(screen.getByRole('button', { name: 'Předchozí měsíc' }))
    expect(screen.getByText('říjen 2026')).toBeInTheDocument()
  })

  it('clicking a day selects it and closes', () => {
    const { onSelect, onClose } = setup()
    fireEvent.click(day('3. 11. 2026'))
    expect(onSelect).toHaveBeenCalledWith('2026-11-03')
    expect(onClose).toHaveBeenCalled()
  })

  it('keyboard: arrows move the highlight, Enter selects', () => {
    const { onSelect } = setup('2026-11-30')
    fireEvent.keyDown(document, { key: 'ArrowDown' }) // +7 -> 7. 12.
    expect(screen.getByText('prosinec 2026')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'ArrowLeft' }) // -1 -> 6. 12.
    fireEvent.keyDown(document, { key: 'ArrowUp' }) // -7 -> 29. 11.
    fireEvent.keyDown(document, { key: 'ArrowRight' }) // +1 -> 30. 11.
    fireEvent.keyDown(document, { key: 'ArrowRight' }) // +1 -> 1. 12.
    expect(day('1. 12. 2026')).toHaveClass('active')
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('2026-12-01')
  })

  it('keyboard: Home/End jump to the first/last day of the month, PageDown to the next month', () => {
    const { onSelect } = setup('2026-11-17')
    fireEvent.keyDown(document, { key: 'Home' })
    expect(day('1. 11. 2026')).toHaveClass('active')
    fireEvent.keyDown(document, { key: 'End' })
    expect(day('30. 11. 2026')).toHaveClass('active')
    fireEvent.keyDown(document, { key: 'PageDown' })
    expect(screen.getByText('prosinec 2026')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('2026-12-30')
  })

  it('Esc closes', () => {
    const { onClose } = setup()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
