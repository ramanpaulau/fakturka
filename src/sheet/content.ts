import { formatCzDate } from '../domain/dates'
import { formatCzk } from '../domain/money'
import type { Invoice, Party, Snap } from '../domain/types'
import type { Para } from '../pdf/wrap'

type PartyKey = 'name' | 'street' | 'city' | 'ico' | 'dic' | 'note'
/** Text fields the editor can change in place (see `setField`). */
export type FieldPath = 'number' | `${'supplier' | 'customer'}.${PartyKey}` | `payment.${'method' | 'bank' | 'account'}` | 'text.text'

export const FIELD_PATHS: ReadonlySet<string> = new Set<FieldPath>([
  'number',
  ...(['supplier', 'customer'] as const).flatMap(w => (['name', 'street', 'city', 'ico', 'dic', 'note'] as const).map(k => `${w}.${k}` as const)),
  'payment.method',
  'payment.bank',
  'payment.account',
  'text.text',
])

/**
 * A printed paragraph plus what the editor needs: the field it shows (`text` = `prefix` + value) and
 * whether it is an empty optional line that exists only while editing (never printed).
 */
export type SheetPara = Para & { field?: FieldPath; prefix?: string; optional?: boolean }

/** What a payment/dates value shows: a text field, a date, or the number mirrored as variabilní symbol. */
export type RowKey = 'payment.method' | 'payment.bank' | 'payment.account' | 'vs' | 'issueDate' | 'dueDate'
export type SheetRow = [label: string, value: string, key: RowKey]

/** Every string printed on the invoice, shared by the sheet and the PDF. */
export type SheetContent = {
  title: string
  numberLabel: string
  number: string
  supplierLabel: string
  supplier: SheetPara[]
  customerLabel: string
  customer: SheetPara[]
  paymentLabel: string
  payment: SheetRow[]
  dates: SheetRow[]
  text: string
  vatNote: string
  totalLabel: string
  total: string
  signLabels: [string, string]
}

function party(p: Snap<Party>, who: 'supplier' | 'customer', showDic: boolean, boldName: boolean, withNote: boolean, edit: boolean): SheetPara[] {
  const paras: SheetPara[] = [
    { text: p.name, bold: boldName, field: `${who}.name` },
    { text: p.street, field: `${who}.street` },
    { text: p.city, field: `${who}.city` },
    { text: `IČO: ${p.ico}`, prefix: 'IČO: ', field: `${who}.ico` },
  ]
  // Empty optional lines are not printed; while editing they stay visible (marked `optional`) so they can be filled in.
  const dic = p.dic.trim() !== ''
  if (showDic && (dic || edit)) paras.push({ text: `DIČ: ${p.dic}`, prefix: 'DIČ: ', field: `${who}.dic`, optional: !dic })
  const note = p.note.trim() !== ''
  if (withNote && (note || edit)) paras.push({ text: p.note, field: `${who}.note`, optional: !note })
  return paras
}

/** `edit: true` adds the empty optional lines (flagged `optional`) that only the editor shows. */
export function sheetContent(inv: Invoice, opts: { edit?: boolean } = {}): SheetContent {
  const edit = opts.edit ?? false
  const amount = inv.amount === null ? '' : formatCzk(inv.amount)
  return {
    title: 'Faktura',
    numberLabel: 'Číslo: ',
    number: inv.number,
    supplierLabel: 'Dodavatel',
    supplier: party(inv.supplier, 'supplier', inv.showDic, false, true, edit),
    customerLabel: 'Odběratel',
    customer: party(inv.customer, 'customer', inv.showDic, true, false, edit),
    paymentLabel: 'Platební podmínky',
    payment: [
      ['Forma úhrady:', inv.payment.method, 'payment.method'],
      ['Bankovní spojení:', inv.payment.bank, 'payment.bank'],
      ['Číslo účtu:', inv.payment.account, 'payment.account'],
      ['Variabilní symbol:', inv.number, 'vs'],
    ],
    dates: [
      ['Datum vystavení:', formatCzDate(inv.issueDate), 'issueDate'],
      ['Datum splatnosti:', formatCzDate(inv.dueDate), 'dueDate'],
    ],
    text: [inv.text.text, amount].filter(Boolean).join(' '),
    vatNote: 'Nejsem plátce DPH',
    totalLabel: 'Cena celkem: ',
    total: amount,
    signLabels: ['Podpis', 'Razítko'],
  }
}
