export type Party = { id: string; name: string; street: string; city: string; ico: string; dic: string; note: string } // note = optional extra supplier line ('' when unused)
export type Payment = { id: string; method: string; bank: string; account: string }
export type InvoiceText = { id: string; text: string }
export type ThemePref = 'system' | 'light' | 'dark'
export type DueRule = { kind: 'dayOfNextMonth'; day: number } | { kind: 'daysAfterIssue'; days: number }
export type Settings = { invoiceDir: string | null; theme: ThemePref; dueRule: DueRule; showDicDefault: boolean }
export type SavedData = { schemaVersion: 1; suppliers: Party[]; customers: Party[]; payments: Payment[]; texts: InvoiceText[]; settings: Settings }
export type Snap<T> = Omit<T, 'id'> & { sourceId: string | null }
export type Invoice = { schemaVersion: 1; number: string; issueDate: string; dueDate: string; supplier: Snap<Party>; customer: Snap<Party>; payment: Snap<Payment>; text: Snap<InvoiceText>; amount: number | null; showDic: boolean; savedAt: string | null }
/**
 * A saved invoice (or a lone PDF) as listed from the invoice folder. `jsonPath`/`pdfPath` are the files shown and opened
 * (the `json/`/`pdf/` copy when there is one). `extraPaths` are older copies of the same file names in the folder itself
 * (saved by 0.2.0 or earlier): they belong to the record, so deleting or replacing it removes them too.
 */
export type InvoiceRecord =
  | { kind: 'invoice'; invoice: Invoice; jsonPath: string; pdfPath: string | null; baseName: string; extraPaths?: string[] }
  | { kind: 'pdfOnly'; pdfPath: string; fileName: string; extraPaths?: string[] }
export const DEFAULT_SETTINGS: Settings = { invoiceDir: null, theme: 'system', dueRule: { kind: 'dayOfNextMonth', day: 15 }, showDicDefault: true }
