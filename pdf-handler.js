// Manages pdf.js document loading and per-page rendering

const PDFHandler = (() => {
  let _pdfDoc = null;
  let _scale = 1.0;
  let _renderTasks = {};

  async function load(arrayBuffer) {
    if (_pdfDoc) {
      _pdfDoc.destroy();
      _pdfDoc = null;
    }
    _pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    return _pdfDoc;
  }

  function getDoc() { return _pdfDoc; }
  function getPageCount() { return _pdfDoc ? _pdfDoc.numPages : 0; }
  function getScale() { return _scale; }
  function setScale(s) { _scale = Math.max(0.25, Math.min(4.0, s)); }

  async function renderPage(pageNum, canvas, textLayerDiv) {
    if (!_pdfDoc) return;

    // Cancel any in-flight render for this page
    if (_renderTasks[pageNum]) {
      try { _renderTasks[pageNum].cancel(); } catch (_) {}
    }

    const page = await _pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: _scale });

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = Math.floor(viewport.width) + 'px';
    canvas.style.height = Math.floor(viewport.height) + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const renderTask = page.render({ canvasContext: ctx, viewport });
    _renderTasks[pageNum] = renderTask;

    try {
      await renderTask.promise;
    } catch (err) {
      if (err?.name !== 'RenderingCancelledException') throw err;
      return;
    }

    // Text layer
    if (textLayerDiv) {
      textLayerDiv.innerHTML = '';
      textLayerDiv.style.width = Math.floor(viewport.width) + 'px';
      textLayerDiv.style.height = Math.floor(viewport.height) + 'px';
      const textContent = await page.getTextContent();
      pdfjsLib.renderTextLayer({
        textContent,
        container: textLayerDiv,
        viewport,
        textDivs: [],
      });
    }
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

  // Simple text search across all pages — returns [{page, matches}]
  async function search(query) {
    if (!_pdfDoc || !query.trim()) return [];
    const results = [];
    const q = query.toLowerCase();
    for (let i = 1; i <= _pdfDoc.numPages; i++) {
      const page = await _pdfDoc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map(it => it.str).join('');
      let idx = -1;
      const matches = [];
      let pos = 0;
      while ((idx = text.toLowerCase().indexOf(q, pos)) !== -1) {
        matches.push(idx);
        pos = idx + 1;
      }
      if (matches.length) results.push({ page: i, count: matches.length });
    }
    return results;
  }

  return { load, getDoc, getPageCount, getScale, setScale, renderPage, getOutline, getPageForDest, search };
})();
