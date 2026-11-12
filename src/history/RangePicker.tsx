import { CalendarRange, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Popover } from '../ui/Popover'
import { Portal } from '../ui/Portal'
import { formatRange, MONTH_NAMES, monthCount, plural, presetRange, type MonthRange, type Preset } from './historyModel'

const PRESETS: [Preset, string][] = [
  ['all', 'Vše'],
  ['thisYear', 'Tento rok'],
  ['lastYear', 'Minulý rok'],
  ['last6', 'Posledních 6 měsíců'],
  ['last12', 'Posledních 12 měsíců'],
]
const SHORT = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro']

const monthKey = (year: number, i: number) => `${year}-${String(i + 1).padStart(2, '0')}`
const sameRange = (a: MonthRange, b: MonthRange) => (a === null || b === null ? a === b : a.from === b.from && a.to === b.to)
const order = (a: string, b: string): [string, string] => (a <= b ? [a, b] : [b, a])

export type RangePickerProps = {
  value: MonthRange
  /** Issue months 'YYYY-MM' that have an invoice; they get a dot. */
  monthsWithInvoices: Set<string>
  onChange: (r: MonthRange) => void
  /** Invoices in a range, for the footer; without it the footer shows only the months. */
  countInvoices?: (r: MonthRange) => number
  /** The date the presets and the year list are relative to; tests pass a fixed one. */
  today?: Date
}

/** The "Období" field of Historie: opens a popover with presets and a month or year range to pick. */
export function RangePicker({ value, monthsWithInvoices, onChange, countInvoices, today }: RangePickerProps) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLSpanElement>(null)
  return (
    <>
      <span ref={anchor} class="rp-anchor">
        <Button icon={CalendarRange} class="hist-range" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span class="rp-label">Období:</span> {formatRange(value)}
          <ChevronDown size={16} />
        </Button>
      </span>
      {open && (
        <Portal>
          <Panel
            anchor={anchor}
            value={value}
            monthsWithInvoices={monthsWithInvoices}
            countInvoices={countInvoices}
            today={today ?? new Date()}
            onClose={() => setOpen(false)}
            onApply={r => {
              setOpen(false)
              onChange(r)
            }}
          />
        </Portal>
      )}
    </>
  )
}

type PanelProps = {
  anchor: { current: HTMLElement | null }
  value: MonthRange
  monthsWithInvoices: Set<string>
  countInvoices?: (r: MonthRange) => number
  today: Date
  onClose: () => void
  onApply: (r: MonthRange) => void
}

/** Mounted only while open, so every opening starts from the applied range. Esc and an outside click cancel (Popover). */
function Panel({ anchor, value, monthsWithInvoices, countInvoices, today, onClose, onApply }: PanelProps) {
  const [mode, setMode] = useState<'months' | 'years'>('months')
  const [pending, setPending] = useState<MonthRange>(value)
  // The cell ('YYYY-MM' or 'YYYY') of a first click that waits for its second.
  const [start, setStart] = useState<string | null>(null)
  const [viewYear, setViewYear] = useState(Number((value?.to ?? monthKey(today.getFullYear(), 0)).slice(0, 4)))
  const body = useRef<HTMLDivElement>(null)

  // The popover renders at the end of <body>: move focus in, so Tab continues inside it.
  useEffect(() => body.current?.focus(), [])

  const pick = (cell: string) => {
    const unit = (c: string, end: boolean) => (mode === 'years' ? `${c}-${end ? '12' : '01'}` : c)
    if (start === null) {
      setStart(cell)
      setPending({ from: unit(cell, false), to: unit(cell, true) })
    } else {
      const [a, b] = order(start, cell)
      setStart(null)
      setPending({ from: unit(a, false), to: unit(b, true) })
    }
  }
  const switchMode = (m: 'months' | 'years') => {
    setMode(m)
    setStart(null)
  }

  const years = (() => {
    const present = [today.getFullYear(), ...[...monthsWithInvoices].map(m => Number(m.slice(0, 4))), ...(value ? [value.from, value.to].map(m => Number(m.slice(0, 4))) : [])]
    const [lo, hi] = [Math.min(...present) - 1, Math.max(...present) + 1]
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
  })()

  // Cell state against the pending range; `key` is 'YYYY-MM' (months) or the year (years).
  const bounds = pending && (mode === 'years' ? [pending.from.slice(0, 4), pending.to.slice(0, 4)] : [pending.from, pending.to])
  const cellClass = (key: string) => {
    const s = bounds !== null && key === bounds[0]
    const e = bounds !== null && key === bounds[1]
    const inside = bounds !== null && key > bounds[0] && key < bounds[1]
    return ['rp-cell', s && 's', e && 'e', (inside || s || e) && 'in'].filter(Boolean).join(' ')
  }
  const cell = (key: string, text: string, dot: boolean, title?: string) => (
    <button type="button" class={cellClass(key)} title={title} aria-pressed={bounds !== null && key >= bounds[0] && key <= bounds[1]} onClick={() => pick(key)}>
      <b>{text}</b>
      {dot && <span class="rp-dot" aria-hidden="true" />}
    </button>
  )

  const invoiceCount = countInvoices?.(pending)
  const parts = [
    pending && plural(monthCount(pending), 'měsíc', 'měsíce', 'měsíců'),
    invoiceCount !== undefined && plural(invoiceCount, 'faktura', 'faktury', 'faktur'),
  ].filter(Boolean)

  return (
    <Popover anchor={anchor} open onClose={onClose} class="rp controls">
      <div ref={body} class="rp-body" role="dialog" aria-label="Vybrat období" tabIndex={-1}>
        <div class="rp-presets">
          {PRESETS.map(([p, label]) => {
            const range = presetRange(p, today)
            return (
              <button
                type="button"
                class={sameRange(pending, range) ? 'rp-preset on' : 'rp-preset'}
                aria-pressed={sameRange(pending, range)}
                onClick={() => {
                  setPending(range)
                  setStart(null)
                  if (range) setViewYear(Number(range.to.slice(0, 4)))
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
        <div class="rp-cal">
          <div class="rp-seg">
            {(['months', 'years'] as const).map(m => (
              <button type="button" class={mode === m ? 'on' : ''} aria-pressed={mode === m} onClick={() => switchMode(m)}>
                {m === 'months' ? 'Měsíce' : 'Roky'}
              </button>
            ))}
          </div>
          {mode === 'months' ? (
            <>
              <div class="rp-nav">
                <IconButton icon={ChevronLeft} title="Předchozí rok" onClick={() => setViewYear(viewYear - 1)} />
                <span class="rp-year" aria-live="polite">{viewYear}</span>
                <IconButton icon={ChevronRight} title="Následující rok" onClick={() => setViewYear(viewYear + 1)} />
              </div>
              <div class="rp-grid">
                {SHORT.map((name, i) => cell(monthKey(viewYear, i), name, monthsWithInvoices.has(monthKey(viewYear, i)), `${MONTH_NAMES[i]} ${viewYear}`))}
              </div>
            </>
          ) : (
            <div class="rp-grid">
              {years.map(y => cell(String(y), String(y), [...monthsWithInvoices].some(m => m.startsWith(`${y}-`))))}
            </div>
          )}
          <div class="rp-foot">
            <span>{parts.length > 0 ? parts.join(' · ') : 'Všechna období'}</span>
            <Button variant="primary" onClick={() => onApply(pending)}>Použít</Button>
          </div>
        </div>
      </div>
    </Popover>
  )
}
