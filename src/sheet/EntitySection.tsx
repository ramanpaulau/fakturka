import type { ComponentChildren, JSX } from 'preact'
import { ChevronDown, RotateCcw } from 'lucide-preact'
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { savedData, updateSavedData } from '../app/state'
import { changedFields, entityLabel, findDuplicate, identityChanged, SAVED_LIST, sectionState, toSnap, type EntityKind } from '../domain/entities'
import { invoice, setSnap, type SectionSnap } from '../editor/editorState'
import { confirmDuplicate, confirmDuplicateEdit } from '../ui/duplicateDialog'
import { toast } from '../ui/Toast'
import { EntityPicker, NEW_LABEL } from './EntityPicker'
import { A4, INNER, LAYOUT, lineMm, type Box } from './layout'
import { ChangedFields } from './sectionContext'

type Entry = { id: string } & Record<string, unknown>
type Fields = Record<string, string>

/** Gap between the section's content and its outline (mm). */
const PAD = 1.5
/** Room left for the section heading next to the tag (mm); the text section has no heading. */
const HEADING_ROOM: Record<EntityKind, number> = { supplier: 18, customer: 18, payment: 30, text: 8 }
const NO_CHANGES: ReadonlySet<string> = new Set()

const mm = (v: number) => `${v}mm`
const fieldsOf = (snap: object): Fields => {
  const { sourceId: _, ...f } = snap as Fields & { sourceId: unknown }
  return f
}
const savedList = (kind: EntityKind): Entry[] => (savedData.value?.[SAVED_LIST[kind]] ?? []) as unknown as Entry[]
const snapOf = <K extends EntityKind>(kind: K): SectionSnap<K> => invoice.value[kind]
const asSnap = <K extends EntityKind>(_kind: K, s: object) => s as SectionSnap<K>

function addEntry(kind: EntityKind, entry: Entry): Promise<boolean> {
  return updateSavedData((d) => ({ ...d, [SAVED_LIST[kind]]: [...d[SAVED_LIST[kind]], entry] }))
}

function replaceEntry(kind: EntityKind, entry: Entry): Promise<boolean> {
  return updateSavedData((d) => ({ ...d, [SAVED_LIST[kind]]: (d[SAVED_LIST[kind]] as { id: string }[]).map((e) => (e.id === entry.id ? entry : e)) }))
}

/** Links the section to `id`, keeping whatever is on the sheet now (the user may have typed while the save ran). */
function relink(kind: EntityKind, id: string) {
  setSnap(kind, asSnap(kind, { ...snapOf(kind), sourceId: id }))
}

/** "Uložit jako nový" / "Uložit do údajů": checks for a duplicate first, then adds a new entry and links it. */
async function saveAsNew(kind: EntityKind) {
  const fields = fieldsOf(snapOf(kind))
  const dup = findDuplicate(kind, fields, savedList(kind))
  if (dup) {
    const choice = await confirmDuplicate(kind, dup)
    if (choice === 'use') {
      const entry = savedList(kind).find((e) => e.id === dup.id)
      if (entry) setSnap(kind, asSnap(kind, toSnap(entry)))
      return
    }
    if (choice !== 'save') return
  }
  const id = crypto.randomUUID()
  // Not written (the error toast already says so): the section stays new / edited.
  if (!(await addEntry(kind, { ...fields, id }))) return
  relink(kind, id)
  toast('Uloženo', 'success')
}

/**
 * "Uložit změny": overwrites the linked entry (same id) with the section's values.
 * Asks first when the edit makes it look like another saved entry.
 */
async function saveChanges(kind: EntityKind) {
  const snap = snapOf(kind)
  const id = snap.sourceId
  if (!id) return
  const fields = fieldsOf(snap)
  const list = savedList(kind)
  const before = list.find((e) => e.id === id)
  if (!before || identityChanged(kind, before, fields)) {
    const dup = findDuplicate(kind, fields, list.filter((e) => e.id !== id))
    if (dup && !(await confirmDuplicateEdit(kind, dup))) return
  }
  if (!(await replaceEntry(kind, { ...fields, id }))) return
  relink(kind, id)
  toast('Uloženo', 'success')
}

/**
 * Bottom of the section's visible text in mm, measured from the fitted paragraphs (they are smaller than their boxes),
 * so the outline hugs the content. null when the sheet has no layout (tests).
 */
function useContentBottom(root: { current: HTMLElement | null }): number | null {
  const [bottom, setBottom] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = root.current
    const sheet = el?.closest<HTMLElement>('.sheet')
    if (!el || !sheet) return
    const measure = () => {
      const pxPerMm = sheet.offsetWidth / A4.w
      if (!pxPerMm) return
      let max = 0
      el.querySelectorAll<HTMLElement>('.fit').forEach((fit) => {
        const last = fit.lastElementChild as HTMLElement | null
        const content = last ? last.offsetTop + last.offsetHeight : 0
        max = Math.max(max, fit.offsetTop + Math.min(content, fit.clientHeight))
      })
      const next = max / pxPerMm
      setBottom((b) => (b !== null && Math.abs(b - next) < 0.05 ? b : next))
    }
    measure()
    // Typing, wrapping, shrinking to fit and late font loads all change the paragraphs' size.
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    el.querySelectorAll('.fit, .fit > .p').forEach((n) => ro.observe(n))
    return () => ro.disconnect()
  })
  return bottom
}

