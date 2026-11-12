import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/preact'
import { dismissAllToasts, toast, TOAST_MS, ToastHost } from './Toast'

beforeEach(() => { vi.useFakeTimers(); dismissAllToasts() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('toast', () => {
  it('shows a message and auto-hides after about 3 s', async () => {
    render(<ToastHost />)
    await act(async () => { toast('Uloženo') })
    expect(screen.getByText('Uloženo')).toBeInTheDocument()
    expect(TOAST_MS).toBe(3000)
    await act(async () => { vi.advanceTimersByTime(TOAST_MS - 100) })
    expect(screen.getByText('Uloženo')).toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(200) })
    expect(screen.queryByText('Uloženo')).toBeNull()
  })

  it('stacks several toasts and colours them by kind', async () => {
    render(<ToastHost />)
    await act(async () => {
      toast('a', 'success')
      toast('b', 'warning')
      toast('c', 'error')
      toast('d')
    })
    expect(screen.getByText('a').closest('[data-kind]')).toHaveAttribute('data-kind', 'success')
    expect(screen.getByText('b').closest('[data-kind]')).toHaveAttribute('data-kind', 'warning')
    expect(screen.getByText('c').closest('[data-kind]')).toHaveAttribute('data-kind', 'error')
    expect(screen.getByText('d').closest('[data-kind]')).toHaveAttribute('data-kind', 'success')
    expect(screen.getAllByTestId('toast')).toHaveLength(4)
  })
})
