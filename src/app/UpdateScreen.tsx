export function UpdateScreen({ version }: { version: string }) {
  return (
    <div class="upd-page">
      <div class="upd-card">
        <h1>Instaluji novou verzi {version}…</h1>
        <div class="upd-bar" role="progressbar" aria-label="Instalace aktualizace">
          <span />
        </div>
        <p class="upd-hint">Aplikace se za chvíli sama znovu spustí.</p>
      </div>
    </div>
  )
}
