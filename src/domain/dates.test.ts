import { describe, expect, it } from 'vitest'
import { addDays, defaultIssueDate, dueDateFor, formatCzDate } from './dates'

describe('dates', () => {
  it('defaultIssueDate is the last day of the month', () => {
    expect(defaultIssueDate(new Date(2026, 10, 9))).toBe('2026-11-30')
    expect(defaultIssueDate(new Date(2026, 1, 3))).toBe('2026-02-28')
  })
  it('dueDateFor dayOfNextMonth', () => {
    expect(dueDateFor('2026-11-30', { kind: 'dayOfNextMonth', day: 15 })).toBe('2026-12-15')
    expect(dueDateFor('2026-12-31', { kind: 'dayOfNextMonth', day: 15 })).toBe('2027-01-15')
  })
  it('dueDateFor daysAfterIssue', () => {
    expect(dueDateFor('2026-11-30', { kind: 'daysAfterIssue', days: 14 })).toBe('2026-12-14')
  })
  it('addDays and formatCzDate', () => {
    expect(addDays('2026-12-15', 30)).toBe('2027-01-14')
    expect(formatCzDate('2026-11-30')).toBe('30. 11. 2026')
  })
})
