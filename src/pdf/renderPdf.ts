import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { Invoice } from '../domain/types'
import { sheetContent } from '../sheet/content'
import { A4, INNER, LAYOUT, baselineMm, belowHeading, lineMm, mmToPt, ptToMm, rowTop, type Box } from '../sheet/layout'
import { fitParagraphs, type Para } from './wrap'
import regularUrl from './fonts/Roboto-Regular.ttf?url'
import boldUrl from './fonts/Roboto-Bold.ttf?url'

export type PdfFonts = { regular: Uint8Array; bold: Uint8Array }

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Font ${url}: HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

let bundledFonts: Promise<PdfFonts> | null = null

/** Fetches the bundled TTFs once per session; a failed fetch is not cached, so the next save retries. */
function loadBundledFonts(): Promise<PdfFonts> {
  bundledFonts ??= Promise.all([fetchBytes(regularUrl), fetchBytes(boldUrl)]).then(
    ([regular, bold]) => ({ regular, bold }),
    (e: unknown) => {
      bundledFonts = null
      throw e
    },
  )
  return bundledFonts
}

const BLACK = rgb(0, 0, 0)
// The sheet CSS disables ligatures and kerning too, so wrapping matches on screen and on paper.
const NO_LIGATURES = { liga: false, kern: false }
type Align = 'left' | 'right' | 'center'

class Painter {
  constructor(
    private page: PDFPage,
    private regular: PDFFont,
    private bold: PDFFont,
  ) {}

  font = (bold: boolean) => (bold ? this.bold : this.regular)

  /** Width in mm. */
  width = (s: string, size: number, bold: boolean) => ptToMm(this.font(bold).widthOfTextAtSize(s, size))

  /** Draws `s` with the top of its CSS line box at `top` mm; `x` is the left, right or centre edge. */
  text(s: string, x: number, top: number, size: number, bold = false, align: Align = 'left') {
    if (!s) return
    const w = this.width(s, size, bold)
    const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x
    this.page.drawText(s, {
      x: mmToPt(left),
      y: this.page.getHeight() - mmToPt(top + baselineMm(size)),
      size,
      font: this.font(bold),
      color: BLACK,
    })
  }

  rule(y: number, x1: number, x2: number) {
    const py = this.page.getHeight() - mmToPt(y)
    this.page.drawLine({ start: { x: mmToPt(x1), y: py }, end: { x: mmToPt(x2), y: py }, thickness: INNER.ruleWidth, color: BLACK })
  }

  /** Wraps and shrinks paragraphs into `box` exactly like the sheet's `.fit` elements. */
  fitted(paras: Para[], box: Box, base: number) {
    const { size, lines } = fitParagraphs(paras, box.w, box.h, this.width, { base, lineHeight: LAYOUT.lineHeight })
    lines.forEach((l, i) => this.text(l.text, box.x, box.y + i * lineMm(size), size, l.bold))
  }
}

export async function renderInvoicePdf(inv: Invoice, fonts?: PdfFonts): Promise<Uint8Array> {
  const f = fonts ?? (await loadBundledFonts())
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const regular = await doc.embedFont(f.regular, { subset: true, features: NO_LIGATURES })
  const bold = await doc.embedFont(f.bold, { subset: true, features: NO_LIGATURES })
  doc.setTitle(`Faktura ${inv.number}`)
  doc.setLanguage('cs-CZ')
  doc.setCreator('Fakturka')
  doc.setProducer('Fakturka')

  const page = doc.addPage([mmToPt(A4.w), mmToPt(A4.h)])
  const p = new Painter(page, regular, bold)
  const c = sheetContent(inv)
  const L = LAYOUT
  const { base, title, label } = L.fontSize

  for (const y of INNER.rules) p.rule(y, L.margin, A4.w - L.margin)

  // Header: title left, "Číslo: …" right, sharing the title's baseline.
  const h = L.header
  p.text(c.title, h.x, h.y, title, true)
  const numTop = h.y + baselineMm(title) - baselineMm(INNER.numberSize)
  const numW = p.width(c.number, INNER.numberSize, true)
  p.text(c.number, h.x + h.w, numTop, INNER.numberSize, true, 'right')
  p.text(c.numberLabel, h.x + h.w - numW, numTop, INNER.numberSize, false, 'right')

  // Supplier / customer
  for (const [box, heading, paras] of [
    [L.supplier, c.supplierLabel, c.supplier],
    [L.customer, c.customerLabel, c.customer],
  ] as const) {
    p.text(heading, box.x, box.y, label, true)
    p.fitted(paras, belowHeading(box), base)
  }

  // Payment terms and dates: label column + single-line fitted value
  p.text(c.paymentLabel, L.payment.x, L.payment.y, label, true)
  for (const [box, rows, col] of [
    [L.payment, c.payment, INNER.labelCol.payment],
    [L.dates, c.dates, INNER.labelCol.dates],
  ] as const) {
    rows.forEach(([k, v], i) => {
      const top = rowTop(box, i)
      p.text(k, box.x, top, base)
      p.fitted([{ text: v }], { x: box.x + col, y: top, w: box.w - col, h: lineMm(base) }, base)
    })
  }

  // Text + amount
  p.fitted([{ text: c.text }], L.text, base)

  // Footer: VAT note left, total right, on one baseline
  const ft = L.footer
  const rowTopY = ft.y + INNER.footerRowTop
  const baseline = rowTopY + baselineMm(INNER.totalSize)
  p.text(c.vatNote, ft.x, baseline - baselineMm(base), base)
  const totalW = p.width(c.total, INNER.totalSize, true)
  p.text(c.total, ft.x + ft.w, baseline - baselineMm(INNER.totalSize), INNER.totalSize, true, 'right')
  p.text(c.totalLabel, ft.x + ft.w - totalW, baseline - baselineMm(INNER.totalSize), INNER.totalSize, false, 'right')

  // Signature lines
  const s = INNER.sign
  c.signLabels.forEach((txt, i) => {
    const x = i === 0 ? s.left : s.right
    p.rule(s.lineY, x, x + s.w)
    p.text(txt, x + s.w / 2, s.lineY + s.labelGap, label, false, 'center')
  })

  return doc.save()
}
