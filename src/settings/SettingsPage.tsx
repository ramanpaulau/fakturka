import { Download, Folder, LoaderCircle, Upload } from 'lucide-preact'
import { useEffect, useState } from 'preact/hooks'
import { getVersion } from '@tauri-apps/api/app'
import { savedData, updateSavedData } from '../app/state'
import { DEFAULT_SETTINGS, type DueRule, type Settings } from '../domain/types'
import { forgetLoadedRecord, refreshTakenNumbers } from '../editor/editorState'
import { getBackend } from '../storage/backend'
import { listInvoices, resolveInvoiceDir } from '../storage/invoiceStore'
import { Button } from '../ui/Button'
import { exportAll, importFromZip } from '../transfer/transfer'
import { choiceDialog } from '../ui/Dialog'
import { toast } from '../ui/Toast'
import { findMoveConflicts, PARTIAL_MOVE_MARKER, planMove, recordLabel, type Decision } from './folderMove'

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const trimSlash = (p: string): string => p.replace(/[\\/]+$/, '')

/** An integer field that commits valid values immediately and snaps back to the saved value on blur. */
function NumberField({ label, value, min, max, onCommit, suffix }: {
  label: string
  value: number
  min: number
  max: number
  onCommit(n: number): void
  suffix?: string
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  return (
    <>
      <input
        type="number"
        class="set-num"
        aria-label={label}
        min={min}
        max={max}
        step={1}
        value={draft}
        onInput={e => {
          const raw = e.currentTarget.value
          setDraft(raw)
          const n = Number(raw)
          if (raw.trim() !== '' && Number.isInteger(n) && n >= min && n <= max) onCommit(n)
        }}
        onBlur={() => setDraft(String(value))}
      />
      {suffix && <span class={suffix.startsWith('.') ? 'set-suffix-tight' : undefined}>{suffix}</span>}
    </>
  )
}

export function SettingsPage() {
  const data = savedData.value
  const settings: Settings = data?.settings ?? DEFAULT_SETTINGS
  const [dir, setDir] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [moving, setMoving] = useState(false)
  const [version, setVersion] = useState('–')

  // The rule the user is not using keeps its last value, so switching back and forth loses nothing.
  const [day, setDay] = useState(settings.dueRule.kind === 'dayOfNextMonth' ? settings.dueRule.day : 15)
  const [days, setDays] = useState(settings.dueRule.kind === 'daysAfterIssue' ? settings.dueRule.days : 30)

  const invoiceDir = settings.invoiceDir
  useEffect(() => {
    let alive = true
    if (data) resolveInvoiceDir(getBackend(), data).then(d => { if (alive) setDir(d) }, () => { if (alive) setDir(invoiceDir) })
    return () => { alive = false }
  }, [invoiceDir, data !== null])

  useEffect(() => {
    // Outside the desktop shell there is no app to ask; the call rejects and "–" stays.
    getVersion().then(v => setVersion(v), () => {})
  }, [])

  const patch = (p: Partial<Settings>) => updateSavedData(d => ({ ...d, settings: { ...d.settings, ...p } }))
  const setRule = (rule: DueRule) => void patch({ dueRule: rule })

  /** Applies the new folder; resolves true once it is saved. */
  const applyDir = async (to: string): Promise<boolean> => {
    const ok = await patch({ invoiceDir: to })
    if (!ok) return ok
    // The open invoice's record is in the old folder (or, kept or not moved, the new folder holds a different one).
    forgetLoadedRecord()
    await refreshTakenNumbers()
    return ok
  }

  /** Moves the invoices to `to`. Resolves false when the user backed out, throws on failure. */
  const moveTo = async (from: string, to: string): Promise<{ moved: number } | null> => {
    const b = getBackend()
    const [fromRecords, toRecords] = await Promise.all([listInvoices(b, from), listInvoices(b, to)])
    const conflicts = findMoveConflicts(fromRecords, toRecords)
    const decisions: Decision[] = []
    for (const conflict of conflicts) {
      const choice = await choiceDialog({
        title: 'Faktura už existuje',
        body: `${recordLabel(conflict.source)} už v cílové složce je.`,
        choices: [
          { value: 'keep' as const, label: 'Ponechat cílovou' },
          { value: 'replace' as const, label: 'Nahradit v cílové složce', primary: true },
        ],
      })
      if (choice === null) return null
      decisions.push({ conflict, choice })
    }
    const { names, overwrite, leftovers } = planMove(fromRecords, decisions)
    if (names.length === 0) return { moved: 0 }
    setMoving(true)
    try {
      const report = await b.moveInvoices(from, to, names, overwrite)
      if (leftovers.length > 0) {
        // Same invoice number under a different file name: the replaced copy must not linger next to the new one.
        await b.trash(leftovers).catch(e => toast(`Nahrazenou fakturu se nepodařilo odstranit z cílové složky: ${message(e)}`, 'warning'))
      }
      return report
    } finally {
      setMoving(false)
    }
  }

  const transfer = async (run: () => Promise<boolean>) => {
    if (busy) return
    setBusy(true)
    try {
      await run()
    } finally {
      setBusy(false)
    }
  }

  const changeFolder = async () => {
    if (busy || !data) return
    setBusy(true)
    try {
      let picked: string | null
      try { picked = await getBackend().pickFolder() } catch (e) { toast(`Složku se nepodařilo vybrat: ${message(e)}`, 'error'); return }
      const from = dir
      if (!picked || from === null) return
      if (trimSlash(picked) === trimSlash(from)) { toast('Tato složka je už nastavená.', 'warning'); return }

      const choice = await choiceDialog({
        title: 'Změnit složku s fakturami',
        body: `Nová složka: ${picked}. Chcete do ní přesunout i existující faktury?`,
        choices: [
          { value: 'only' as const, label: 'Jen ukládat do nové složky' },
          { value: 'move' as const, label: 'Přesunout faktury', primary: true },
        ],
      })
      if (choice === null) return

      let report: { moved: number } | null = null
      if (choice === 'move') {
        try {
          report = await moveTo(from, picked)
        } catch (e) {
          const msg = message(e)
          toast(
            msg.startsWith(PARTIAL_MOVE_MARKER)
              // some invoices are already in the new folder, so do not pretend nothing happened
              ? `Přesun se nedokončil. Faktury byly zkopírovány do složky ${picked}${msg.slice(PARTIAL_MOVE_MARKER.length)}. Složka v nastavení se nezměnila.`
              : `Faktury se nepodařilo přesunout: ${msg}. Nastavení zůstalo beze změny.`,
            'error',
          )
          return
        }
        if (report === null) return
      }
      if (await applyDir(picked)) {
        toast(report ? (report.moved > 0 ? 'Faktury byly přesunuty do nové složky.' : 'Složka byla změněna. Ve staré složce nebyly žádné faktury k přesunu.') : 'Faktury se nyní ukládají do nové složky.')
      } else if (report && report.moved > 0) {
        toast(`Faktury byly přesunuty do složky ${picked}, ale nastavení se nepodařilo uložit.`, 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  if (!data) return null
  const rule = settings.dueRule
  return (
    <div class="settings">
      <h1>Nastavení</h1>

      <section class="set-card" aria-labelledby="set-folder">
        <h2 id="set-folder">Složka s fakturami</h2>
        <div class="set-row">
          <Folder size={16} />
          <span class="set-path" title={dir ?? undefined}>{dir ?? '…'}</span>
          <Button onClick={() => void changeFolder()} disabled={busy || dir === null}>Změnit…</Button>
        </div>
        {moving && (
          <div class="set-progress" role="status">
            <LoaderCircle size={16} class="spin" />
            Přesouvám faktury…
          </div>
        )}
        <p class="set-hint">Faktury (PDF a JSON) se ukládají do této složky. Jiné soubory v ní aplikace nepřesouvá.</p>
      </section>

      <section class="set-card" aria-labelledby="set-defaults">
        <h2 id="set-defaults">Výchozí hodnoty</h2>
        <fieldset class="set-group">
          <legend>Splatnost nové faktury</legend>
          <label class="set-opt">
            <input
              type="radio"
              name="dueRule"
              aria-label="Den v následujícím měsíci"
              checked={rule.kind === 'dayOfNextMonth'}
              onChange={() => setRule({ kind: 'dayOfNextMonth', day })}
            />
            <NumberField
              label="Den v měsíci"
              value={day}
              min={1}
              max={31}
              suffix=". den následujícího měsíce"
              onCommit={n => { setDay(n); setRule({ kind: 'dayOfNextMonth', day: n }) }}
            />
          </label>
          <label class="set-opt">
            <input
              type="radio"
              name="dueRule"
              aria-label="Dní od vystavení"
              checked={rule.kind === 'daysAfterIssue'}
              onChange={() => setRule({ kind: 'daysAfterIssue', days })}
            />
            <NumberField
              label="Počet dní"
              value={days}
              min={0}
              max={365}
              suffix="dní od vystavení"
              onCommit={n => { setDays(n); setRule({ kind: 'daysAfterIssue', days: n }) }}
            />
          </label>
        </fieldset>

        <label class="set-switch">
          <input
            type="checkbox"
            role="switch"
            checked={settings.showDicDefault}
            onChange={e => void patch({ showDicDefault: e.currentTarget.checked })}
          />
          <span class="set-track" aria-hidden="true" />
          Zobrazovat DIČ
        </label>
      </section>

      <section class="set-card" aria-labelledby="set-backup">
        <h2 id="set-backup">Záloha</h2>
        <div class="set-row">
          <Button icon={Download} disabled={busy} onClick={() => void transfer(exportAll)}>Exportovat…</Button>
          <Button icon={Upload} disabled={busy} onClick={() => void transfer(importFromZip)}>Importovat…</Button>
        </div>
        <p class="set-hint">Export uloží všechny faktury a uložené údaje do jednoho souboru ZIP.</p>
      </section>

      <section class="set-card" aria-labelledby="set-about">
        <h2 id="set-about">O aplikaci</h2>
        <p class="set-about">Fakturka, verze <span class="num">{version}</span></p>
        <p class="set-about">Autoři: Raman Paulau a Claude Opus</p>
        <p class="set-about">Aplikace vytvořená s pomocí AI (vibecoding) pro osobní použití. Bez záruky a bez podpory.</p>
        <p class="set-about">github.com/ramanpaulau/fakturka</p>
        <p class="set-about set-privacy">
          Všechna data – uložené údaje i faktury – se ukládají jen lokálně do tohoto počítače. Aplikace nic neodesílá na
          internet. Pokud je složka s fakturami synchronizovaná (např. OneDrive), kopii do cloudu pořizuje tato služba, ne aplikace.
        </p>
      </section>
    </div>
  )
}
