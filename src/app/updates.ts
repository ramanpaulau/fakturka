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

let downloadStarted = false

/** Fire-and-forget download of the next update, at most once per app session. Errors are silent. */
export function downloadUpdateInBackground(): void {
  if (downloadStarted || !inTauri()) return
  downloadStarted = true
  try {
    invoke('update_download').catch(() => {})
  } catch {
    // ignore: updating must never disturb the app
  }
}

/** Test helper: forget that the background download already ran. */
export function resetUpdateSession(): void {
  downloadStarted = false
}
