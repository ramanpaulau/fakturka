import { useRef, useState } from 'preact/hooks'
import { waitForSave } from '../editor/actions'
import { isSaved } from '../editor/editorState'
import { Button } from '../ui/Button'
import { confirmDialog } from '../ui/Dialog'
import { toast } from '../ui/Toast'
import { UpdateScreen } from './UpdateScreen'
import { delay, installPendingUpdate, MIN_INSTALL_SCREEN_MS, updateBannerDismissed, updateInstalling, updateReady } from './updates'

/**
 * Offers to install an update the background download finished. Non-modal, bottom-right.
 * "Později" hides it for this session; the update still installs at the next start.
 */
export function UpdateBanner() {
  const [busy, setBusy] = useState(false)
  // A ref, not only state: two clicks in the same task must not both get past the guard.
  const started = useRef(false)
  const version = updateReady.value
  if (!version || updateBannerDismissed.value) return null

  const update = async () => {
    if (started.current) return
    started.current = true
    setBusy(true)
    const stop = () => {
      updateInstalling.value = false
      started.current = false
      setBusy(false)
    }
    try {
      await waitForSave()
      const discard = !isSaved.value
      if (discard) {
        const ok = await confirmDialog({
          title: 'Faktura není uložená',
          body: 'Aktualizace aplikaci restartuje a neuložené změny se ztratí.',
          confirm: 'Zahodit a aktualizovat',
          cancel: 'Zrušit',
          danger: true,
        })
        if (!ok) {
          stop()
          return
        }
      }
      // The overlay covers the app and App makes it inert, so nothing behind it can be edited or saved.
      updateInstalling.value = true
      await delay(MIN_INSTALL_SCREEN_MS)
      // Re-check: a save may still be running, or the invoice may have changed after the first check.
      await waitForSave()
      if (!discard && !isSaved.value) {
        stop()
        return
      }
      // On Windows the process exits here and the app restarts in the new version.
      await installPendingUpdate()
    } catch {
      stop()
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
      {updateInstalling.value && (
        <div class="upd-overlay">
          <UpdateScreen version={version} />
        </div>
      )}
    </>
  )
}
