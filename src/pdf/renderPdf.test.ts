// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, test } from 'vitest'
import { diacriticsInvoice, fixtureInvoice } from '../test/fixtures'
import { renderInvoicePdf } from './renderPdf'

const fonts = {
  regular: new Uint8Array(readFileSync(fileURLToPath(new URL('./fonts/Roboto-Regular.ttf', import.meta.url)))),
  bold: new Uint8Array(readFileSync(fileURLToPath(new URL('./fonts/Roboto-Bold.ttf', import.meta.url)))),
}

async function expectSingleA4(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes)
  expect(doc.getPageCount()).toBe(1)
  const { width, height } = doc.getPage(0).getSize()
  expect(Math.abs(width - 595.28)).toBeLessThan(0.5)
  expect(Math.abs(height - 841.89)).toBeLessThan(0.5)
}

describe('renderInvoicePdf', () => {
  test('sets the document title to the invoice and the creator/producer to the app', async () => {
    const doc = await PDFDocument.load(await renderInvoicePdf(fixtureInvoice, fonts), { updateMetadata: false })
    expect(doc.getTitle()).toBe(`Faktura ${fixtureInvoice.number}`)
    expect(doc.getCreator()).toBe('Fakturka')
    expect(doc.getProducer()).toBe('Fakturka')
  })

  test('renders Czech diacritics in every field to a single A4 page', async () => {
    const bytes = await renderInvoicePdf(diacriticsInvoice, fonts)
    expect(bytes.length).toBeGreaterThan(1000)
    await expectSingleA4(bytes)
  })

  test('a 400-character text and a 120-character customer name stay on one page', async () => {
    const inv = {
      ...fixtureInvoice,
      text: { ...fixtureInvoice.text, text: 'Dlouhý text faktury '.repeat(20) },
      customer: { ...fixtureInvoice.customer, name: 'Příklad s.r.o. s velmi dlouhým názvem '.repeat(4).slice(0, 120) },
    }
    expect(inv.text.text).toHaveLength(400)
    expect(inv.customer.name).toHaveLength(120)
    await expectSingleA4(await renderInvoicePdf(inv, fonts))
  })

  test('null amount and hidden DIČ render', async () => {
    await expectSingleA4(await renderInvoicePdf({ ...fixtureInvoice, amount: null, showDic: false }, fonts))
  })
})
