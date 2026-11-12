import { FileText, Moon, Settings, Sun } from 'lucide-preact'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { currentTab, savedData, updateSavedData, type Tab } from './state'
import { nextThemePref, resolveTheme, systemPrefersDark } from './theme'

const TABS: { id: Tab; label: string }[] = [
  { id: 'faktura', label: 'Faktura' },
  { id: 'historie', label: 'Historie' },
  { id: 'udaje', label: 'Uložené údaje' },
]

export function TopBar() {
  const pref = savedData.value?.settings.theme ?? 'system'
  const dark = resolveTheme(pref, systemPrefersDark()) === 'dark'
  const toggleTheme = () => updateSavedData(d => ({ ...d, settings: { ...d.settings, theme: nextThemePref(d.settings.theme, systemPrefersDark()) } }))

  return (
    <header class="topbar">
      <span class="logo"><FileText size={20} />Fakturka</span>
      <nav class="tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            class={currentTab.value === t.id ? 'tab on' : 'tab'}
            aria-current={currentTab.value === t.id ? 'page' : undefined}
            onClick={() => { currentTab.value = t.id }}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <span class="sp" />
      <IconButton icon={dark ? Moon : Sun} title={dark ? 'Přepnout na světlý motiv' : 'Přepnout na tmavý motiv'} onClick={toggleTheme} />
      <Button variant="ghost" icon={Settings} class={currentTab.value === 'nastaveni' ? 'on' : undefined} aria-current={currentTab.value === 'nastaveni' ? 'page' : undefined} onClick={() => { currentTab.value = 'nastaveni' }}>
        Nastavení
      </Button>
    </header>
  )
}
