import { signal } from '@preact/signals'
import { invoke } from '@tauri-apps/api/core'
import { inTauri } from './tauriEnv'

/** Version of an already downloaded, newer update; null when there is none, outside Tauri, or on any error. */
export async function pendingUpdate(): Promise<string | null> {
  if (!inTauri()) return null
  try {
    return (await invoke<string | null>('update_pending')) ?? null
  } catch {
    return null
  }
}

/** Installs the pending update. On Windows the process exits and this never resolves; rejects on failure. */
export async function installPendingUpdate(): Promise<void> {
  await invoke('update_install_pending')
}

/** The install screen stays visible at least this long before the install starts, so it can be read. */
export const MIN_INSTALL_SCREEN_MS = 1200

/** Waits `ms`; used to keep the install screen on screen before installing. */
export const delay = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/** Version of an update the background download finished this session; null until then. */
export const updateReady = signal<string | null>(null)

/** The update banner was dismissed (Později, or a failed install) for this session. */
export const updateBannerDismissed = signal(false)

let downloadStarted = false

/** Fire-and-forget download of the next update, at most once per app session. Errors are silent. */
export function downloadUpdateInBackground(): void {
  if (downloadStarted || !inTauri()) return
  downloadStarted = true
  try {
    invoke<string | null>('update_download')
      .then(version => { if (typeof version === 'string' && version) updateReady.value = version })
      .catch(() => {})
  } catch {
    // ignore: updating must never disturb the app
  }
}

/** Test helper: forget that the background download already ran, its result, and a dismissed banner. */
export function resetUpdateSession(): void {
  downloadStarted = false
  updateReady.value = null
  updateBannerDismissed.value = false
}
