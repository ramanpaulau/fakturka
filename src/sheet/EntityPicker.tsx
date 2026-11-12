import { Check, Search } from 'lucide-preact'
import { useId, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { entityLabel, entitySubtitle, matchesQuery, type EntityKind } from '../domain/entities'
import { Popover, type PopoverNavKey } from '../ui/Popover'
import { Portal } from '../ui/Portal'

type Entry = { id: string }

export const PICKER_PLACEHOLDER: Record<EntityKind, string> = {
  supplier: 'Hledat podle názvu, IČO nebo města…',
  customer: 'Hledat podle názvu, IČO nebo města…',
  payment: 'Hledat podle účtu nebo banky…',
  text: 'Hledat v textech…',
}

export const NEW_LABEL: Record<EntityKind, string> = {
  supplier: '＋ Nový dodavatel',
  customer: '＋ Nový odběratel',
  payment: '＋ Nový platební údaj',
  text: '＋ Nový text',
}

const LIST_LABEL: Record<EntityKind, string> = {
  supplier: 'Uložení dodavatelé',
  customer: 'Uložení odběratelé',
  payment: 'Uložené platební údaje',
  text: 'Uložené texty',
}

/** Bold first line of a row: the name, the payment method, or the start of the text. */
export function rowName(kind: EntityKind, e: Entry): string {
  const f = e as unknown as Record<string, string>
  const name = kind === 'payment' ? f.method : kind === 'text' ? entityLabel(kind, e) : f.name
  return name?.trim() || entityLabel(kind, e) || '(bez názvu)'
}

export type EntityPickerProps = {
  kind: EntityKind
  anchor: { current: HTMLElement | null }
  entries: Entry[]
  /** id of the entry the section is linked to (gets the check mark) */
  linkedId: string | null
  onPick: (e: Entry) => void
  onNew: () => void
  /** 'blur' = focus moved to another control (leave it there); otherwise Esc or an outside click. */
  onClose: (why?: 'blur') => void
}

/** Searchable list of the saved entries of one kind, plus "＋ Nový …". Rendered into <body>, outside the paper. */
export function EntityPicker(props: EntityPickerProps) {
  return (
    <Portal>
      <PickerPanel {...props} />
    </Portal>
  )
}

function PickerPanel({ kind, anchor, entries, linkedId, onPick, onNew, onClose }: EntityPickerProps) {
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const id = useId()
  const [query, setQuery] = useState('')
  const rows = entries.filter((e) => matchesQuery(kind, e, query))
  const [active, setActive] = useState(() => Math.max(0, rows.findIndex((e) => e.id === linkedId)))
  // The footer ("＋ Nový …") is the last keyboard stop, after the rows.
  const count = rows.length + 1
  const current = Math.min(active, count - 1)
  const optionId = (i: number) => `${id}-o${i}`

  useLayoutEffect(() => input.current?.focus(), [])
  useLayoutEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [current])

  const choose = (i: number) => (i < rows.length ? onPick(rows[i]) : onNew())
  const onKeyNav = (key: PopoverNavKey) => {
    if (key === 'down') setActive((current + 1) % count)
    else if (key === 'up') setActive((current - 1 + count) % count)
    else if (key === 'enter') choose(current)
  }
  // Rows and footer never take focus, so the search field keeps it and typing keeps filtering.
  const keepFocus = (e: MouseEvent) => e.preventDefault()

  return (
    <Popover anchor={anchor} open onClose={() => onClose()} onKeyNav={onKeyNav} navKeys={['up', 'down', 'enter']} class="ent-picker controls">
      <label class="ent-search">
        <Search size={14} aria-hidden="true" />
        <input
          ref={input}
          type="search"
          value={query}
          placeholder={PICKER_PLACEHOLDER[kind]}
          aria-label={PICKER_PLACEHOLDER[kind]}
          aria-controls={`${id}-list`}
          aria-activedescendant={optionId(current)}
          autocomplete="off"
          spellcheck={false}
          onInput={(e) => {
            setQuery((e.currentTarget as HTMLInputElement).value)
            setActive(0)
          }}
          onBlur={(e) => {
            // Focus went to another control: close, so the popover's document key listener stops capturing keys.
            const to = e.relatedTarget as Node | null
            const panel = input.current?.closest('.popover')
            if (to && !panel?.contains(to)) onClose('blur')
          }}
        />
      </label>
      <div ref={list} id={`${id}-list`} class="ent-list" role="listbox" aria-label={LIST_LABEL[kind]}>
        {rows.map((e, i) => {
          const sub = entitySubtitle(kind, e)
          const linked = e.id === linkedId
          return (
            <div
              key={e.id}
              id={optionId(i)}
              data-index={i}
              role="option"
              aria-selected={i === current}
              data-linked={linked ? '' : undefined}
              class={['ent-row', i === current && 'active'].filter(Boolean).join(' ')}
              onMouseDown={keepFocus}
              onMouseMove={() => i !== current && setActive(i)}
              onClick={() => onPick(e)}
            >
              <div class="ent-row-text">
                <div class="ent-row-name">{rowName(kind, e)}</div>
                {sub && <div class="ent-row-sub">{sub}</div>}
              </div>
              {linked && <Check size={14} class="ent-row-check" aria-label="Vybráno" />}
            </div>
          )
        })}
        {rows.length === 0 && <div class="ent-empty">{entries.length === 0 ? 'Zatím nic uloženého' : 'Nic nenalezeno'}</div>}
      </div>
      <div
        id={optionId(rows.length)}
        data-index={rows.length}
        role="button"
        class={['ent-new', current === rows.length && 'active'].filter(Boolean).join(' ')}
        onMouseDown={keepFocus}
        onMouseMove={() => current !== rows.length && setActive(rows.length)}
        onClick={onNew}
      >
        {NEW_LABEL[kind]}
      </div>
    </Popover>
  )
}
