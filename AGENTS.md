# PDFViewer Agent Notes

## Run And Verify
- Local dev is a static server only: `python3 -m http.server 8000`, then open `http://localhost:8000`.
- There is no build step and `package.json` defines no npm scripts; do not invent `npm test`, `npm run build`, or lint commands.
- Focused JS syntax check: `node --check app.js`, `node --check ui.js`, `node --check storage.js`, `node --check pdf-handler.js`.
- Visual/browser verification matters for PDF loading, drag/drop, IndexedDB persistence, and responsive layout because there is no automated test suite.

## Architecture
- `index.html` is the app shell and controls script order: pdf.js CDN, then `storage.js`, `pdf-handler.js`, `ui.js`, `app.js`.
- `app.js` wires events and coordinates file open, recent-file rendering, search, zoom, highlights, and settings.
- `ui.js` owns DOM construction and UI state helpers; keep markup changes there unless the static shell itself changes.
- `pdf-handler.js` is the pdf.js wrapper for document loading, lazy page rendering, text search/highlights, and cover thumbnail rendering.
- `storage.js` is the persistence layer: PDFs/covers/tags in IndexedDB, highlights in a separate IndexedDB store, settings in `localStorage`.

## Theme And UI Direction
- Preserve the dark, flat visual style; avoid brown/wood bookshelf styling or skeuomorphic textures.
- The upload screen is a library layout: recent PDFs/bookcase on the left and the PDF drop zone on the right.
- Recent PDFs display first-page cover thumbnails, tags, and tag search; avoid replacing this with a plain file list.
- Keep the layout responsive: desktop uses side-by-side library/drop zone, while small screens stack naturally.

## Repo-Specific Gotchas
- Runtime pdf.js is loaded from jsDelivr in `index.html`; `package-lock.json` exists, but the browser app does not import `node_modules` directly.
- The CSP in `index.html` must allow any new script, worker, image, font, or network source you introduce.
- IndexedDB database name is `pdfviewer`; schema version is `DB_VERSION` in `storage.js`. Bump it only when object stores/indexes need migration.
- Recent PDF covers are stored as data URLs on file records; avoid regenerating covers unless the record has no `cover`.
- `Storage.saveFile()` preserves an existing file's `cover` and `tags` when reopening the same PDF; keep that behavior when touching save logic.
- Page rendering is lazy via `IntersectionObserver`; avoid eager full-document canvas rendering for large PDFs.
