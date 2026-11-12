import { signal } from '@preact/signals'
import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-preact'

export type ToastKind = 'success' | 'warning' | 'error'
type Item = { id: number; msg: string; kind: ToastKind }

export const TOAST_MS = 3000
const items = signal<Item[]>([])
const timers = new Map<number, ReturnType<typeof setTimeout>>()
let nextId = 1

export function toast(msg: string, kind: ToastKind = 'success'): void {
  const id = nextId++
  items.value = [...items.value, { id, msg, kind }]
  timers.set(id, setTimeout(() => dismiss(id), TOAST_MS))
}

function dismiss(id: number) {
  clearTimeout(timers.get(id))
  timers.delete(id)
  items.value = items.value.filter(t => t.id !== id)
}

/** Test helper: drops every toast and pending timer. */
export function dismissAllToasts(): void {
  timers.forEach(clearTimeout)
  timers.clear()
  items.value = []
}

const ICONS = { success: CircleCheck, warning: TriangleAlert, error: CircleAlert }

export function ToastHost() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {items.value.map(t => {
        const Icon = ICONS[t.kind]
        return (
          <div key={t.id} class="toast" data-testid="toast" data-kind={t.kind}>
            <Icon size={16} />
            <span>{t.msg}</span>
          </div>
        )
      })}
    </div>
  )
}
