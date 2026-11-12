import { ChevronDown, ChevronRight, Copy, Download, FileDown, Folder, FolderOpen, MoreHorizontal, Pencil, Printer, Search, Trash2, Upload, type LucideIcon } from 'lucide-preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { currentTab, savedData } from '../app/state'
import { formatCzDate } from '../domain/dates'
import { formatCzk } from '../domain/money'
import { newInvoiceFrom } from '../domain/newInvoice'
import type { Invoice, InvoiceRecord } from '../domain/types'
import { PRINT_MODE, waitForSave } from '../editor/actions'
import { editorReady, forgetLoadedRecord, isSaved, loadedNumber, loadIntoEditor, refreshTakenNumbers, takenNumbers } from '../editor/editorState'
import { Sheet } from '../sheet/Sheet'
import { exportAll, importFromZip } from '../transfer/transfer'
import { getBackend } from '../storage/backend'
import { listInvoices, loadInvoice, recordPaths, resolveInvoiceDir } from '../storage/invoiceStore'
import { Button } from '../ui/Button'
import { confirmDialog } from '../ui/Dialog'
import { IconButton } from '../ui/IconButton'
import { Popover } from '../ui/Popover'
import { toast } from '../ui/Toast'
import { filterByRange, groupByYear, historyRange, OTHER_GROUP, plural, searchRecords, totals, type MonthRange } from './historyModel'
import { openPath, revealItemInDir } from './opener'
import { RangePicker } from './RangePicker'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

const invoices = (n: number) => plural(n, 'faktura', 'faktury', 'faktur')

const recordName = (r: InvoiceRecord) => (r.kind === 'invoice' ? r.invoice.number : r.fileName)
const recordPdf = (r: InvoiceRecord) => r.pdfPath
const recordKey = (r: InvoiceRecord) => (r.kind === 'invoice' ? r.jsonPath : r.pdfPath)

/** Confirms discarding the invoice in the editor, if it has unsaved changes. */
async function confirmLeaveEditor(): Promise<boolean> {
  if (isSaved.value) return true
  return confirmDialog({ title: 'Zahodit neuloženou fakturu?', body: 'Faktura v editoru není uložená. Změny se ztratí.', confirm: 'Zahodit', danger: true })
}

function showEditor(): void {
  // The editor must not boot a fresh invoice over the one just loaded.
  editorReady.value = true
  currentTab.value = 'faktura'
}

async function guarded(what: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (e) {
    toast(`${what}: ${message(e)}`, 'error')
  }
}

/** Gives the browser a moment to lay out and fit the print sheet before printing it. */
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 50))

type RowActions = {
  open: (r: InvoiceRecord) => void
  openPdf: (r: InvoiceRecord) => void
  print: (r: InvoiceRecord) => void
  newFrom: (r: InvoiceRecord) => void
  reveal: (r: InvoiceRecord) => void
  remove: (r: InvoiceRecord) => void
}

function MenuItem({ icon: Icon, danger, onClick, children }: { icon: LucideIcon; danger?: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" role="menuitem" class={danger ? 'menu-item danger' : 'menu-item'} onClick={onClick}>
      <Icon size={16} />
      {children}
    </button>
  )
}

function Row({ rec, act }: { rec: InvoiceRecord; act: RowActions }) {
  const [menu, setMenu] = useState(false)
  const moreRef = useRef<HTMLSpanElement>(null)
  const pick = (fn: (r: InvoiceRecord) => void) => () => {
    setMenu(false)
    fn(rec)
  }
  const inv = rec.kind === 'invoice' ? rec.invoice : null
  const noPdf = recordPdf(rec) === null
  // Without a stored PDF only webview printing works: it draws the sheet from the invoice data.
  const printDisabled = PRINT_MODE === 'pdf-viewer' && noPdf

  return (
    <div class={menu ? 'hist-row menu-open' : 'hist-row'}>
      {inv ? (
        <>
          <span class="hist-num">{inv.number}</span>
          <span class="hist-date">{formatCzDate(inv.issueDate)}</span>
          <span class="hist-cust">
            <span class="hist-cust-name">{inv.customer.name}</span>
            {inv.customer.ico && <span class="hist-sub">IČO {inv.customer.ico}</span>}
          </span>
          <span class="hist-amt">{inv.amount === null ? '—' : formatCzk(inv.amount)}</span>
          <span class="hist-date">{formatCzDate(inv.dueDate)}</span>
        </>
      ) : (
        <>
          <span class="hist-file">
            <FileDown size={16} />
            <span class="hist-file-name">{recordName(rec)}</span>
            <span class="badge">jen PDF – nelze upravit</span>
          </span>
          <span class="hist-amt hist-none">—</span>
          <span class="hist-date hist-none">—</span>
        </>
      )}
      <span class="hist-acts">
        {inv && (
          <button type="button" class="hist-open" onClick={() => act.open(rec)}>
            <Pencil size={16} />
            Otevřít
          </button>
        )}
        <IconButton icon={FileDown} title="PDF" disabled={noPdf} onClick={() => act.openPdf(rec)} />
        <IconButton icon={Printer} title="Tisknout" disabled={printDisabled} onClick={() => act.print(rec)} />
        <span ref={moreRef}>
          <IconButton icon={MoreHorizontal} title="Další akce" active={menu} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
        </span>
        <Popover anchor={moreRef} open={menu} onClose={() => setMenu(false)} align="end" class="hist-menu">
          <div role="menu">
            {inv && <MenuItem icon={Copy} onClick={pick(act.newFrom)}>Nová faktura podle této</MenuItem>}
            <MenuItem icon={FolderOpen} onClick={pick(act.reveal)}>Zobrazit ve složce</MenuItem>
            <hr />
            <MenuItem icon={Trash2} danger onClick={pick(act.remove)}>Smazat…</MenuItem>
          </div>
        </Popover>
      </span>
    </div>
  )
}

