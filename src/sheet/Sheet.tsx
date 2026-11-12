import type { ComponentChildren, JSX } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import { TriangleAlert } from 'lucide-preact'
import type { EntityKind } from '../domain/entities'
import { isValidIco } from '../domain/ico'
import type { Invoice } from '../domain/types'
import { shrinkToFit } from '../pdf/wrap'
import { sheetContent, type FieldPath, type RowKey, type SheetPara } from './content'
import { DateField, Editable } from './editable'
import { EntitySection } from './EntitySection'
import { A4, INNER, LAYOUT, baselineMm, belowHeading, lineMm, rowTop, type Box } from './layout'
import './sheet.css'

/** What the sheet calls back while editing. It knows nothing about where the invoice lives. */
export type SheetEditApi = {
  setField: (path: FieldPath, value: string) => void
  /** raw text as typed in "Cena celkem" */
  setAmount: (raw: string) => void
  setDate: (which: 'issueDate' | 'dueDate', iso: string) => void
  /** show "Faktura s tímto číslem už existuje." */
  numberTaken: boolean
}

export type SheetProps = { invoice: Invoice; mode: 'static' } | { invoice: Invoice; mode: 'edit'; edit: SheetEditApi }

const WHO = { supplier: 'Dodavatel', customer: 'Odběratel' } as const
const PARTY_FIELD = { name: 'Název', street: 'Ulice', city: 'PSČ a město', ico: 'IČO', dic: 'DIČ', note: 'Doplňující řádek' } as const
/** Accessible name and empty-field hint (screen only) for each editable field. */
function fieldMeta(path: FieldPath | 'amount'): { label: string; placeholder: string } {
  const [a, b] = path.split('.') as [string, string | undefined]
  if (b && (a === 'supplier' || a === 'customer')) {
    const name = PARTY_FIELD[b as keyof typeof PARTY_FIELD]
    return { label: `${WHO[a]}: ${name}`, placeholder: b === 'note' ? 'Doplňující řádek (nepovinné)' : name }
  }
  const fixed: Record<string, string> = {
    number: 'Číslo faktury',
    'payment.method': 'Forma úhrady',
    'payment.bank': 'Bankovní spojení',
    'payment.account': 'Číslo účtu',
    'text.text': 'Text faktury',
    amount: 'Cena celkem',
  }
  return { label: fixed[path], placeholder: path === 'number' ? 'Číslo' : path === 'amount' ? 'Částka' : fixed[path] }
}

const mm = (v: number) => `${v}mm`
const pos = (b: Box): JSX.CSSProperties => ({ left: mm(b.x), top: mm(b.y), width: mm(b.w), height: mm(b.h) })

/**
 * A box whose paragraphs wrap and shrink by the same rule as the PDF (see `fitElement`).
 * `render` replaces a paragraph's text in edit mode; `optional` paragraphs are editor-only (`controls`).
 */
function Fit(props: { box: Box; base: number; paras: SheetPara[]; class?: string; row?: string; render?: (p: SheetPara) => ComponentChildren }) {
  return (
    <div class={`fit ${props.class ?? ''}`} data-base={props.base} data-h={props.box.h} data-row={props.row} style={{ ...pos(props.box), '--fs': `${props.base}pt` }}>
      {props.paras.map((p, i) => (
        <div key={p.field ?? i} class={['p', p.bold && 'b', p.optional && 'controls'].filter(Boolean).join(' ')}>
          {props.render ? props.render(p) : p.text}
        </div>
      ))}
    </div>
  )
}

/** Shrinks a `.fit` element in 0.5 pt steps (min 7 pt) until its content no longer overflows; clamps whole lines at the minimum. */
function fitElement(el: HTMLElement) {
  const base = Number(el.dataset.base)
  const h = Number(el.dataset.h)
  el.style.height = mm(h)
  const set = (size: number) => el.style.setProperty('--fs', `${size}pt`)
  const size = shrinkToFit(base, (s) => {
    set(s)
    return el.scrollHeight <= el.clientHeight + 0.5
  })
  set(size)
  if (el.scrollHeight > el.clientHeight + 0.5) {
    el.style.height = mm(Math.max(1, Math.floor((h + 1e-9) / lineMm(size))) * lineMm(size))
  }
}

