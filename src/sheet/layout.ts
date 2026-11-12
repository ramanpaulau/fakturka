// Single source of truth for the invoice page geometry. All values are millimetres,
// origin top-left. The on-screen sheet uses them as CSS `mm`, the PDF via `mmToPt`.

export const A4 = { w: 210, h: 297 }

export type Box = { x: number; y: number; w: number; h: number }

export const mmToPt = (mm: number) => (mm * 72) / 25.4
export const ptToMm = (pt: number) => (pt * 25.4) / 72

export const LAYOUT = {
  margin: 15,
  header: { x: 15, y: 15, w: 180, h: 14 },
  supplier: { x: 15, y: 38, w: 85, h: 52 },
  customer: { x: 110, y: 38, w: 85, h: 52 },
  payment: { x: 15, y: 100, w: 105, h: 30 },
  dates: { x: 130, y: 100, w: 65, h: 30 },
  text: { x: 15, y: 140, w: 180, h: 80 },
  footer: { x: 15, y: 232, w: 180, h: 50 },
  /** pt */
  fontSize: { base: 10, title: 24, label: 8 },
  /** multiple of the font size */
  lineHeight: 1.35,
}

/** Secondary geometry derived from the boxes above (mm unless noted). */
export const INNER = {
  /** height of a section label ("Dodavatel", "Platební podmínky") incl. the gap below it */
  headingH: 6,
  /** pt: "Číslo: …" in the header and "Cena celkem: …" in the footer */
  numberSize: 12,
  totalSize: 13,
  /** offset of the footer's first row below the footer box top */
  footerRowTop: 0,
  /** width of the label column in the payment and dates boxes */
  labelCol: { payment: 36, dates: 32 },
  /** Podpis / Razítko signature lines */
  sign: { lineY: 274, w: 60, left: 15, right: 135, labelGap: 1 },
  /** y of the thin horizontal rules spanning the content width */
  rules: [33, 95, 135, 228],
  /** pt */
  ruleWidth: 0.5,
  minFontSize: 7,
  fontStep: 0.5,
}

// Roboto vertical metrics (hhea, units per em 2048). Browsers centre the glyph box
// in the CSS line box; the PDF has to place the baseline at the same spot.
const ASCENT = 1900 / 2048
const DESCENT = 500 / 2048

/** Height of one line of text at `sizePt`, in mm. */
export const lineMm = (sizePt: number) => ptToMm(sizePt * LAYOUT.lineHeight)

/** Distance from the top of a CSS line box to the baseline, in mm. */
export const baselineMm = (sizePt: number) =>
  ptToMm(sizePt * ((LAYOUT.lineHeight - ASCENT - DESCENT) / 2 + ASCENT))

/** Top of the n-th row in a payment/dates box. */
export const rowTop = (box: Box, n: number) => box.y + INNER.headingH + n * lineMm(LAYOUT.fontSize.base)

/** The area of a party box below its heading, which holds the fitted paragraphs. */
export const belowHeading = (box: Box): Box => ({ x: box.x, y: box.y + INNER.headingH, w: box.w, h: box.h - INNER.headingH })
