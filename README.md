# PDFViewer

A lightweight, mobile-friendly PDF viewer that runs entirely in the browser. No installs, no server, no build step — just open and read.

## Features

- **Drag & drop** to open any PDF, or click to browse
- **Recent files** — previously opened PDFs reopen instantly from browser storage
- **Continuous scroll** through all pages
- **Zoom** in/out (25%–400%) with buttons or `+`/`-` keys
- **Page navigation** — prev/next buttons, jump-to-page input
- **Table of contents** — sidebar built from the PDF's outline
- **Text search** — find across all pages, jump between results with highlights
- **Text highlights** — select any text to highlight it; save highlights per document
- **Dark mode** — flat dark UI, easy on the eyes

## Usage

**Open a PDF** — drag it onto the page or click "browse files"

**Toolbar** — visible on page 1, auto-hides when you scroll; move your mouse to the top of the screen to bring it back

| Action | How |
|---|---|
| Zoom in / out | `+` / `-` keys, or toolbar buttons |
| Next / previous page | Arrow keys, or toolbar buttons |
| Jump to page | Click the page number in the toolbar |
| Table of contents | Click the ☰ button |
| Search | Click 🔍 or press `Ctrl+F` / `Cmd+F` |
| Highlight text | Select text on the page |
| Save highlights | Click the 💾 button in the toolbar |
| Open new PDF | Click the 📄 button in the toolbar |

## Running locally

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Or use the VS Code Live Server extension.

## Deploying to GitHub Pages

1. Push to your `main` branch
2. Go to repo **Settings → Pages**
3. Set source to `main` / `(root)`
4. Your viewer will be live at `https://<username>.github.io/PDFViewer/`

## Tech

- Vanilla HTML/CSS/JavaScript — no framework, no build step
- [pdf.js](https://mozilla.github.io/pdf.js/) v3.11 via CDN for PDF rendering
- IndexedDB for recent files and saved highlights