export function Sheet(props: SheetProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const inv = props.invoice
  const edit = props.mode === 'edit' ? props.edit : null
  const c = sheetContent(inv, { edit: edit !== null })
  const L = LAYOUT
  const { base, title, label } = L.fontSize

  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const run = () => root.querySelectorAll<HTMLElement>('.fit').forEach(fitElement)
    run()
    let alive = true
    document.fonts?.ready.then(() => alive && run())
    return () => {
      alive = false
    }
  })

  const field = (path: FieldPath, value: string) => (
    <Editable
      field={path}
      value={value}
      {...fieldMeta(path)}
      invalid={path.endsWith('.ico') && value.trim() !== '' && !isValidIco(value) ? 'Neplatné IČO' : undefined}
      onCommit={(v) => edit!.setField(path, v)}
    />
  )
  /** A paragraph in edit mode: its label prefix stays plain text, the value is editable. */
  const editPara = (p: SheetPara) => (p.field ? <>{p.prefix}{field(p.field, p.prefix ? p.text.slice(p.prefix.length) : p.text)}</> : p.text)
  const rowValue = (key: RowKey, value: string): ComponentChildren => {
    if (!edit) return value
    if (key === 'vs') return <span data-mirror="number">{value}</span>
    if (key === 'issueDate' || key === 'dueDate') {
      return (
        <>
          <DateField
            label={key === 'issueDate' ? 'Datum vystavení' : 'Datum splatnosti'}
            value={inv[key]}
            text={value}
            onSelect={(iso) => edit.setDate(key, iso)}
          />
        </>
      )
    }
    return field(key, value)
  }
  /** In edit mode a section bound to a saved entry gets its tag, outline and save actions (all overlays). */
  const section = (kind: EntityKind, box: Box, content: ComponentChildren) =>
    edit ? (
      <EntitySection kind={kind} box={box}>
        {content}
      </EntitySection>
    ) : (
      content
    )
  const rows = (box: Box, list: typeof c.payment, col: number) =>
    list.map(([k, v, key], i) => (
      <>
        <div class="abs" style={{ left: mm(box.x), top: mm(rowTop(box, i)) }}>
          {k}
        </div>
        <Fit
          box={{ x: box.x + col, y: rowTop(box, i), w: box.w - col, h: lineMm(base) }}
          base={base}
          paras={[{ text: v }]}
          row={edit ? key : undefined}
          render={edit ? () => rowValue(key, v) : undefined}
        />
      </>
    ))
  const amountText = c.total
  const textValue = edit ? (
    <>
      {field('text.text', inv.text.text)}
      {inv.text.text && amountText ? ' ' : ''}
      {amountText && <span data-mirror="amount">{amountText}</span>}
    </>
  ) : null

  const ft = L.footer
  const footerBaseline = ft.y + INNER.footerRowTop + baselineMm(INNER.totalSize)
  const h = L.header

  return (
    <div class="sheet" data-mode={props.mode} ref={ref} style={{ width: mm(A4.w), height: mm(A4.h), fontSize: `${base}pt`, lineHeight: L.lineHeight }}>
      {INNER.rules.map((y) => (
        <div class="rule" style={{ top: `calc(${y}mm - ${INNER.ruleWidth / 2}pt)`, left: mm(L.margin), width: mm(A4.w - 2 * L.margin), borderTopWidth: `${INNER.ruleWidth}pt` }} />
      ))}

      <div class="abs b" style={{ left: mm(h.x), top: mm(h.y), fontSize: `${title}pt` }}>
        {c.title}
      </div>
      <div class="abs right" style={{ right: mm(A4.w - h.x - h.w), top: mm(h.y + baselineMm(title) - baselineMm(INNER.numberSize)), fontSize: `${INNER.numberSize}pt` }}>
        {c.numberLabel}
        <b>{edit ? field('number', c.number) : c.number}</b>
      </div>
      {edit?.numberTaken && (
        <div class="sheet-warn controls" role="status" style={{ right: mm(A4.w - h.x - h.w), top: mm(h.y + h.h - 3) }}>
          <TriangleAlert size={12} aria-hidden="true" />
          Faktura s tímto číslem už existuje.
        </div>
      )}

      {(
        [
          [L.supplier, c.supplierLabel, c.supplier, 'supplier'],
          [L.customer, c.customerLabel, c.customer, 'customer'],
        ] as const
      ).map(([box, heading, paras, cls]) =>
        section(
          cls,
          box,
          <>
            <div class="abs b" style={{ left: mm(box.x), top: mm(box.y), fontSize: `${label}pt` }}>
              {heading}
            </div>
            <Fit box={belowHeading(box)} base={base} paras={paras} class={cls} render={edit ? editPara : undefined} />
          </>,
        ),
      )}

      {section(
        'payment',
        L.payment,
        <>
          <div class="abs b" style={{ left: mm(L.payment.x), top: mm(L.payment.y), fontSize: `${label}pt` }}>
            {c.paymentLabel}
          </div>
          {rows(L.payment, c.payment, INNER.labelCol.payment)}
        </>,
      )}
      {rows(L.dates, c.dates, INNER.labelCol.dates)}

      {section('text', L.text, <Fit box={L.text} base={base} paras={[{ text: c.text }]} class="text" render={edit ? () => textValue : undefined} />)}

      <div class="abs" style={{ left: mm(ft.x), top: mm(footerBaseline - baselineMm(base)) }}>
        {c.vatNote}
      </div>
      <div class="abs right" style={{ right: mm(A4.w - ft.x - ft.w), top: mm(footerBaseline - baselineMm(INNER.totalSize)), fontSize: `${INNER.totalSize}pt` }}>
        {c.totalLabel}
        <b>
          {edit ? (
            <Editable
              field="amount"
              value={c.total}
              editValue={inv.amount === null ? '' : String(inv.amount)}
              {...fieldMeta('amount')}
              onCommit={edit.setAmount}
            />
          ) : (
            c.total
          )}
        </b>
      </div>

      {c.signLabels.map((txt, i) => {
        const s = INNER.sign
        const x = i === 0 ? s.left : s.right
        return (
          <>
            <div class="rule" style={{ top: `calc(${s.lineY}mm - ${INNER.ruleWidth / 2}pt)`, left: mm(x), width: mm(s.w), borderTopWidth: `${INNER.ruleWidth}pt` }} />
            <div class="abs center" style={{ left: mm(x), width: mm(s.w), top: mm(s.lineY + s.labelGap), fontSize: `${label}pt` }}>
              {txt}
            </div>
          </>
        )
      })}
    </div>
  )
}
