import type { DueRule } from './types'

// All arithmetic is done on UTC dates so the local time zone can never shift the day.

const pad = (n: number): string => String(n).padStart(2, '0')

function toIso(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** Last day of the month of `today` (local calendar date), as YYYY-MM-DD. */
export function defaultIssueDate(today: Date): string {
  return toIso(new Date(Date.UTC(today.getFullYear(), today.getMonth() + 1, 0)))
}

export function addDays(iso: string, days: number): string {
  const d = parseIso(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return toIso(d)
}

export function dueDateFor(issueDate: string, rule: DueRule): string {
  if (rule.kind === 'daysAfterIssue') return addDays(issueDate, rule.days)
  const d = parseIso(issueDate)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1 // next month, 0-based
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return toIso(new Date(Date.UTC(y, m, Math.min(rule.day, lastDay))))
}

/** '2026-11-30' -> '30. 11. 2026' */
export function formatCzDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d}. ${m}. ${y}`
}
