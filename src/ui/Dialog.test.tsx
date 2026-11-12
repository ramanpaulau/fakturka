import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { choiceDialog, confirmDialog, DialogHost } from './Dialog'

afterEach(async () => {
  // close anything left open so tests stay independent
  if (screen.queryByRole('dialog')) fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  await act(async () => {})
  cleanup()
})

const open = async <T,>(p: Promise<T>) => { await screen.findByRole('dialog'); return p }

describe('confirmDialog', () => {
  const opts = { title: 'Smazat fakturu?', body: 'Tuto akci nelze vrátit.', confirm: 'Smazat', danger: true }

  it('renders an in-app modal with title, body and buttons', async () => {
    render(<DialogHost />)
    const p = confirmDialog(opts)
    const dlg = await screen.findByRole('dialog')
    expect(dlg).toHaveAttribute('aria-modal', 'true')
    expect(dlg).toHaveAccessibleName('Smazat fakturu?')
    expect(screen.getByText('Tuto akci nelze vrátit.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zrušit' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Smazat' }))
    expect(await p).toBe(true)
    await act(async () => {})
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('cancel button resolves false; custom cancel label works', async () => {
    render(<DialogHost />)
    const p = confirmDialog({ ...opts, cancel: 'Ne' })
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Ne' }))
    expect(await p).toBe(false)
  })

  it('Esc cancels', async () => {
    render(<DialogHost />)
    const p = confirmDialog(opts)
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' })
    expect(await p).toBe(false)
  })

  it('Enter confirms (primary)', async () => {
    render(<DialogHost />)
    const p = confirmDialog(opts)
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Enter' })
    expect(await p).toBe(true)
  })

  it('moves focus into the dialog and traps Tab', async () => {
    render(<><button>mimo</button><DialogHost /></>)
    screen.getByText('mimo').focus()
    const p = confirmDialog(opts)
    const dlg = await screen.findByRole('dialog')
    const cancel = screen.getByRole('button', { name: 'Zrušit' })
    const ok = screen.getByRole('button', { name: 'Smazat' })
    expect(dlg.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(ok)
    fireEvent.keyDown(ok, { key: 'Tab' })
    expect(document.activeElement).toBe(cancel)
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(ok)
    fireEvent.click(ok)
    await p
  })

  it('restores focus to the previously focused element on close', async () => {
    render(<><button>mimo</button><DialogHost /></>)
    screen.getByText('mimo').focus()
    const p = confirmDialog(opts)
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' })
    await p
    await act(async () => {})
    expect(document.activeElement).toBe(screen.getByText('mimo'))
  })

  it('does not use window.confirm', async () => {
    const orig = window.confirm
    let called = false
    window.confirm = () => { called = true; return true }
    render(<DialogHost />)
    const p = confirmDialog(opts)
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' })
    await p
    window.confirm = orig
    expect(called).toBe(false)
  })

  it('queues a second dialog behind the first', async () => {
    render(<DialogHost />)
    const p1 = confirmDialog({ ...opts, title: 'První' })
    const p2 = confirmDialog({ ...opts, title: 'Druhý' })
    expect(await screen.findByRole('dialog')).toHaveAccessibleName('První')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(await p1).toBe(false)
    expect(await screen.findByRole('dialog', { name: 'Druhý' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' })
    expect(await p2).toBe(true)
  })
})

describe('confirmDialog keyboard with focus outside the dialog', () => {
  const opts = { title: 'Smazat?', body: 'Text', confirm: 'Smazat' }
  const blurToBody = async () => {
    const dlg = await screen.findByRole('dialog')
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(document.activeElement).toBe(document.body)
    return dlg
  }

  it('Esc on document cancels after focus fell to <body>', async () => {
    render(<DialogHost />)
    const p = confirmDialog(opts)
    await blurToBody()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(await p).toBe(false)
  })

  it('Enter on document confirms after focus fell to <body>', async () => {
    render(<DialogHost />)
    const p = confirmDialog(opts)
    await blurToBody()
    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(await p).toBe(true)
  })

  it('Tab from <body> moves focus back into the dialog; Shift+Tab goes to the last control', async () => {
    render(<DialogHost />)
    const p = confirmDialog(opts)
    const dlg = await blurToBody()
    fireEvent.keyDown(document.body, { key: 'Tab' })
    expect(dlg.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Zrušit' }))
    ;(document.activeElement as HTMLElement).blur()
    fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Smazat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Smazat' }))
    await p
  })

  it('stops handling keys once the dialog is closed', async () => {
    render(<DialogHost />)
    const p = confirmDialog(opts)
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' })
    await p
    await act(async () => {})
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    outside.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
    outside.remove()
  })
})

describe('choiceDialog', () => {
  const opts = {
    title: 'Neuložené změny',
    body: 'Chcete je uložit?',
    choices: [
      { value: 'discard' as const, label: 'Zahodit' },
      { value: 'save' as const, label: 'Uložit', primary: true },
    ],
  }

  it('resolves with the clicked choice', async () => {
    render(<DialogHost />)
    const p = open(choiceDialog(opts))
    fireEvent.click(await screen.findByRole('button', { name: 'Zahodit' }))
    expect(await p).toBe('discard')
  })

  it('Enter picks the primary choice, Esc resolves null', async () => {
    render(<DialogHost />)
    const p = choiceDialog(opts)
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Enter' })
    expect(await p).toBe('save')

    const q = choiceDialog(opts)
    await act(async () => {})
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' })
    expect(await q).toBeNull()
  })
})
