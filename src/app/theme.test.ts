import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, nextThemePref, resolveTheme } from './theme'

type Listener = (e: { matches: boolean }) => void

function mockMatchMedia(initialDark: boolean) {
  let dark = initialDark
  const listeners = new Set<Listener>()
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return query.includes('dark') ? dark : false },
    media: query,
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  }))
  return {
    set(next: boolean) { dark = next; listeners.forEach(l => l({ matches: next })) },
    listenerCount: () => listeners.size,
  }
}

describe('resolveTheme', () => {
  it('follows the system for "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
  it('ignores the system for explicit choices', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('nextThemePref', () => {
  it('toggles to the opposite of what is shown, never back to system', () => {
    expect(nextThemePref('system', false)).toBe('dark')
    expect(nextThemePref('system', true)).toBe('light')
    expect(nextThemePref('light', true)).toBe('dark')
    expect(nextThemePref('dark', false)).toBe('light')
  })
})

describe('applyTheme', () => {
  beforeEach(() => { document.documentElement.removeAttribute('data-theme') })
  afterEach(() => { applyTheme('light'); vi.unstubAllGlobals() })

  it('sets data-theme on <html> for explicit choices', () => {
    mockMatchMedia(true)
    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('follows the system preference live while "system"', () => {
    const mm = mockMatchMedia(false)
    applyTheme('system')
    expect(document.documentElement.dataset.theme).toBe('light')
    mm.set(true)
    expect(document.documentElement.dataset.theme).toBe('dark')
    mm.set(false)
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('stops listening once an explicit theme is applied and never stacks listeners', () => {
    const mm = mockMatchMedia(false)
    applyTheme('system')
    applyTheme('system')
    expect(mm.listenerCount()).toBe(1)
    applyTheme('dark')
    expect(mm.listenerCount()).toBe(0)
    mm.set(false)
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('falls back to light when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)
    applyTheme('system')
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
