import type { Invoice } from '../domain/types'

/** Fake data only. */
export const fixtureInvoice: Invoice = {
  schemaVersion: 1,
  number: '202611',
  issueDate: '2026-11-30',
  dueDate: '2026-12-15',
  supplier: {
    sourceId: null,
    name: 'Jan Novák',
    street: 'Dlouhá 12',
    city: '110 00 Praha',
    ico: '12345679',
    dic: 'CZ12345679',
    note: 'Fyzická osoba zapsaná v živnostenském rejstříku',
  },
  customer: {
    sourceId: null,
    name: 'Příklad s.r.o.',
    street: 'Krátká 5',
    city: '602 00 Brno',
    ico: '87654321',
    dic: 'CZ87654321',
    note: '',
  },
  payment: { sourceId: null, method: 'Převodem', bank: 'Fiktivní banka', account: '123456789/0100' },
  text: { sourceId: null, text: 'Fakturuji Vám za vývoj softwaru v listopadu 2026' },
  amount: 42000,
  showDic: true,
  savedAt: null,
}

const CZ = 'ěščřžýáíéůúťďňĚŠČŘŽÝÁÍÉŮÚŤĎŇ'

/** Czech diacritics in every text field. */
export const diacriticsInvoice: Invoice = {
  ...fixtureInvoice,
  number: '202611ě',
  supplier: { sourceId: null, name: `Jan Novák ${CZ}`, street: `Dlouhá 12 ${CZ}`, city: `110 00 Praha ${CZ}`, ico: '12345679', dic: `CZ12345679 ${CZ}`, note: `Poznámka ${CZ}` },
  customer: { sourceId: null, name: `Příklad s.r.o. ${CZ}`, street: `Krátká 5 ${CZ}`, city: `602 00 Brno ${CZ}`, ico: '87654321', dic: `CZ87654321 ${CZ}`, note: '' },
  payment: { sourceId: null, method: `Převodem ${CZ}`, bank: `Fiktivní banka ${CZ}`, account: '123456789/0100' },
  text: { sourceId: null, text: `Vývoj softwaru ${CZ}` },
}
