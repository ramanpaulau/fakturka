/** Validates a Czech IČO: 8 digits, last one is a mod-11 check digit. Whitespace is ignored. */
export function isValidIco(ico: string): boolean {
  const s = ico.replace(/\s+/g, '')
  if (!/^\d{8}$/.test(s)) return false
  let sum = 0
  for (let i = 0; i < 7; i++) sum += Number(s[i]) * (8 - i)
  const check = (11 - (sum % 11)) % 10
  return check === Number(s[7])
}
