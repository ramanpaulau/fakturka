import { render, type ComponentChildren } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'

/**
 * Renders its children into a <div> at the end of <body>, e.g. to lift a popover out of the paper sheet (which clips
 * and restyles everything inside it). Core Preact only: importing `preact/compat` for createPortal would switch the
 * whole app to React event semantics (onFocus -> focusin, onChange -> input). Context does not cross the portal.
 */
export function Portal({ children }: { children?: ComponentChildren }) {
  const host = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    host.current = el
    return () => {
      render(null, el)
      el.remove()
      host.current = null
    }
  }, [])
  useLayoutEffect(() => {
    if (host.current) render(<>{children}</>, host.current)
  })
  return null
}