function YearSection({ year, records, count, total, collapsed, onToggle, act, showHead }: {
  year: string; records: InvoiceRecord[]; count: number; total: number; collapsed: boolean; onToggle: () => void; act: RowActions; showHead: boolean
}) {
  const Chevron = collapsed ? ChevronRight : ChevronDown
  return (
    <section class="hist-year">
      <button type="button" class="hist-year-head" aria-expanded={!collapsed} onClick={onToggle}>
        <span class="hist-year-title">
          <Chevron size={16} />
          {year}
        </span>{' '}
        {year === OTHER_GROUP ? (
          <span class="hist-sum">{plural(count, 'soubor', 'soubory', 'souborů')}</span>
        ) : (
          <span class="hist-sum">
            {invoices(count)} · celkem <b>{formatCzk(total)}</b>
          </span>
        )}
      </button>
      {!collapsed && (
        <div class="hist-table">
          {showHead && (
            <div class="hist-row hist-head" aria-hidden="true">
              <span>Číslo</span>
              <span>Vystaveno</span>
              <span>Odběratel</span>
              <span class="hist-amt">Částka</span>
              <span>Splatnost</span>
              <span />
            </div>
          )}
          {records.map(r => (
            <Row key={recordKey(r)} rec={r} act={act} />
          ))}
        </div>
      )}
    </section>
  )
}