export type EntitySectionProps = {
  kind: EntityKind
  /** The section's area on the paper (mm); the outline, tag and buttons are placed around it. */
  box: Box
  children?: ComponentChildren
}

/**
 * A section of the sheet bound to a saved entry (§5.4): shows whether it matches, was edited or is new, with a tag that
 * opens the picker and the save actions. Everything it adds is an overlay marked `controls`: it never moves the paper's
 * content and is absent from print and PDF.
 */
export function EntitySection({ kind, box, children }: EntitySectionProps) {
  const root = useRef<HTMLDivElement>(null)
  const tagRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const running = useRef(false) // a second click before the re-render disables the buttons
  const bottom = useContentBottom(root)

  const data = savedData.value
  const current = invoice.value[kind]
  const list = savedList(kind)
  const state = sectionState(current, list)
  const changedKey = state === 'edited' ? changedFields(current, list).join(' ') : ''
  const changed = useMemo(() => (changedKey ? new Set(changedKey.split(' ').map((k) => `${kind}.${k}`)) : NO_CHANGES), [kind, changedKey])

  if (!data) return <>{children}</>

  const run = (action: () => Promise<void>) => async () => {
    if (running.current) return
    running.current = true
    setBusy(true)
    try {
      await action()
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const close = (why?: 'blur') => {
    setOpen(false)
    if (why !== 'blur') tagRef.current?.focus()
  }
  const pick = (e: { id: string }) => {
    setSnap(kind, asSnap(kind, toSnap(e)))
    close()
  }
  const startNew = () => {
    const empty = Object.fromEntries(Object.keys(fieldsOf(current)).map((k) => [k, '']))
    setSnap(kind, asSnap(kind, { ...empty, sourceId: null }))
    setOpen(false)
    // After the re-render, start typing in the section's first field.
    setTimeout(() => root.current?.querySelector<HTMLElement>('[data-field]')?.focus(), 0)
  }
  const revert = () => {
    const source = list.find((e) => e.id === current.sourceId)
    if (source) setSnap(kind, asSnap(kind, toSnap(source)))
  }

  const label = entityLabel(kind, current)
  const [head, ...rest] = label.split(' · ')
  const tagText =
    state === 'new' ? (
      NEW_LABEL[kind]
    ) : (
      <>
        {head}
        {rest.length > 0 && <span class="ent-tag-soft"> · {rest.join(' · ')}</span>}
      </>
    )

  const top = box.y - PAD
  const contentBottom = Math.max(bottom ?? box.y + box.h, box.y + (kind === 'text' ? 0 : INNER.headingH) + lineMm(LAYOUT.fontSize.base))
  const outline: JSX.CSSProperties = {
    left: mm(box.x - PAD),
    top: mm(top),
    width: mm(box.w + 2 * PAD),
    height: mm(contentBottom + PAD - top),
  }
  const right = mm(A4.w - (box.x + box.w + PAD) + 2)

  return (
    <div ref={root} class="ent" data-entity={kind} data-state={state} data-open={open ? '' : undefined}>
      <div class="ent-box controls" style={outline} aria-hidden="true" />
      <ChangedFields.Provider value={changed}>{children}</ChangedFields.Provider>
      <button
        ref={tagRef}
        type="button"
        class="ent-tag controls"
        style={{ right, top: mm(top), maxWidth: mm(box.w - HEADING_ROOM[kind]) }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={state === 'new' ? NEW_LABEL[kind] : label}
        onClick={() => setOpen((o) => !o)}
      >
        <span class="ent-tag-text">{tagText}</span>
        {/* outside the ellipsis: a long name may be cut, "upraveno" never is */}
        {state === 'edited' && <span class="ent-tag-state"> · upraveno</span>}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {state !== 'matches' && (
        <div class="ent-actions controls" style={{ right, top: mm(contentBottom + PAD + 1) }}>
          {state === 'edited' ? (
            <>
              <button type="button" class="ent-btn primary" disabled={busy} onClick={run(() => saveChanges(kind))}>
                Uložit změny
              </button>
              <button type="button" class="ent-btn" disabled={busy} onClick={run(() => saveAsNew(kind))}>
                Uložit jako nový
              </button>
              <button type="button" class="ent-btn ghost" disabled={busy} onClick={revert}>
                <RotateCcw size={12} aria-hidden="true" />
                Vrátit
              </button>
            </>
          ) : (
            <button type="button" class="ent-btn primary" disabled={busy} onClick={run(() => saveAsNew(kind))}>
              Uložit do údajů
            </button>
          )}
        </div>
      )}
      {open && <EntityPicker kind={kind} anchor={tagRef} entries={list} linkedId={current.sourceId} onPick={pick} onNew={startNew} onClose={close} />}
    </div>
  )
}
