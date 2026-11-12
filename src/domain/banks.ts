/**
 * Czech bank codes (the 4 digits after "/" in an account number) with short everyday names.
 * Source: ČNB "Číselník kódů platebního styku" (kody_bank_CR.csv, valid from 1. 7. 2026); a bank in liquidation is left out.
 * The most common banks come first: their order is the order of the suggestions in the "Banka" field.
 */
export const BANKS: readonly { code: string; name: string }[] = [
  { code: '0800', name: 'Česká spořitelna' },
  { code: '0100', name: 'Komerční banka' },
  { code: '0300', name: 'ČSOB' },
  { code: '2010', name: 'Fio banka' },
  { code: '3030', name: 'Air Bank' },
  { code: '5500', name: 'Raiffeisenbank' },
  { code: '0600', name: 'MONETA Money Bank' },
  { code: '2700', name: 'UniCredit Bank' },
  { code: '6210', name: 'mBank' },
  { code: '2250', name: 'Banka CREDITAS' },
  { code: '6363', name: 'Partners Banka' },
  { code: '5800', name: 'J&T Banka' },
  { code: '6000', name: 'PPF banka' },
  { code: '2100', name: 'ČSOB Hypoteční banka' },
  { code: '0710', name: 'Česká národní banka' },
  { code: '2060', name: 'Citfin' },
  { code: '2070', name: 'TRINITY BANK' },
  { code: '2200', name: 'Peněžní dům' },
  { code: '2220', name: 'Artesa' },
  { code: '2600', name: 'Citibank' },
  { code: '3060', name: 'PKO BP' },
  { code: '3500', name: 'ING Bank' },
  { code: '4300', name: 'Národní rozvojová banka' },
  { code: '6200', name: 'Commerzbank' },
  { code: '6300', name: 'BNP Paribas' },
  { code: '6600', name: 'Banking Circle' },
  { code: '6700', name: 'Všeobecná úverová banka' },
  { code: '7910', name: 'Deutsche Bank' },
  { code: '7950', name: 'Raiffeisen stavební spořitelna' },
  { code: '7960', name: 'ČSOB Stavební spořitelna' },
  { code: '7970', name: 'MONETA Stavební Spořitelna' },
  { code: '7990', name: 'Modrá pyramida' },
  { code: '8030', name: 'Volksbank Raiffeisenbank Nordoberpfalz' },
  { code: '8040', name: 'Oberbank' },
  { code: '8060', name: 'Stavební spořitelna České spořitelny' },
  { code: '8090', name: 'Česká exportní banka' },
  { code: '8150', name: 'HSBC' },
  { code: '8198', name: 'FAS finance company' },
  { code: '8220', name: 'Payment execution' },
  { code: '8250', name: 'Bank of China' },
  { code: '8255', name: 'Bank of Communications' },
  { code: '8265', name: 'ICBC' },
  { code: '8500', name: 'Multitude Bank' },
  { code: '8610', name: 'Devizová burza' },
  { code: '8620', name: 'Comgate' },
  { code: '8660', name: 'PAYMONT' },
]

const BY_CODE = new Map(BANKS.map(b => [b.code, b.name]))
const fold = (s: string) => s.trim().toLocaleLowerCase('cs')
const BY_NAME = new Map(BANKS.map(b => [fold(b.name), b.code]))

/** The bank code of an account number ("19-123456789/0800" → "0800"), or null when there is no "/" followed by 4 digits. */
export function bankCodeOf(account: string): string | null {
  const m = /\/\s*(\d{4})\s*$/.exec(account)
  return m ? m[1] : null
}

export function bankNameFor(code: string): string | null {
  return BY_CODE.get(code) ?? null
}

/** The code of a bank name from the list (case-insensitive), or null for any other text. */
export function bankCodeForName(name: string): string | null {
  return BY_NAME.get(fold(name)) ?? null
}

type BankPair = { bank: string; account: string }

/**
 * After the account number was edited: a known bank code fills in the bank name, unless the user wrote a name of their
 * own (one not in the list). Only this direction: a bank name typed letter by letter passes through other names
 * ("ČSOB" on the way to "ČSOB Hypoteční banka"), so it never changes the account.
 */
export function linkBank<T extends BankPair>(prev: T, next: T): T {
  if (next.account === prev.account) return next
  const name = bankNameFor(bankCodeOf(next.account) ?? '')
  const own = next.bank.trim() !== '' && bankCodeForName(next.bank) === null
  return name && !own ? { ...next, bank: name } : next
}
