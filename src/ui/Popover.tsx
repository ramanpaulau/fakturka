import type { ComponentChildren } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'

export type PopoverNavKey = 'up' | 'down' | 'home' | 'end' | 'enter'
type Anchor = HTMLElement | { current: HTMLElement | null } | null

const NAV_KEYS: Record<string, PopoverNavKey> = { ArrowUp: 'up', ArrowDown: 'down', Home: 'home', End: 'end', Enter: 'enter' }
const resolveAnchor = (a: Anchor): HTMLElement | null => (a && 'current' in a ? a.current : (a as HTMLElement | null))

export type PopoverProps = {
  anchor: Anchor
  open: boolean
  onClose: () => void
  /** Called for ArrowUp/Down, Home, End and Enter while open, so a picker can move its own highlight. */
  onKeyNav?: (key: PopoverNavKey, e: KeyboardEvent) => void
  /** Which nav keys go to `onKeyNav` (default all); the others keep their default action, e.g. Home/End in a search field. */
  navKeys?: PopoverNavKey[]
  /** Which edge of the anchor the popover lines up with. */
  align?: 'start' | 'end'
  class?: string
  children?: ComponentChildren
}

/** Floating panel anchored below (or, when short on room, above) an element. Closes on outside click and Esc. */
export function Popover({ anchor, open, onClose, onKeyNav, navKeys, align = 'start', class: cls, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const latest = useRef({ onClose, onKeyNav, navKeys })
  latest.current = { onClose, onKeyNav, navKeys }

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const a = resolveAnchor(anchor)
      const el = ref.current
      if (!a || !el) return
      const r = a.getBoundingClientRect()
      const h = el.offsetHeight
      const w = el.offsetWidth
      const below = r.bottom + 4
      const top = below + h > window.innerHeight && r.top - 4 - h >= 0 ? r.top - 4 - h : below
      const left = align === 'end' ? r.right - w : r.left
      setPos({ top, left: Math.max(4, Math.min(left, window.innerWidth - w - 4)) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchor, align])

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || resolveAnchor(anchor)?.contains(t)) return
      latest.current.onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return // keys that belong to an IME / dead-key composition
      if (e.key === 'Escape') {
        e.preventDefault()
        latest.current.onClose()
        return
      }
      const nav = NAV_KEYS[e.key]
      const cb = latest.current.onKeyNav
      if (!nav || !cb || (latest.current.navKeys && !latest.current.navKeys.includes(nav))) return
      // A focused button/link inside the panel keeps its own Enter behaviour.
      if (nav === 'enter' && ['BUTTON', 'A'].includes((e.target as HTMLElement | null)?.tagName ?? '')) return
      e.preventDefault()
      cb(nav, e)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, anchor])

  if (!open) return null
  return (
    <div ref={ref} class={['popover', cls].filter(Boolean).join(' ')} style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }}>
      {children}
    </div>
  )
}
