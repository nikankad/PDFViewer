# PDFViewer

## Overview
A lightweight, mobile-first PDF viewer web app with a flat dark mode aesthetic. Designed to run on GitHub Pages with zero server-side dependencies. Optimized for performance on both desktop and mobile devices.

## Tech Stack
- **HTML/CSS/JavaScript** — vanilla, no framework (maximum portability and minimal bundle size)
- **PDF Rendering**: `pdf.js` (Mozilla, loaded via CDN)
- **Deployment**: GitHub Pages (static files only)
- **No build step** — files served as-is

## Core Features

### Implemented
1. **Drag-and-drop upload** — drop PDF onto page or click to browse
2. **Continuous scroll page rendering** — all pages stacked via pdf.js canvas + text layer
3. **Zoom controls** — zoom in/out buttons (+/- keyboard shortcuts), 25%–400%
4. **Page navigation** — prev/next buttons, jump-to-page input, scroll tracking
5. **Table of Contents** — sidebar with PDF outline/bookmarks, hidden by default
6. **Text search** — find text across all pages, jump between results

### Planned
7. **Text highlighting** — select and highlight text in PDFs

### Future Enhancements
- Annotations/notes
- Bookmark pages
- Export highlighted text
- Multiple PDF handling
- Offline caching (Service Worker)

## Design System

### Colors (Flat Dark Mode)
```
Background:     #1a1a1a (near-black)
Surface:        #2d2d2d (dark gray panels)
Text Primary:   #e8e8e8 (light gray)
Text Secondary: #b0b0b0 (muted gray)
Accent:         #4da6ff (cool blue for highlights/buttons)
Border:         #444444 (subtle dividers)
```

### Typography
- Display/Headings: System sans-serif (`-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`)
- Body: Same system stack
- No decorative fonts — clarity and legibility first

### Component Philosophy
- Flat, no shadows or gradients
- Generous padding/spacing for touch targets on mobile (min 44px)
- High contrast ratios for accessibility
- Minimal visual noise

## Architecture

```
/
├── index.html          (main entry point, PDF.js script tag)
├── styles.css          (flat dark mode, responsive layout)
├── app.js              (core app logic, event handlers)
├── pdf-handler.js      (pdf.js wrapper, page rendering)
├── ui.js               (DOM updates, sidebar, controls)
└── README.md           (user-facing docs)
```

## Mobile Considerations
- **Viewport meta tag** set for mobile optimization
- **Touch gestures** — pinch to zoom (if feasible with pdf.js)
- **Responsive layout** — single column on phone, sidebar on desktop (CSS Grid/Flexbox)
- **Performance** — lazy page rendering, canvas caching to minimize redraws
- **File size** — pdf.js core is ~100KB gzipped; acceptable for mobile

## Development

### Run Locally
```bash
# Option 1: Simple HTTP server
python3 -m http.server 8000
# Visit http://localhost:8000

# Option 2: VS Code Live Server extension
# Right-click index.html → Open with Live Server
```

### Deploy to GitHub Pages
1. Push code to `main` branch (or `gh-pages` branch)
2. Enable GitHub Pages in repo settings
3. Select branch to deploy from
4. Site live at `https://username.github.io/PDFViewer/`

### Testing
- Test on real mobile device (not just browser DevTools)
- Test with various PDF sizes (small, large, many pages)
- Verify zoom/search/TOC work smoothly on low-end phones

## Dependencies
- **pdf.js** (v3.x) — loaded from CDN (`https://cdn.jsdelivr.net/npm/pdfjs-dist@...`)
- No npm, no build tools, no dependencies to install

## Notes for Future Work
- Keep bundle minimal — every KB matters on mobile
- pdf.js has a large codebase; consider lazy-loading only what's needed
- Test on 3G/4G network conditions
- Accessibility (WCAG 2.1 AA) should be baked in from the start
