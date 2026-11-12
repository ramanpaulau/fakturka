import type { ThemePref } from '../domain/types'

const QUERY = '(prefers-color-scheme: dark)'

export function resolveTheme(pref: ThemePref, systemDark: boolean): 'light' | 'dark' {
  if (pref === 'system') return systemDark ? 'dark' : 'light'
  return pref
}

/** The top-bar toggle: switches to the opposite of the theme currently shown. 'system' is only the first-run default. */
export function nextThemePref(p: ThemePref, systemDark: boolean): ThemePref {
  return resolveTheme(p, systemDark) === 'dark' ? 'light' : 'dark'
}

export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches
}

let stopListening: (() => void) | null = null

/** Sets `data-theme` on <html>. While the pref is 'system' it follows the OS setting live. */
export function applyTheme(pref: ThemePref): void {
  stopListening?.()
  stopListening = null
  const root = document.documentElement
  const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null
  root.dataset.theme = resolveTheme(pref, mq?.matches ?? false)
  if (pref === 'system' && mq) {
    const onChange = (e: { matches: boolean }) => { root.dataset.theme = resolveTheme('system', e.matches) }
    mq.addEventListener('change', onChange)
    stopListening = () => mq.removeEventListener('change', onChange)
  }
}
