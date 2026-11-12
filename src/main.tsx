import { render } from 'preact'
import { App } from './app/App'
import { getBackend } from './storage/backend'

async function boot() {
  // Dev-only: `?demo` fills the in-memory backend with fake data (`&theme=dark|light` preselects a theme, `&tab=historie` a tab).
  // import.meta.env.DEV is false in production builds, so this branch and the demo module are dropped.
  if (import.meta.env.DEV) {
    const params = new URLSearchParams(window.location.search)
    if (params.has('demo')) {
      const { seedDemo } = await import('./app/demo')
      const theme = params.get('theme')
      await seedDemo(getBackend(), theme === 'dark' || theme === 'light' ? theme : undefined)
      // `&tab=historie` etc. opens that tab straight away.
      const tab = params.get('tab')
      if (tab === 'faktura' || tab === 'historie' || tab === 'udaje' || tab === 'nastaveni') {
        const { currentTab } = await import('./app/state')
        currentTab.value = tab
      }
    }
  }
  render(<App />, document.getElementById('root')!)
}

void boot()
