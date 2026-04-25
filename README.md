# PDFViewer

A fast, minimal PDF viewer that runs entirely in your browser. No accounts, no installs, no uploads. Just open a file and read.

## Motivation

Most PDF readers are bloated, paywalled, or quietly uploading your documents to a server somewhere. The free ones tend to be clunky, and almost none of them have a proper dark mode. I built PDFViewer to fix all of that: a clean, fast reader that respects your privacy and doesn't cost anything.

## Features

- Drag and drop any PDF to open it instantly
- Recent files reopen in one click, stored locally in your browser
- Continuous scroll through all pages
- Text search across the entire document with highlighted results
- Select text to highlight it, and save highlights per document
- Table of contents sidebar built from the PDF's outline
- Zoom from 25% to 400%, fit-to-width, and per-document zoom memory
- Dark mode for comfortable reading
- Works on desktop and mobile

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Next / previous page | `]` / `[` or arrow keys |
| First / last page | `Home` / `End` |
| Zoom in / out | `+` / `-` |
| Reset zoom | `Ctrl+0` |
| Fit to width | `F` |
| Search | `Ctrl+F` |
| Toggle contents | `Ctrl+T` |
| Toggle dark mode | `Ctrl+D` |
| Close panel | `Esc` |

## Planned features

The goal is to keep this simple and focused, but there are a few things on the roadmap:

- Note taking and annotations
- Bookmarks
- Better mobile gestures
- Page thumbnails sidebar

Have a suggestion? Drop it in the Issues tab.

## Privacy

Everything runs locally in your browser. Your files are never uploaded anywhere.

- PDF files and highlights are stored in your browser's IndexedDB
- Settings are stored in localStorage
- The only external request is loading the pdf.js rendering library from a CDN. Your PDF content is never transmitted

To clear stored data, use **Settings → Clear recent files** or **Clear all highlights**, or clear your browser's site data for this page.

## Running locally

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`. Any static file server works.

## Deploying to GitHub Pages

1. Push to your `main` branch
2. Go to **Settings → Pages**
3. Set source to `main / (root)`
4. Your viewer will be live at `https://<username>.github.io/PDFViewer/`

## Stack

- Vanilla HTML, CSS, and JavaScript (no framework, no build step)
- [pdf.js](https://mozilla.github.io/pdf.js/) for PDF rendering, loaded via CDN with subresource integrity (SRI) verification
- IndexedDB for file and highlight storage
- Content Security Policy (CSP) to restrict resource origins and prevent XSS
- Lazy page rendering so large PDFs load without crashing the browser