/** The Historie tab: the invoice folder as a list grouped by year. */
export function HistoryPage() {
  const [records, setRecords] = useState<InvoiceRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dir, setDir] = useState('')
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [transferring, setTransferring] = useState(false)
  // The invoice drawn into the hidden print sheet. Stays mounted after printing: on macOS window.print() returns
  // before the print sheet has snapshotted the page.
  const [printSheet, setPrintSheet] = useState<Invoice | null>(null)
  const alive = useRef(true)
  // Tisknout is busy until window.print() returns: a double click must not print twice (like printCurrent).
  const printing = useRef(false)

  const refresh = async () => {
    const data = savedData.value
    if (!data) return
    try {
      const b = getBackend()
      const d = await resolveInvoiceDir(b, data)
      const list = await listInvoices(b, d)
      if (!alive.current) return
      setDir(d)
      setRecords(list)
      setError(null)
    } catch (e) {
      if (alive.current) setError(message(e))
    }
  }

  useEffect(() => {
    alive.current = true
    void refresh()
    return () => { alive.current = false }
  }, [])

  const act: RowActions = {
    open: r => void guarded('Fakturu se nepodařilo otevřít', async () => {
      if (r.kind !== 'invoice') return
      await waitForSave()
      if (!(await confirmLeaveEditor())) return
      loadIntoEditor(await loadInvoice(getBackend(), r.jsonPath), true)
      showEditor()
    }),
    openPdf: r => void guarded('PDF se nepodařilo otevřít', async () => {
      const pdf = recordPdf(r)
      if (pdf) await openPath(pdf)
    }),
    print: r => void guarded('Tisk se nezdařil', async () => {
      if (printing.current) return
      printing.current = true
      try {
        if (r.kind === 'invoice' && PRINT_MODE === 'webview') {
          setPrintSheet(r.invoice)
          await settle()
          // In Tauri on macOS window.print() returns the invoke promise (rejects e.g. without the permission).
          await (window.print() as unknown)
          return
        }
        const pdf = recordPdf(r)
        if (!pdf) return
        await openPath(pdf)
        toast('Fakturu vytiskněte z prohlížeče PDF.')
      } finally {
        printing.current = false
      }
    }),
    newFrom: r => void guarded('Fakturu se nepodařilo vytvořit', async () => {
      if (r.kind !== 'invoice') return
      await waitForSave()
      const data = savedData.value
      if (!data || !(await confirmLeaveEditor())) return
      // The list may predate a save that just finished; the editor's view of the folder has its number.
      await refreshTakenNumbers()
      const taken = new Set([...(records ?? []).flatMap(x => (x.kind === 'invoice' ? [x.invoice.number] : [])), ...takenNumbers.value])
      takenNumbers.value = taken
      loadIntoEditor(newInvoiceFrom(r.invoice, data, new Date(), taken), false)
      // Like a fresh invoice on app start: untouched, so there is nothing to lose.
      isSaved.value = true
      showEditor()
    }),
    reveal: r => void guarded('Složku se nepodařilo otevřít', () => revealItemInDir(recordPdf(r) ?? recordKey(r))),
    remove: r => void guarded('Smazání se nezdařilo', async () => {
      const ok = await confirmDialog({
        title: `Smazat fakturu ${recordName(r)}?`,
        body: 'Soubory se přesunou do koše.',
        confirm: 'Smazat',
        danger: true,
      })
      if (!ok) return
      // Every file of the record, including an older copy saved by 0.2.0 in the folder itself.
      await getBackend().trash(recordPaths(r))
      if (r.kind === 'invoice' && r.invoice.number === loadedNumber.value) {
        // The editor still shows it, but it is no longer saved anywhere.
        forgetLoadedRecord()
      }
      await refresh()
      await refreshTakenNumbers()
    }),
  }

  const transfer = async (run: () => Promise<boolean>) => {
    if (transferring) return
    setTransferring(true)
    try {
      await run()
      await refresh()
    } finally {
      if (alive.current) setTransferring(false)
    }
  }

  const toggle = (year: string) => {
    const next = new Set(collapsed)
    if (!next.delete(year)) next.add(year)
    setCollapsed(next)
  }

  const range = historyRange.value
  const shown = records ? searchRecords(filterByRange(records, range), query) : []
  const sum = totals(shown)
  const groups = groupByYear(shown)
  // The column header goes once above the first group that is open, so collapsing the newest year keeps it.
  const headGroup = groups.findIndex(g => !collapsed.has(g.year))
  const monthsWithInvoices = new Set((records ?? []).flatMap(r => (r.kind === 'invoice' ? [r.invoice.issueDate.slice(0, 7)] : [])))
  const countInvoices = (r: MonthRange) => filterByRange(records ?? [], r).filter(x => x.kind === 'invoice').length

  return (
    <>
      <div class="history">
        <div class="hist-bar">
          <label class="hist-search">
            <Search size={16} />
            <input type="search" value={query} placeholder="Hledat číslo, odběratele, IČO…" aria-label="Hledat" onInput={e => setQuery(e.currentTarget.value)} />
          </label>
          <RangePicker value={range} monthsWithInvoices={monthsWithInvoices} countInvoices={countInvoices} onChange={r => (historyRange.value = r)} />
          <span class="sp" />
          <Button icon={Upload} disabled={transferring} onClick={() => void transfer(importFromZip)}>Import</Button>
          <Button icon={Download} disabled={transferring} onClick={() => void transfer(exportAll)}>Export</Button>
        </div>

        <div class="hist-meta">
          <span class="hist-path">
            <Folder size={14} />
            <span class="hist-path-text" title={dir}>{dir}</span>
            {dir && <> · <button type="button" class="link" onClick={() => void guarded('Složku se nepodařilo otevřít', () => openPath(dir))}>Otevřít složku</button></>}
          </span>
          {records && (
            <span class="hist-sum">
              {invoices(sum.count)} · celkem <b>{formatCzk(sum.total)}</b>
            </span>
          )}
        </div>

        {error !== null && <div class="hist-empty" role="alert">Složku s fakturami se nepodařilo načíst: {error}</div>}
        {error === null && records !== null && groups.length === 0 && (
          <div class="hist-empty">{records.length === 0 ? 'Zatím tu nejsou žádné faktury.' : 'Nic nenalezeno.'}</div>
        )}
        {groups.map((g, i) => (
          <YearSection key={g.year} {...g} showHead={i === headGroup} collapsed={collapsed.has(g.year)} onToggle={() => toggle(g.year)} act={act} />
        ))}
      </div>
      {printSheet && (
        <div class="editor hist-print" aria-hidden="true">
          <div class="canvas">
            <Sheet invoice={printSheet} mode="static" />
          </div>
        </div>
      )}
    </>
  )
}
