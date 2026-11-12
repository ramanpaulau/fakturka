import { useState } from 'preact/hooks'
import { waitForSave } from '../editor/actions'
import { isSaved } from '../editor/editorState'
import { Button } from '../ui/Button'
import { confirmDialog } from '../ui/Dialog'
import { toast } from '../ui/Toast'
import { UpdateScreen } from './UpdateScreen'
import { delay, installPendingUpdate, MIN_INSTALL_SCREEN_MS, updateBannerDismissed, updateReady } from './updates'

/**
 * Offers to install an update the background download finished. Non-modal, bottom-right.
 * "Později" hides it for this session; the update still installs at the next start.
 */
export function UpdateBanner() {
  const [busy, setBusy] = useState(false)
  const [installing, setInstalling] = useState(false)
  const version = updateReady.value
  if (!version || updateBannerDismissed.value) return null

  const update = async () => {
    if (busy) return
    setBusy(true)
    try {
      await waitForSave()
      if (!isSaved.value) {
        const ok = await confirmDialog({
          title: 'Faktura není uložená',
          body: 'Aktualizace aplikaci restartuje a neuložené změny se ztratí.',
          confirm: 'Zahodit a aktualizovat',
          cancel: 'Zrušit',
          danger: true,
        })
        if (!ok) {
          setBusy(false)
          return
        }
      }
      setInstalling(true)
      await delay(MIN_INSTALL_SCREEN_MS)
      // On Windows the process exits here and the app restarts in the new version.
      await installPendingUpdate()
    } catch {
      setInstalling(false)
      setBusy(false)
      updateBannerDismissed.value = true
      toast('Aktualizaci se nepodařilo spustit. Zkusím to při příštím spuštění.', 'warning')
    }
  }

  return (
    <>
      <div class="upd-banner" role="status">
        <p>Je připravená nová verze {version}.</p>
        <div class="upd-banner-actions">
          <Button variant="ghost" onClick={() => { updateBannerDismissed.value = true }} disabled={busy}>
            Později
          </Button>
          <Button variant="primary" onClick={() => void update()} disabled={busy}>
            Aktualizovat
          </Button>
        </div>
      </div>
      {installing && (
        <div class="upd-overlay">
          <UpdateScreen version={version} />
        </div>
      )}
    </>
  )
}
