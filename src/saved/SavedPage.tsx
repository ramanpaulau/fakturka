import { Info, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { savedData, updateSavedData } from '../app/state'
import { changedFields, matchesQuery, SAVED_LIST, entitySubtitle, entityLabel, findDuplicate, identityChanged, type EntityKind } from '../domain/entities'
import type { InvoiceRecord, Snap } from '../domain/types'
import { rowName } from '../sheet/EntityPicker'
import { getBackend } from '../storage/backend'
import { listInvoices, resolveInvoiceDir } from '../storage/invoiceStore'
import { Button } from '../ui/Button'
import { confirmDialog } from '../ui/Dialog'
import { confirmDuplicate, confirmDuplicateEdit } from '../ui/duplicateDialog'
import { Field, PartyFields, PaymentFields, type PartyForm, type PaymentForm } from '../ui/Fields'
import { IconButton } from '../ui/IconButton'
import { Popover } from '../ui/Popover'
import { toast } from '../ui/Toast'

type Entry = { id: string } & Record<string, unknown>
type Draft = Record<string, string>
/** `id: null` is an entry being added. */
type Sel = { id: string | null }

const KINDS: EntityKind[] = ['supplier', 'customer', 'payment', 'text']
const TAB_LABEL: Record<EntityKind, string> = { supplier: 'Dodavatelé', customer: 'Odběratelé', payment: 'Platební údaje', text: 'Texty' }
const ADD_LABEL: Record<EntityKind, string> = { supplier: 'Přidat dodavatele', customer: 'Přidat odběratele', payment: 'Přidat platební údaj', text: 'Přidat text' }
const ONE_LABEL: Record<EntityKind, string> = { supplier: 'Dodavatel', customer: 'Odběratel', payment: 'Platební údaj', text: 'Text' }
const NEW_LABEL: Record<EntityKind, string> = { supplier: 'Nový dodavatel', customer: 'Nový odběratel', payment: 'Nový platební údaj', text: 'Nový text' }
const SEARCH_PLACEHOLDER: Record<EntityKind, string> = {
  supplier: 'Hledat název, IČO, město…',
  customer: 'Hledat název, IČO, město…',
  payment: 'Hledat účet, banku…',
  text: 'Hledat v textech…',
}
const EMPTY_LIST: Record<EntityKind, string> = {
  supplier: 'Zatím tu nejsou žádní dodavatelé.',
  customer: 'Zatím tu nejsou žádní odběratelé.',
  payment: 'Zatím tu nejsou žádné platební údaje.',
  text: 'Zatím tu nejsou žádné texty.',
}
const FIELDS: Record<EntityKind, string[]> = {
  supplier: ['name', 'street', 'city', 'ico', 'dic', 'note'],
  customer: ['name', 'street', 'city', 'ico', 'dic', 'note'],
  payment: ['method', 'bank', 'account'],
  text: ['text'],
}
/** The field whose content makes an entry worth saving. */
const REQUIRED: Record<EntityKind, string> = { supplier: 'name', customer: 'name', payment: 'account', text: 'text' }
const LAST_SUPPLIER = 'Musí zůstat alespoň jeden dodavatel'

const isParty = (kind: EntityKind) => kind === 'supplier' || kind === 'customer'

/** How many saved invoices use each entry: counts every snapshot's `sourceId` (supplier, customer, payment and text). */
export function usageCounts(recs: InvoiceRecord[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const r of recs) {
    if (r.kind !== 'invoice') continue
    const { supplier, customer, payment, text } = r.invoice
    for (const { sourceId } of [supplier, customer, payment, text]) {
      if (sourceId !== null) counts.set(sourceId, (counts.get(sourceId) ?? 0) + 1)
    }
  }
  return counts
}

/** "na 1 faktuře" / "na 2 fakturách" (the locative of 2-4 and 5+ is the same). */
const usageText = (n: number) => (n === 0 ? 'nepoužito' : `na ${n === 1 ? '1 faktuře' : `${n} fakturách`}`)

const draftOf = (kind: EntityKind, entry?: Entry): Draft =>
  Object.fromEntries(FIELDS[kind].map(k => [k, typeof entry?.[k] === 'string' ? (entry[k] as string) : '']))
const trimmedDraft = (d: Draft): Draft => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.trim()]))

