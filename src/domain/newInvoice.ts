import { dueDateFor, defaultIssueDate } from './dates'
import { toSnap } from './entities'
import { suggestNumber } from './numbering'
import type { Invoice, InvoiceText, Party, Payment, SavedData, Snap } from './types'

const emptyParty = (): Snap<Party> => ({ name: '', street: '', city: '', ico: '', dic: '', note: '', sourceId: null })
const emptyPayment = (): Snap<Payment> => ({ method: '', bank: '', account: '', sourceId: null })
const emptyText = (): Snap<InvoiceText> => ({ text: '', sourceId: null })

function first<T extends { id: string }>(list: T[], empty: () => Snap<T>): Snap<T> {
  return list.length > 0 ? toSnap(list[0]) : empty()
}

/** A fresh, unsaved invoice: content copied from `last` (or the first saved entries), number and dates recomputed. */
export function newInvoiceFrom(last: Invoice | null, data: SavedData, today: Date, taken: Set<string>): Invoice {
  const { settings } = data
  const issueDate = defaultIssueDate(today)
  const base = {
    schemaVersion: 1 as const,
    number: suggestNumber(issueDate, taken),
    issueDate,
    dueDate: dueDateFor(issueDate, settings.dueRule),
    savedAt: null,
  }
  if (last) {
    return {
      ...base,
      supplier: { ...last.supplier },
      customer: { ...last.customer },
      payment: { ...last.payment },
      text: { ...last.text },
      amount: last.amount,
      showDic: last.showDic,
    }
  }
  return {
    ...base,
    supplier: first(data.suppliers, emptyParty),
    customer: first(data.customers, emptyParty),
    payment: first(data.payments, emptyPayment),
    text: first(data.texts, emptyText),
    amount: null,
    showDic: settings.showDicDefault,
  }
}
