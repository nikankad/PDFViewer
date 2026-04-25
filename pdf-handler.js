// Manages pdf.js document loading and per-page rendering

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/build/pdf.worker.min.mjs';

const PDFHandler = (() => {
  let _pdfDoc = null;
  let _scale = 1.0;
  let _renderTasks = {};
  let _textCache = {};      // pageNum -> {items, viewport}
  let _userHighlights = {}; // pageNum -> [{x, y, w, h, color}] at scale=1
  let _highlightColor = 'rgba(255, 210, 0, 0.28)';

  async function load(arrayBuffer) {
    if (_pdfDoc) {
      _pdfDoc.destroy();
      _pdfDoc = null;
    }
    _textCache = {};
    _userHighlights = {};
    _pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    return _pdfDoc;
  }

  function getDoc() { return _pdfDoc; }
  function getPageCount() { return _pdfDoc ? _pdfDoc.numPages : 0; }
  function getScale() { return _scale; }
  function setScale(s) { _scale = Math.max(0.25, Math.min(4.0, s)); }

  // Compute scale so page 1 fills the available viewport width
  async function fitToWidth(availableWidth) {
    if (!_pdfDoc) return;
    const page = await _pdfDoc.getPage(1);
    const naturalViewport = page.getViewport({ scale: 1.0 });
    setScale(availableWidth / naturalViewport.width);
  }

  async function renderPage(pageNum, canvas, textLayerDiv) {
    if (!_pdfDoc) return;

    // Cancel any in-flight render for this page
    if (_renderTasks[pageNum]) {
      try { _renderTasks[pageNum].cancel(); } catch (_) {}
    }

    const page = await _pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: _scale });

    const dpr = window.devicePixelRatio || 1;
    const outputScale = Math.max(dpr, 3);
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = Math.floor(viewport.width) + 'px';
    canvas.style.height = Math.floor(viewport.height) + 'px';

    const ctx = canvas.getContext('2d');
    const transform = [outputScale, 0, 0, outputScale, 0, 0];

    const renderTask = page.render({ canvasContext: ctx, viewport, transform });
    _renderTasks[pageNum] = renderTask;

    try {
      await renderTask.promise;
    } catch (err) {
      if (err?.name !== 'RenderingCancelledException') throw err;
      return;
    }

    // Text layer (native PDF.js TextLayer API)
    _textCache[pageNum] = { items: [], viewport };

    if (textLayerDiv) {
      textLayerDiv.innerHTML = '';
      textLayerDiv.style.width = Math.floor(viewport.width) + 'px';
      textLayerDiv.style.height = Math.floor(viewport.height) + 'px';
      const textLayer = new pdfjsLib.TextLayer({
        textContentSource: page.streamTextContent({
          includeMarkedContent: true,
          disableNormalization: true,
        }),
        container: textLayerDiv,
        viewport,
      });
      await textLayer.render();
    }
  }

  async function getPageDimensions(pageNum) {
    if (!_pdfDoc) return null;
    const page = await _pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: _scale });
    return { width: Math.floor(viewport.width), height: Math.floor(viewport.height) };
  }

  async function renderCover(width = 96) {
    if (!_pdfDoc) return null;
    const page = await _pdfDoc.getPage(1);
    const naturalViewport = page.getViewport({ scale: 1.0 });
    const scale = width / naturalViewport.width;
    const viewport = page.getViewport({ scale });
    const dpr = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvasContext: ctx,
      viewport,
      transform: [dpr, 0, 0, dpr, 0, 0],
    }).promise;
    return canvas.toDataURL('image/jpeg', 0.82);
  }

  async function getOutline() {
    if (!_pdfDoc) return [];
    return (await _pdfDoc.getOutline()) || [];
  }

  async function getPageForDest(dest) {
    if (!_pdfDoc || !dest) return null;
    let ref;
    if (typeof dest === 'string') {
      const resolved = await _pdfDoc.getDestination(dest);
      if (!resolved) return null;
      ref = resolved[0];
    } else {
      ref = dest[0];
    }
    return await _pdfDoc.getPageIndex(ref) + 1;
  }

  // Simple text search across all pages — returns [{page, count}]
  async function search(query) {
    if (!_pdfDoc || !query.trim()) return [];
    const results = [];
    const q = query.toLowerCase();
    for (let i = 1; i <= _pdfDoc.numPages; i++) {
      const page = await _pdfDoc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map(it => it.str).join('');
      let count = 0, pos = 0, idx;
      while ((idx = text.toLowerCase().indexOf(q, pos)) !== -1) { count++; pos = idx + 1; }
      if (count) results.push({ page: i, count });
    }
    return results;
  }

  // Draw highlight rects onto the hl-layer canvas for all matches of query on pageNum.
  // Uses the rendered text layer DOM so the browser's layout engine handles all transforms.
  function highlightPage(pageNum, hlCanvas, query) {
    const cached = _textCache[pageNum];
    if (!hlCanvas || !cached) return;

    const { viewport } = cached;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(viewport.width);
    const h = Math.floor(viewport.height);

    hlCanvas.width  = w * dpr;
    hlCanvas.height = h * dpr;
    hlCanvas.style.width  = w + 'px';
    hlCanvas.style.height = h + 'px';

    const ctx = hlCanvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    if (!query || !query.trim()) return;

    const wrapper = document.querySelector(`.page-wrapper[data-page="${pageNum}"]`);
    if (!wrapper) return;
    const textLayer = wrapper.querySelector('.textLayer');
    if (!textLayer) return;

    const pageRect = wrapper.getBoundingClientRect();
    ctx.fillStyle = 'rgba(255, 210, 0, 0.45)';
    const q = query.toLowerCase();

    for (const span of textLayer.querySelectorAll('span')) {
      const node = span.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) continue;
      const text = node.nodeValue;
      const textLower = text.toLowerCase();
      let pos = 0, idx;
      while ((idx = textLower.indexOf(q, pos)) !== -1) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + q.length);
        for (const r of range.getClientRects()) {
          ctx.fillRect(r.left - pageRect.left, r.top - pageRect.top, r.width, r.height);
        }
        pos = idx + 1;
      }
    }
  }

  function setHighlightColor(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    _highlightColor = `rgba(${r}, ${g}, ${b}, 0.28)`;
  }

  function getHighlightColorHex() {
    return _highlightColor;
  }

  // Add highlights from a DOM selection.
  // selRects: array of {left, top, right, bottom} in CSS pixels relative to the page at current scale.
  // Coords are normalized to scale=1 for storage so they redraw correctly after zoom.
  // Returns true if any highlights were added.
  function highlightFromSelection(pageNum, selRects) {
    if (!selRects.length) return false;

    const toAdd = selRects
      .filter(r => (r.right - r.left) > 1 && (r.bottom - r.top) > 1)
      .map(r => ({
        x: r.left              / _scale,
        y: r.top               / _scale,
        w: (r.right  - r.left) / _scale,
        h: (r.bottom - r.top)  / _scale,
        color: _highlightColor,
      }));

    if (!toAdd.length) return false;

    if (!_userHighlights[pageNum]) _userHighlights[pageNum] = [];
    _userHighlights[pageNum].push(...toAdd);
    return true;
  }

  // Add a persistent user highlight rect (coords at scale=1 in CSS pixels)
  function addHighlight(pageNum, rect) {
    if (!_userHighlights[pageNum]) _userHighlights[pageNum] = [];
    _userHighlights[pageNum].push({ ...rect, color: _highlightColor });
  }

  function getHighlights() {
    return _userHighlights;
  }

  function setHighlights(data) {
    _userHighlights = data || {};
  }

  function clearHighlights() {
    _userHighlights = {};
  }

  // Draw user highlights onto the user-hl-layer canvas for a given page
  function drawUserHighlights(pageNum, userHlCanvas) {
    if (!userHlCanvas) return;
    const cached = _textCache[pageNum];
    if (!cached) return;

    const highlights = _userHighlights[pageNum] || [];
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(cached.viewport.width);
    const h = Math.floor(cached.viewport.height);

    userHlCanvas.width  = w * dpr;
    userHlCanvas.height = h * dpr;
    userHlCanvas.style.width  = w + 'px';
    userHlCanvas.style.height = h + 'px';

    const ctx = userHlCanvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    for (const hl of highlights) {
      ctx.fillStyle = hl.color;
      ctx.fillRect(hl.x * _scale, hl.y * _scale, hl.w * _scale, hl.h * _scale);
    }
  }

  return { load, getDoc, getPageCount, getScale, setScale, fitToWidth, renderPage, renderCover, getPageDimensions, getOutline, getPageForDest, search, highlightPage, highlightFromSelection, addHighlight, getHighlights, setHighlights, clearHighlights, drawUserHighlights, setHighlightColor, getHighlightColorHex };
})();
