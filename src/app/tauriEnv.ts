/** Whether the app runs inside Tauri. A separate module so tests can mock it without touching `window`. */
export const inTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
