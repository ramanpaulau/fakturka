import { signal } from '@preact/signals'
import { useId, useLayoutEffect, useRef } from 'preact/hooks'
import { Button } from './Button'

type Choice = { value: string; label: string; primary?: boolean; danger?: boolean }
type Pending = {
  id: number
  title: string
  body: string
  choices: Choice[]
  /** Value resolved on Esc / backdrop click. */
  dismissValue: string | null
  resolve: (v: string | null) => void
}

const queue = signal<Pending[]>([])

let nextId = 1

function enqueue(p: Omit<Pending, 'id' | 'resolve'>): Promise<string | null> {
  return new Promise(resolve => { queue.value = [...queue.value, { ...p, id: nextId++, resolve }] })
}

export async function confirmDialog(opts: { title: string; body: string; confirm: string; cancel?: string; danger?: boolean }): Promise<boolean> {
  const v = await enqueue({
    title: opts.title,
    body: opts.body,
    choices: [
      { value: 'cancel', label: opts.cancel ?? 'Zrušit' },
      { value: 'confirm', label: opts.confirm, primary: true, danger: opts.danger },
    ],
    dismissValue: 'cancel',
  })
  return v === 'confirm'
}

export function choiceDialog<T extends string>(opts: { title: string; body: string; choices: { value: T; label: string; primary?: boolean }[] }): Promise<T | null> {
  return enqueue({ title: opts.title, body: opts.body, choices: opts.choices, dismissValue: null }) as Promise<T | null>
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function ModalDialog({ d, onDone }: { d: Pending; onDone: (v: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const primary = d.choices.find(c => c.primary) ?? d.choices[d.choices.length - 1]

  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const root = ref.current
    root?.querySelector<HTMLElement>('[data-primary="true"]')?.focus()
    return () => { if (previous && document.contains(previous)) previous.focus() }
  }, [])

  // Listen on document: after a click on the title or body text focus falls back to <body>,
  // and the dialog's keys must keep working from there.
  const latest = useRef({ d, onDone, primary })
  latest.current = { d, onDone, primary }
  useLayoutEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { d, onDone, primary } = latest.current
      const root = ref.current
      if (!root) return
      const target = e.target as HTMLElement | null
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onDone(d.dismissValue)
      } else if (e.key === 'Enter') {
        // A focused dialog button keeps its own Enter behaviour; anywhere else Enter means the primary action.
        if (target?.tagName === 'BUTTON' && root.contains(target)) return
        e.preventDefault()
        onDone(primary.value)
      } else if (e.key === 'Tab') {
        const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
        if (nodes.length === 0) return
        const first = nodes[0]
        const last = nodes[nodes.length - 1]
        const active = document.activeElement
        if (!root.contains(active)) {
          e.preventDefault()
          ;(e.shiftKey ? last : first).focus()
        } else if (e.shiftKey && active === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div class="backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onDone(d.dismissValue) }}>
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <h2 id={titleId}>{d.title}</h2>
        <p>{d.body}</p>
        <div class="dialog-actions">
          {d.choices.map(c => (
            <Button
              key={c.value}
              variant={c.danger ? 'danger' : c.primary ? 'primary' : 'secondary'}
              data-primary={c === primary ? 'true' : undefined}
              onClick={() => onDone(c.value)}
            >
              {c.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Mount once near the app root. Shows queued dialogs one at a time. */
export function DialogHost() {
  const current = queue.value[0]
  if (!current) return null
  const done = (v: string | null) => {
    queue.value = queue.value.filter(p => p !== current)
    current.resolve(v)
  }
  return <ModalDialog key={current.id} d={current} onDone={done} />
}
