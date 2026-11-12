export function isNumberTaken(n: string, taken: Set<string>): boolean {
  return taken.has(n)
}

/** YYYYMM, then YYYYMM02, YYYYMM03, ... for further invoices in the same month. */
export function suggestNumber(issueDate: string, taken: Set<string>): string {
  const base = issueDate.slice(0, 7).replace('-', '')
  if (!isNumberTaken(base, taken)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}${String(n).padStart(2, '0')}`
    if (!isNumberTaken(candidate, taken)) return candidate
  }
}
