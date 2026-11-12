export type Party = { id: string; name: string; street: string; city: string; ico: string; dic: string; note: string } // note = optional extra supplier line ('' when unused)
export type Payment = { id: string; method: string; bank: string; account: string }
export type InvoiceText = { id: string; text: string }
export type ThemePref = 'system' | 'light' | 'dark'
export type DueRule = { kind: 'dayOfNextMonth'; day: number } | { kind: 'daysAfterIssue'; days: number }
export type Settings = { invoiceDir: string | null; theme: ThemePref; dueRule: DueRule; showDicDefault: boolean }
export type SavedData = { schemaVersion: 1; suppliers: Party[]; customers: Party[]; payments: Payment[]; texts: InvoiceText[]; settings: Settings }
export type Snap<T> = Omit<T, 'id'> & { sourceId: string | null }
export type Invoice = { schemaVersion: 1; number: string; issueDate: string; dueDate: string; supplier: Snap<Party>; customer: Snap<Party>; payment: Snap<Payment>; text: Snap<InvoiceText>; amount: number | null; showDic: boolean; savedAt: string | null }
export type InvoiceRecord =
  | { kind: 'invoice'; invoice: Invoice; jsonPath: string; pdfPath: string | null; baseName: string }
  | { kind: 'pdfOnly'; pdfPath: string; fileName: string }
export const DEFAULT_SETTINGS: Settings = { invoiceDir: null, theme: 'system', dueRule: { kind: 'dayOfNextMonth', day: 15 }, showDicDefault: true }