function rowSub(kind: EntityKind, e: Entry): string {
  if (!isParty(kind)) return entitySubtitle(kind, e)
  return [e.street, e.city].map(v => (typeof v === 'string' ? v.trim() : '')).filter(v => v !== '').join(', ')
}

/** IČO / DIČ column of a party row. */
function rowIds(e: Entry): string {
  const part = (label: string, v: unknown) => (typeof v === 'string' && v.trim() ? `${label} ${v.trim()}` : '')
  return [part('IČO', e.ico), part('DIČ', e.dic)].filter(p => p !== '').join(' · ')
}

function Row({ kind, entry, selected, usage, canDelete, onOpen, onDelete }: {
  kind: EntityKind
  entry: Entry
  selected: boolean
  usage: number | null
  canDelete: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  const [menu, setMenu] = useState(false)
  const moreRef = useRef<HTMLSpanElement>(null)
  const pick = (fn: () => void) => () => {
    setMenu(false)
    fn()
  }
  return (
    <div class={['sv-row', selected && 'sel', menu && 'menu-open'].filter(Boolean).join(' ')}>
      <button type="button" class={isParty(kind) ? 'sv-open' : 'sv-open plain'} onClick={onOpen}>
        <span class="sv-text">
          <span class="sv-name">{rowName(kind, entry)}</span>
          <span class="sv-sub">{rowSub(kind, entry)}</span>
        </span>
        {isParty(kind) && <span class="sv-ids">{rowIds(entry)}</span>}
        <span class="sv-use">{usage === null ? '' : usageText(usage)}</span>
      </button>
      <span ref={moreRef} class="sv-more">
        <IconButton icon={MoreHorizontal} title="Další akce" active={menu} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
      </span>
      <Popover anchor={moreRef} open={menu} onClose={() => setMenu(false)} align="end" class="sv-menu">
        <div role="menu">
          <button type="button" role="menuitem" class="menu-item" onClick={pick(onOpen)}>
            <Pencil size={16} />
            Upravit
          </button>
          <hr />
          <button type="button" role="menuitem" class="menu-item danger" disabled={!canDelete} title={canDelete ? undefined : LAST_SUPPLIER} onClick={pick(onDelete)}>
            <Trash2 size={16} />
            Smazat…
          </button>
        </div>
      </Popover>
    </div>
  )
}

function DetailPanel({ kind, entry, draft, changed, usage, busy, canSave, canDelete, onChange, onSave, onCancel, onDelete }: {
  kind: EntityKind
  /** The saved entry; undefined while adding. */
  entry: Entry | undefined
  draft: Draft
  changed: ReadonlySet<string>
  usage: number | null
  busy: boolean
  canSave: boolean
  canDelete: boolean
  onChange: (d: Draft) => void
  onSave: () => void
  onCancel: () => void
  onDelete: () => void
}) {
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    form.current?.querySelector<HTMLElement>('input, textarea')?.focus()
  }, [entry?.id])

  const set = (k: string) => (v: string) => onChange({ ...draft, [k]: v })
  const hint = entry ? [ONE_LABEL[kind], usage === null ? '' : usageText(usage)].filter(h => h !== '').join(' · ') : ONE_LABEL[kind]
  return (
    <aside class="sv-panel" aria-label="Detail">
      <h3>{entry ? rowName(kind, entry) : NEW_LABEL[kind]}</h3>
      <div class="sv-hint">{hint}</div>
      <form
        ref={form}
        noValidate
        onSubmit={e => {
          e.preventDefault()
          if (canSave) onSave()
        }}
      >
        {isParty(kind) && <PartyFields value={draft as PartyForm} onChange={v => onChange({ ...draft, ...v })} supplier={kind === 'supplier'} required={false} changed={changed} />}
        {kind === 'payment' && <PaymentFields value={draft as PaymentForm} onChange={v => onChange({ ...draft, ...v })} changed={changed} />}
        {kind === 'text' && (
          <Field label="Text" changed={changed.has('text')}>
            <textarea rows={5} value={draft.text} onInput={e => set('text')(e.currentTarget.value)} />
          </Field>
        )}
        <div class="sv-note">
          <Info size={16} />
          <span>Změna se projeví jen na nových fakturách. Uložené faktury zůstanou beze změny.</span>
        </div>
        <div class="sv-acts">
          <Button variant="primary" type="submit" disabled={!canSave || busy}>Uložit</Button>
          <Button onClick={onCancel} disabled={busy}>Zrušit</Button>
          <span class="sp" />
          {entry && (
            <Button variant="ghost" class="sv-del" icon={Trash2} disabled={!canDelete || busy} title={canDelete ? undefined : LAST_SUPPLIER} onClick={onDelete}>
              Smazat
            </Button>
          )}
        </div>
      </form>
    </aside>
  )
}

