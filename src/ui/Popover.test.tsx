import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import { Popover } from './Popover'

afterEach(cleanup)

function setup(props: Partial<Parameters<typeof Popover>[0]> = {}) {
  const anchor = document.createElement('button')
  anchor.textContent = 'kotva'
  document.body.appendChild(anchor)
  const onClose = vi.fn()
  const onKeyNav = vi.fn()
  const utils = render(
    <>
      <p>mimo</p>
      <Popover anchor={anchor} open onClose={onClose} onKeyNav={onKeyNav} {...props}>
        <button>volba</button>
      </Popover>
    </>,
  )
  return { anchor, onClose, onKeyNav, ...utils }
}

describe('Popover', () => {
  it('renders nothing when closed', () => {
    setup({ open: false })
    expect(screen.queryByText('volba')).toBeNull()
  })

  it('renders its children when open', () => {
    setup()
    expect(screen.getByText('volba')).toBeInTheDocument()
  })

  it('closes on outside mousedown but not on inside or anchor mousedown', () => {
    const { onClose, anchor } = setup()
    fireEvent.mouseDown(screen.getByText('volba'))
    fireEvent.mouseDown(anchor)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseDown(screen.getByText('mimo'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape', () => {
    const { onClose } = setup()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('reports keyboard navigation through onKeyNav', () => {
    const { onKeyNav } = setup()
    fireEvent.keyDown(document, { key: 'ArrowDown' })
    fireEvent.keyDown(document, { key: 'ArrowUp' })
    fireEvent.keyDown(document, { key: 'Home' })
    fireEvent.keyDown(document, { key: 'End' })
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onKeyNav.mock.calls.map(c => c[0])).toEqual(['down', 'up', 'home', 'end', 'enter'])
  })

  it('stops listening after it closes', () => {
    const { onClose, rerender, anchor } = setup()
    rerender(<Popover anchor={anchor} open={false} onClose={onClose}><button>volba</button></Popover>)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(document.body)
    expect(onClose).not.toHaveBeenCalled()
  })
})
