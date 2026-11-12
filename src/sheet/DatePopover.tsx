import { ChevronLeft, ChevronRight } from 'lucide-preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { addDays, formatCzDate } from '../domain/dates'
import { IconButton } from '../ui/IconButton'
import { Popover, type PopoverNavKey } from '../ui/Popover'
import { Portal } from '../ui/Portal'

const MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec']
const WEEKDAYS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne']

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m, d))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}
const parts = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return { y, m: m - 1, d }
}
const localToday = () => {
  const t = new Date()
  return iso(t.getFullYear(), t.getMonth(), t.getDate())
}

/** The 42 days (6 weeks, Monday first) shown for month `m` (0-based) of year `y`, as YYYY-MM-DD. */
export function monthGrid(y: number, m: number): string[] {
  const lead = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7
  return Array.from({ length: 42 }, (_, i) => iso(y, m, 1 - lead + i))
}

/** Same day in the month `delta` months away, clamped to that month's last day. */
function addMonths(s: string, delta: number): string {
  const { y, m, d } = parts(s)
  const last = new Date(Date.UTC(y, m + delta + 1, 0)).getUTCDate()
  return iso(y, m + delta, Math.min(d, last))
}

export type DatePopoverProps = {
  anchor: HTMLElement | { current: HTMLElement | null } | null
  open: boolean
  /** YYYY-MM-DD */
  value: string
  onSelect: (iso: string) => void
  onClose: () => void
}

/**
 * Czech calendar in a Popover (rendered into <body>, outside the paper). The highlighted day follows the keyboard:
 * arrows ±1 day / ±1 week, Home/End first/last day of the month, PageUp/PageDown ±1 month, Enter picks, Esc closes.
 */
export function DatePopover(props: DatePopoverProps) {
  if (!props.open) return null
  return (
    <Portal>
      <Calendar {...props} />
    </Portal>
  )
}

function Calendar({ anchor, value, onSelect, onClose }: DatePopoverProps) {
  const [active, setActive] = useState(value)
  const activeRef = useRef(active)
  activeRef.current = active
  const { y, m } = parts(active)
  const today = localToday()

  const pick = (day: string) => {
    onSelect(day)
    onClose()
  }

  const onKeyNav = (key: PopoverNavKey) => {
    const a = activeRef.current
    const { y: ay, m: am } = parts(a)
    if (key === 'up') setActive(addDays(a, -7))
    else if (key === 'down') setActive(addDays(a, 7))
    else if (key === 'home') setActive(iso(ay, am, 1))
    else if (key === 'end') setActive(iso(ay, am + 1, 0))
    else if (key === 'enter') pick(a)
  }

  // Left/right and page keys are not Popover nav keys (a search field needs them), so the calendar listens itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key]
      const month = { PageUp: -1, PageDown: 1 }[e.key]
      if (step === undefined && month === undefined) return
      e.preventDefault()
      setActive(a => (step !== undefined ? addDays(a, step) : addMonths(a, month!)))
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <Popover anchor={anchor} open onClose={onClose} onKeyNav={onKeyNav} class="cal controls">
      <div role="dialog" aria-label="Vybrat datum">
        <div class="cal-head">
          <IconButton icon={ChevronLeft} title="Předchozí měsíc" onClick={() => setActive(addMonths(active, -1))} />
          <div class="cal-title" aria-live="polite">
            {MONTHS[m]} {y}
          </div>
          <IconButton icon={ChevronRight} title="Následující měsíc" onClick={() => setActive(addMonths(active, 1))} />
        </div>
        <table class="cal-grid" role="grid">
          <thead>
            <tr>
              {WEEKDAYS.map(w => (
                <th role="columnheader" scope="col">
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }, (_, w) => (
              <tr>
                {monthGrid(y, m)
                  .slice(w * 7, w * 7 + 7)
                  .map(day => {
                    const cls = ['cal-day', parts(day).m !== m && 'out', day === active && 'active', day === value && 'sel', day === today && 'today']
                    return (
                      <td>
                        <button
                          type="button"
                          tabIndex={-1}
                          class={cls.filter(Boolean).join(' ')}
                          aria-label={formatCzDate(day)}
                          aria-pressed={day === value}
                          aria-current={day === today ? 'date' : undefined}
                          onClick={() => pick(day)}
                        >
                          {parts(day).d}
                        </button>
                      </td>
                    )
                  })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Popover>
  )
}
