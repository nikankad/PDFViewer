# PDFViewer

a really simple PDF viewer I made with the main functionality of color inversion to with reading at night more comfortable

## Running locally

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`. Any static file server works.

## Stack

- Vanilla HTML, CSS, and JavaScript — no framework, no build step
- [pdf.js](https://mozilla.github.io/pdf.js/) for PDF rendering
- IndexedDB for file and highlight storage
