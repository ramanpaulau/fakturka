/** 42000 -> '42\u00a0000,-\u00a0Kč' (whole crowns, non-breaking spaces as thousands separator and before Kč). */
export function formatCzk(amount: number): string {
  const grouped = String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')
  return `${grouped},-\u00a0Kč`
}

/** Parses '42 000', '42000 Kč', '42 000,-' to a number; null when not whole digits. */
export function parseCzk(input: string): number | null {
  const s = input.replace(/Kč|,-|[\s\u00a0]/g, '')
  if (!/^\d+$/.test(s)) return null
  return Number(s)
}