/** The Uložené údaje tab: suppliers, customers, payment details and texts that the editor's pickers offer. */
export function SavedPage() {
  const data = savedData.value
  const [kind, setKind] = useState<EntityKind>('supplier')
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState<Sel | null>(null)
  const [draft, setDraft] = useState<Draft>({})
  const [busy, setBusy] = useState(false)
  const [usage, setUsage] = useState<Map<string, number> | null>(null)
  const running = useRef(false)

  useEffect(() => {
    let alive = true
    const d = savedData.peek()
    if (!d) return
    const b = getBackend()
    resolveInvoiceDir(b, d)
      .then(dir => listInvoices(b, dir))
      .then(recs => { if (alive) setUsage(usageCounts(recs)) })
      .catch(() => {}) // without a count the rows just show none
    return () => { alive = false }
  }, [])

  if (!data) return null

  const list = data[SAVED_LIST[kind]] as unknown as Entry[]
  const entry = sel?.id != null ? list.find(e => e.id === sel.id) : undefined
  const base = draftOf(kind, entry)
  const dirty = sel !== null && FIELDS[kind].some(k => draft[k]?.trim() !== base[k].trim())
  const changed: ReadonlySet<string> = new Set(
    entry ? (changedFields({ ...draft, sourceId: entry.id } as unknown as Snap<{ id: string }>, list) as string[]) : [],
  )
  const canDelete = kind !== 'supplier' || list.length > 1
  const count = (id: string) => (usage ? (usage.get(id) ?? 0) : null)

  const open = (next: Sel | null, nextKind: EntityKind = kind) => {
    setKind(nextKind)
    setSel(next)
    // Read fresh: a save may just have added the entry.
    const fresh = savedData.peek()
    const e = next?.id != null ? (fresh?.[SAVED_LIST[nextKind]] as unknown as Entry[] | undefined)?.find(x => x.id === next.id) : undefined
    setDraft(draftOf(nextKind, e))
  }

  /** Runs `fn` now, or after asking when an unsaved edit would be thrown away. */
  const unlessDirty = (fn: () => void) => {
    if (!dirty) return fn()
    void confirmDialog({ title: 'Zahodit změny?', body: 'Neuložené změny v panelu se ztratí.', confirm: 'Zahodit', danger: true }).then(ok => ok && fn())
  }

  const switchKind = (next: EntityKind) => {
    if (next === kind) return
    unlessDirty(() => {
      setQuery('')
      open(null, next)
    })
  }
  const select = (id: string | null) => {
    if (sel && sel.id === id) return
    unlessDirty(() => open({ id }))
  }

  const withBusy = async (fn: () => Promise<void>) => {
    if (running.current) return
    running.current = true
    setBusy(true)
    try {
      await fn()
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  const save = () => withBusy(async () => {
    if (!sel) return
    const fields = trimmedDraft(draft)
    const key = SAVED_LIST[kind]
    if (sel.id !== null) {
      const id = sel.id
      const before = list.find(e => e.id === id)
      if (!before || identityChanged(kind, before, fields)) {
        const dup = findDuplicate(kind, fields, list.filter(e => e.id !== id))
        if (dup && !(await confirmDuplicateEdit(kind, dup))) return
      }
      // Not written (the error toast already says so): the panel stays as the user left it.
      if (!(await updateSavedData(d => ({ ...d, [key]: (d[key] as { id: string }[]).map(e => (e.id === id ? { ...fields, id } : e)) })))) return
      setDraft(fields)
      toast('Uloženo', 'success')
      return
    }
    const dup = findDuplicate(kind, fields, list)
    if (dup) {
      const choice = await confirmDuplicate(kind, dup)
      if (choice === 'use') return open({ id: dup.id })
      if (choice !== 'save') return
    }
    const id = crypto.randomUUID()
    if (!(await updateSavedData(d => ({ ...d, [key]: [...d[key], { ...fields, id }] })))) return
    open({ id })
    toast('Uloženo', 'success')
  })

  const remove = (target: Entry) => withBusy(async () => {
    const key = SAVED_LIST[kind]
    const ok = await confirmDialog({
      title: `Smazat ${entityLabel(kind, target)}?`,
      body: 'Uložené faktury se nezmění.',
      confirm: 'Smazat',
      danger: true,
    })
    if (!ok) return
    let lastSupplier = false
    const written = await updateSavedData(d => {
      const rest = (d[key] as { id: string }[]).filter(e => e.id !== target.id)
      // The data may have changed while the dialog was open: never remove the last supplier.
      if (kind === 'supplier' && rest.length === 0) {
        lastSupplier = true
        return d
      }
      return { ...d, [key]: rest }
    })
    if (lastSupplier) {
      toast(LAST_SUPPLIER, 'error')
      return
    }
    if (!written) return
    if (sel?.id === target.id) open(null)
    toast('Smazáno', 'success')
  })

  const rows = list.filter(e => matchesQuery(kind, e, query))
  return (
    <div class="saved">
      <div class="sv-main">
        <div class="sv-seg" role="tablist" aria-label="Druh údajů">
          {KINDS.map(k => (
            <button key={k} type="button" role="tab" aria-selected={k === kind} class={k === kind ? 'on' : ''} onClick={() => switchKind(k)}>
              {TAB_LABEL[k]} <span class="sv-count">{(data[SAVED_LIST[k]] as unknown[]).length}</span>
            </button>
          ))}
        </div>
        <div class="sv-bar">
          <label class="hist-search">
            <Search size={16} />
            <input type="search" value={query} placeholder={SEARCH_PLACEHOLDER[kind]} aria-label="Hledat" onInput={e => setQuery(e.currentTarget.value)} />
          </label>
          <span class="sp" />
          <Button icon={Plus} onClick={() => select(null)}>{ADD_LABEL[kind]}</Button>
        </div>
        {rows.length === 0 ? (
          <div class="hist-empty">{list.length === 0 ? EMPTY_LIST[kind] : 'Nic nenalezeno.'}</div>
        ) : (
          <div class="sv-list">
            {rows.map(e => (
              <Row
                key={e.id}
                kind={kind}
                entry={e}
                selected={sel?.id === e.id}
                usage={count(e.id)}
                canDelete={canDelete}
                onOpen={() => select(e.id)}
                onDelete={() => void remove(e)}
              />
            ))}
          </div>
        )}
      </div>
      {sel && (sel.id === null || entry) && (
        <DetailPanel
          key={`${kind}:${sel.id ?? 'new'}`}
          kind={kind}
          entry={entry}
          draft={draft}
          changed={changed}
          usage={entry ? count(entry.id) : null}
          busy={busy}
          canSave={dirty && draft[REQUIRED[kind]]?.trim() !== ''}
          canDelete={canDelete}
          onChange={setDraft}
          onSave={() => void save()}
          onCancel={() => open(null)}
          onDelete={() => entry && void remove(entry)}
        />
      )}
    </div>
  )
}
