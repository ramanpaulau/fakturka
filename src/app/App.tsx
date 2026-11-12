import { useEffect, useState } from 'preact/hooks'
import { effect } from '@preact/signals'
import { bootEditor, installCloseGuard } from '../editor/actions'
import { EditorPage } from '../editor/EditorPage'
import { HistoryPage } from '../history/HistoryPage'
import { Onboarding } from '../onboarding/Onboarding'
import { SavedPage } from '../saved/SavedPage'
import { SettingsPage } from '../settings/SettingsPage'
import { getBackend } from '../storage/backend'
import { loadSavedData } from '../storage/dataStore'
import { DialogHost } from '../ui/Dialog'
import { toast, ToastHost } from '../ui/Toast'
import { currentTab, savedData } from './state'
import { TopBar } from './TopBar'
import { applyTheme } from './theme'
import { UpdateScreen } from './UpdateScreen'
import { downloadUpdateInBackground, installPendingUpdate, pendingUpdate } from './updates'
import '../ui/theme.css'

type Boot = { status: 'loading' } | { status: 'updating'; version: string } | { status: 'fresh' } | { status: 'ok' } | { status: 'error'; message: string; path: string | null }

function ErrorScreen({ message, path }: { message: string; path: string | null }) {
  return (
    <div class="fatal" role="alert">
      <h1>Data se nepodařilo načíst</h1>
      <p>{message}</p>
      {path && (
        <p class="hint">
          Soubor s daty: <code>{path}</code>
          <br />
          Vedle něj je záloha se stejným názvem a příponou <code>.bak</code>.
        </p>
      )}
      <p class="hint">Aplikace nic nepřepíše, dokud se soubor nepodaří načíst.</p>
    </div>
  )
}

export function App() {
  const [boot, setBoot] = useState<Boot>({ status: 'loading' })

  useEffect(() => {
    // Follow the OS theme until the saved preference is known (and in the fresh/error screens).
    applyTheme('system')
    const stop = effect(() => {
      const pref = savedData.value?.settings.theme
      if (pref) applyTheme(pref)
    })
    let alive = true
    const load = () =>
      loadSavedData(getBackend()).then(async r => {
        const path = r.status === 'error' ? await getBackend().dataFilePath().catch(() => null) : null
        if (!alive) return
        if (r.status === 'ok') {
          savedData.value = r.data
          setBoot({ status: 'ok' })
          if (r.recovered) toast('Data byla obnovena ze zálohy.', 'warning')
        } else if (r.status === 'fresh') {
          setBoot({ status: 'fresh' })
        } else {
          setBoot({ status: 'error', message: r.message, path })
        }
        // Every boot outcome, the data-error screen included: a download only writes to the
        // cache folder, never to user data, and a newer version may fix the error.
        downloadUpdateInBackground()
      })
    // A downloaded update is installed before anything else; if that fails, boot normally and say nothing.
    void (async () => {
      const version = await pendingUpdate()
      if (version && alive) {
        setBoot({ status: 'updating', version })
        try {
          await installPendingUpdate()
        } catch {
          // fall through to the normal boot
        }
      }
      if (alive) await load()
    })()
    return () => { alive = false; stop() }
  }, [])

  useEffect(() => {
    // Closing the window with an unsaved invoice asks first (Tauri only).
    let unlisten: (() => void) | null = null
    let alive = true
    installCloseGuard()
      .then(u => { if (alive) unlisten = u; else u() })
      .catch(() => {})
    return () => { alive = false; unlisten?.() }
  }, [])

  const tab = currentTab.value
  return (
    <>
      {boot.status === 'updating' && <UpdateScreen version={boot.version} />}
      {boot.status === 'ok' && (
        <div class="app">
          <TopBar />
          <main class="main">{tab === 'faktura' ? <EditorPage /> : tab === 'historie' ? <HistoryPage /> : tab === 'udaje' ? <SavedPage /> : <SettingsPage />}</main>
        </div>
      )}
      {boot.status === 'fresh' && (
        <Onboarding
          onDone={() => {
            // Onboarding already published the new data to `savedData`, same as a successful load.
            setBoot({ status: 'ok' })
            void bootEditor()
          }}
        />
      )}
      {boot.status === 'error' && <ErrorScreen message={boot.message} path={boot.path} />}
      <DialogHost />
      <ToastHost />
    </>
  )
}
