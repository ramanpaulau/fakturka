import { useEffect, useRef, useState } from 'preact/hooks'
import { FileText, RotateCcw } from 'lucide-preact'
import { savedData } from '../app/state'
import type { Party, SavedData } from '../domain/types'
import { getBackend } from '../storage/backend'
import { emptySavedData, saveSavedData } from '../storage/dataStore'
import { Button } from '../ui/Button'
import { PartyFields, PaymentFields, type PartyForm, type PaymentForm } from '../ui/Fields'
import { importFromZip } from '../transfer/transfer'
import { toast } from '../ui/Toast'

type Step = 0 | 1 | 2 | 3 // 0 = welcome, 1..3 = wizard

const EMPTY_PARTY: PartyForm = { name: '', street: '', city: '', ico: '', dic: '', note: '' }
const filled = (s: string) => s.trim() !== ''

const SUPPLIER_EXAMPLES = { name: 'Jan Novák', street: 'Dlouhá 12', city: '110 00 Praha', ico: '12345679', dic: 'CZ12345679' }
const PAYMENT_EXAMPLES: PaymentForm = { method: 'Bankovním převodem', account: '123456789/0100', bank: 'Komerční banka' }
/** Saved as the first invoice text so a new invoice starts with an example (editable in Uložené údaje); from the original app. */
export const EXAMPLE_TEXT = 'Fakturuji Vám za úklidové a pomocné práce částku oboustranně odsouhlasenou'
const CUSTOMER_EXAMPLES = { name: 'Příklad s.r.o.', street: 'Krátká 5', city: '602 00 Brno', ico: '25596641', dic: 'CZ25596641' }

export function Onboarding({ onDone }: { onDone(): void }) {
  const [step, setStep] = useState<Step>(0)
  const [supplier, setSupplier] = useState<PartyForm>(EMPTY_PARTY)
  const [payment, setPayment] = useState<PaymentForm>({ method: 'Bankovním převodem', bank: '', account: '' })
  const [customer, setCustomer] = useState<PartyForm>(EMPTY_PARTY)
  const [busy, setBusy] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    formRef.current?.querySelector('input')?.focus()
  }, [step])

  const customerValid = filled(customer.name) && filled(customer.street) && filled(customer.city)
  const valid =
    step === 1 ? filled(supplier.name) && filled(supplier.street) && filled(supplier.city) && filled(supplier.ico)
    : step === 2 ? filled(payment.method) && filled(payment.bank) && filled(payment.account)
    : customerValid

  const party = (f: PartyForm): Party => ({
    id: crypto.randomUUID(),
    name: f.name.trim(),
    street: f.street.trim(),
    city: f.city.trim(),
    ico: f.ico.trim(),
    dic: f.dic.trim(),
    note: f.note.trim(),
  })

  async function finish(withCustomer: boolean) {
    if (busy) return
    setBusy(true)
    const data: SavedData = {
      ...emptySavedData(),
      suppliers: [party(supplier)],
      payments: [{ id: crypto.randomUUID(), method: payment.method.trim(), bank: payment.bank.trim(), account: payment.account.trim() }],
      customers: withCustomer ? [party(customer)] : [],
      texts: [{ id: crypto.randomUUID(), text: EXAMPLE_TEXT }],
    }
    try {
      await saveSavedData(getBackend(), data)
    } catch (e) {
      toast(`Uložení se nezdařilo: ${e instanceof Error ? e.message : String(e)}`, 'error')
      setBusy(false)
      return
    }
    savedData.value = data
    onDone()
  }

  async function restore() {
    if (busy) return
    setBusy(true)
    try {
      // On success the data is written and published to `savedData`.
      if (await importFromZip({ onboarding: true })) onDone()
    } finally {
      setBusy(false)
    }
  }

  function submit(e: Event) {
    e.preventDefault()
    if (!valid || busy) return
    if (step === 3) void finish(true)
    else setStep((step + 1) as Step)
  }

  return (
    <div class="ob-page">
      <div class="ob-card">
        {step === 0 ? (
          <>
            <span class="ob-logo"><FileText size={20} />Fakturka</span>
            <h1>Vítejte ve Fakturce</h1>
            <p class="ob-sub">Jednoduché faktury pro OSVČ. Údaje se ukládají jen v tomto počítači.</p>
            <div class="ob-stack">
              <Button variant="primary" class="ob-wide" onClick={() => setStep(1)}>Začít – zadat moje údaje</Button>
              <Button class="ob-wide" icon={RotateCcw} disabled={busy} onClick={() => void restore()}>Obnovit ze zálohy (.zip)</Button>
            </div>
          </>
        ) : (
          <form ref={formRef} onSubmit={submit} noValidate>
            <div class="ob-steps" role="progressbar" aria-label={`Krok ${step} ze 3`} aria-valuenow={step} aria-valuemin={1} aria-valuemax={3}>
              {[1, 2, 3].map(n => <span key={n} class={n <= step ? 'on' : ''} />)}
            </div>
            {step === 1 && (
              <>
                <h1>Vaše údaje</h1>
                <p class="ob-sub">Budou na faktuře jako dodavatel.</p>
                <PartyFields value={supplier} onChange={setSupplier} supplier examples={SUPPLIER_EXAMPLES} />
              </>
            )}
            {step === 2 && (
              <>
                <h1>Bankovní účet</h1>
                <p class="ob-sub">Kam vám mají odběratelé platit.</p>
                <PaymentFields value={payment} onChange={setPayment} required examples={PAYMENT_EXAMPLES} />
              </>
            )}
            {step === 3 && (
              <>
                <h1>První odběratel</h1>
                <p class="ob-sub">Můžete přeskočit a přidat později.</p>
                <PartyFields value={customer} onChange={setCustomer} supplier={false} examples={CUSTOMER_EXAMPLES} />
              </>
            )}
            <div class="ob-foot">
              <Button onClick={() => setStep((step - 1) as Step)} disabled={busy}>Zpět</Button>
              <span class="sp" />
              {step === 3 && <Button variant="ghost" onClick={() => void finish(false)} disabled={busy}>Přeskočit</Button>}
              <Button variant="primary" type="submit" disabled={!valid || busy}>{step === 3 ? 'Dokončit' : 'Pokračovat'}</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
