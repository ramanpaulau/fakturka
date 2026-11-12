/**
 * The system's file opener, behind two small functions so tests can mock them and the browser build
 * (in-memory backend, no Tauri) fails with a readable message instead of crashing.
 */
const inTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

async function opener() {
  if (!inTauri()) throw new Error('Funguje jen v aplikaci')
  return import('@tauri-apps/plugin-opener')
}

/** Opens a file or folder with the system's default application. */
export async function openPath(path: string): Promise<void> {
  await (await opener()).openPath(path)
}

/** Shows a file in the system file manager. */
export async function revealItemInDir(path: string): Promise<void> {
  await (await opener()).revealItemInDir(path)
}
