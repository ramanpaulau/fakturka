# Print approach decision

PRINT_MODE = webview

## Observed result

Dialog visible (macOS, WKWebView, Tauri 2 dev build).

## Evidence

Spike: a 210x297 mm white div with the text "Tisk test ěščřžýáíéů", `@page { size: A4; margin: 0 }`, and a button hidden under `@media print`. The page called `window.print()` automatically 3 s after load.

- Run 1, default capabilities: `window.print()` returned without a JS exception, but the dev log showed `Unhandled rejection: webview.print not allowed. Permissions associated with this command: core:webview:allow-print`. No dialog could be confirmed (the first screenshot attempt failed with "could not create image from display").
- Run 2, after adding `"core:webview:allow-print"` to `src-tauri/capabilities/default.json`: no error in the log. A screenshot showed the Faktura window with the standard macOS print sheet open over the page (the "Tisk test ěščřžýáíéů" heading visible behind it). The sheet had a one-page preview ("Page 1 of 1"), Pages / Copies / Layout / Paper Handling options, a PDF menu, and Cancel / Print buttons. The printer showed "No Printer Selected".
- The preview thumbnail showed only the test text at the top left of a portrait page, with no visible header or footer lines. The thumbnail was too small to verify the exact paper size or margins.

## Decision

Use `window.print()` in the webview (`PRINT_MODE = webview`).

Requirements and caveats:

- The capability `core:webview:allow-print` must be added to `src-tauri/capabilities/default.json`. Without it, Tauri blocks the print call.
- The print stylesheet needs `@page { size: A4; margin: 0 }`, with the page content laid out at 210x297 mm.
- Not verified by the spike: exact A4 paper size in the dialog (the preview was too small to read), and Windows (WebView2). The user must confirm both on macOS (the Paper Size field, and no headers or footers in a real print or Save as PDF) and on Windows.
- If printing fails on either platform, the fallback is `PRINT_MODE = pdf-viewer`: open the saved PDF with `@tauri-apps/plugin-opener` `openPath` and show a toast telling the user to print from the viewer. Later code will expose both paths behind one constant, so switching is a one-line change.
