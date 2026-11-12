import type { ComponentChildren } from 'preact'
import { TriangleAlert } from 'lucide-preact'
import { useId } from 'preact/hooks'
import { BANKS, linkBank } from '../domain/banks'
import { isValidIco } from '../domain/ico'

export type PartyForm = { name: string; street: string; city: string; ico: string; dic: string; note: string }
export type PaymentForm = { method: string; bank: string; account: string }

const filled = (s: string) => s.trim() !== ''

/**
 * A labelled control. `changed` outlines it in amber (Uložené údaje: differs from the saved entry).
 * `hint` goes below the label, outside it, in a polite live region with the id `hintId` (for aria-describedby).
 */
export function Field({ label, required, hint, hintId, changed, children }: {
  label: string
  required?: boolean
  hint?: ComponentChildren
  hintId?: string
  changed?: boolean
  children: ComponentChildren
}) {
  return (
    <div class={changed ? 'fld changed' : 'fld'}>
      <label>
        <span class="fld-label">
          {label}
          {required && <span class="fld-req" aria-hidden="true">*</span>}
        </span>
        {children}
      </label>
      {hint !== undefined && <div id={hintId} aria-live="polite">{hint}</div>}
    </div>
  )
}

export function TextField({ label, value, onInput, placeholder, required, hint, changed, list }: {
  label: string
  /** id of a <datalist> with suggestions */
  list?: string
  value: string
  onInput(v: string): void
  placeholder?: string
  required?: boolean
  hint?: ComponentChildren
  changed?: boolean
}) {
  const hintId = useId()
  return (
    <Field label={label} required={required} hint={hint} hintId={hintId} changed={changed}>
      <input
        type="text"
        aria-describedby={hint !== undefined ? hintId : undefined}
        value={value}
        placeholder={placeholder}
        required={required}
        list={list}
        onInput={e => onInput((e.currentTarget as HTMLInputElement).value)}
      />
    </Field>
  )
}

/** "✓ platné IČO" or a warning (never blocks). Nothing while the field is empty. */
export function IcoHint({ ico }: { ico: string }) {
  if (!filled(ico)) return null
  return isValidIco(ico) ? (
    <span class="fld-hint ok">✓ platné IČO</span>
  ) : (
    <span class="fld-hint warn"><TriangleAlert size={14} />IČO nemá platný kontrolní součet</span>
  )
}

export type PartyExamples = { name: string; street: string; city: string; ico: string; dic: string }

/**
 * The fields of a supplier or customer. `examples` are greyed placeholders (onboarding); `required` shows the stars
 * (the caller validates); `changed` holds the names of fields to outline.
 */
export function PartyFields({ value, onChange, supplier, examples, required = true, changed }: {
  value: PartyForm
  onChange(v: PartyForm): void
  supplier: boolean
  examples?: PartyExamples
  required?: boolean
  changed?: ReadonlySet<string>
}) {
  const set = (k: keyof PartyForm) => (v: string) => onChange({ ...value, [k]: v })
  const mark = (k: keyof PartyForm) => changed?.has(k)
  return (
    <>
      <TextField label="Jméno a příjmení / název" required={required} value={value.name} onInput={set('name')} placeholder={examples?.name} changed={mark('name')} />
      <TextField label="Ulice a číslo" required={required} value={value.street} onInput={set('street')} placeholder={examples?.street} changed={mark('street')} />
      <TextField label="PSČ a město" required={required} value={value.city} onInput={set('city')} placeholder={examples?.city} changed={mark('city')} />
      <div class="fld-two">
        <TextField
          label={supplier ? 'IČO' : 'IČO (nepovinné)'}
          required={required && supplier}
          value={value.ico}
          onInput={set('ico')}
          placeholder={examples?.ico}
          hint={<IcoHint ico={value.ico} />}
          changed={mark('ico')}
        />
        <TextField label="DIČ (nepovinné)" value={value.dic} onInput={set('dic')} placeholder={examples?.dic} changed={mark('dic')} />
      </div>
      {supplier && (
        <TextField
          label="Doplňující údaj (nepovinné)"
          value={value.note}
          onInput={set('note')}
          placeholder={examples ? 'Zapsán v živnostenském rejstříku' : undefined}
          changed={mark('note')}
        />
      )}
    </>
  )
}

/**
 * Forma úhrady, Číslo účtu and Banka. The account comes first: a known bank code after "/" fills in the bank name
 * (linkBank); the bank field also suggests the names from the ČNB list.
 */
export function PaymentFields({ value, onChange, required, examples, changed }: {
  value: PaymentForm
  onChange(v: PaymentForm): void
  required?: boolean
  examples?: PaymentForm
  changed?: ReadonlySet<string>
}) {
  const listId = useId()
  const set = (k: keyof PaymentForm) => (v: string) => onChange(linkBank(value, { ...value, [k]: v }))
  return (
    <>
      <TextField label="Forma úhrady" required={required} value={value.method} onInput={set('method')} placeholder={examples?.method} changed={changed?.has('method')} />
      <TextField label="Číslo účtu" required={required} value={value.account} onInput={set('account')} placeholder={examples?.account} changed={changed?.has('account')} />
      <TextField label="Banka" required={required} value={value.bank} onInput={set('bank')} placeholder={examples?.bank} changed={changed?.has('bank')} list={listId} />
      <datalist id={listId}>
        {BANKS.map(b => <option key={b.code} value={b.name} />)}
      </datalist>
    </>
  )
}
