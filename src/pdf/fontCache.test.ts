// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { fixtureInvoice } from '../test/fixtures'
import { renderInvoicePdf } from './renderPdf'

const ttf = (name: string) => readFileSync(fileURLToPath(new URL(`./fonts/${name}`, import.meta.url)))

afterEach(() => {
  vi.unstubAllGlobals()
})

// The bundled fonts are cached at module level, so these tests run in order in one module.
describe('renderInvoicePdf without fonts', () => {
  test('a failed font fetch rejects and is not cached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))
    await expect(renderInvoicePdf(fixtureInvoice)).rejects.toThrow(/HTTP 404/)
  })

  test('fetches the bundled fonts once and reuses them', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      new Response(new Uint8Array(ttf(String(url).includes('Bold') ? 'Roboto-Bold.ttf' : 'Roboto-Regular.ttf'))))
    vi.stubGlobal('fetch', fetchMock)
    const a = await renderInvoicePdf(fixtureInvoice)
    const b = await renderInvoicePdf(fixtureInvoice)
    expect(a.length).toBeGreaterThan(1000)
    expect(b.length).toBeGreaterThan(1000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
