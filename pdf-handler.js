// Manages pdf.js document loading and per-page rendering

const PDFHandler = (() => {
  let _pdfDoc = null;
  let _scale = 1.0;
  let _renderTasks = {};
  let _textCache = {};      // pageNum -> {items, viewport}
  let _userHighlights = {}; // pageNum -> [{x, y, w, h, color}] at scale=1
  let _highlightColor = 'rgba(255, 210, 0, 0.45)';

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
    const textContent = await page.getTextContent();
    _textCache[pageNum] = { items: textContent.items, viewport };

    if (textLayerDiv) {
      textLayerDiv.innerHTML = '';
      textLayerDiv.style.width = Math.floor(viewport.width) + 'px';
      textLayerDiv.style.height = Math.floor(viewport.height) + 'px';
      const renderResult = pdfjsLib.renderTextLayer({
        textContent,
        container: textLayerDiv,
        viewport,
        textDivs: [],
      });
      if (renderResult && renderResult.promise) {
        await renderResult.promise;
      }
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
  // Uses the cached textContent geometry — immune to span transform/scaleX distortion.
  function highlightPage(pageNum, hlCanvas, query) {
    const cached = _textCache[pageNum];
    if (!hlCanvas || !cached) return;

    const { items, viewport } = cached;
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

    const q = query.toLowerCase();

    // Build flat array of {char, itemIndex, charIndexInItem} for every char across all items
    // and the full concatenated string for searching
    const chars = [];
    let fullText = '';
    items.forEach((item, iIdx) => {
      const s = item.str || '';
      for (let c = 0; c < s.length; c++) {
        chars.push({ itemIndex: iIdx, charIndexInItem: c });
      }
      fullText += s;
    });

    // Find all match positions in the full text
    const matches = [];
    let pos = 0, idx;
    while ((idx = fullText.toLowerCase().indexOf(q, pos)) !== -1) {
      matches.push({ start: idx, end: idx + q.length });
      pos = idx + 1;
    }
    if (!matches.length) return;

    ctx.fillStyle = 'rgba(255, 210, 0, 0.45)';

    for (const { start, end } of matches) {
      // Group consecutive chars that belong to the same item
      let segStart = start;
      while (segStart < end) {
        const itemIdx = chars[segStart].itemIndex;
        let segEnd = segStart + 1;
        while (segEnd < end && chars[segEnd].itemIndex === itemIdx) segEnd++;

        const item = items[itemIdx];
        const itemStr = item.str || '';
        const itemCharCount = itemStr.length;
        if (!itemCharCount) { segStart = segEnd; continue; }

        // item.transform = [scaleX, 0, 0, scaleY, tx, ty] in PDF user space
        // viewport.convertToViewportPoint converts PDF coords to CSS pixel coords
        const [, , , scaleY, tx, ty] = item.transform;
        const fontHeight = Math.abs(scaleY);

        // Fraction of item width covered by this segment
        const charStart = chars[segStart].charIndexInItem;
        const charEnd   = chars[segEnd - 1].charIndexInItem + 1;
        const fracStart = charStart / itemCharCount;
        const fracEnd   = charEnd   / itemCharCount;

        // item.width is in PDF user space units
        const itemWidthPx = item.width * _scale;
        const segX = fracStart * itemWidthPx;
        const segW = (fracEnd - fracStart) * itemWidthPx;

        // Convert PDF origin (bottom-left) to canvas origin (top-left)
        const [vpx, vpy] = viewport.convertToViewportPoint(tx, ty);
        const fontHeightPx = fontHeight * _scale;

        ctx.fillRect(
          vpx + segX,
          vpy - fontHeightPx,
          segW,
          fontHeightPx * 1.1
        );

        segStart = segEnd;
      }
    }
  }

  function setHighlightColor(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    _highlightColor = `rgba(${r}, ${g}, ${b}, 0.45)`;
  }

  function getHighlightColorHex() {
    return _highlightColor;
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
    const highlights = _userHighlights[pageNum] || [];

    const dpr = window.devicePixelRatio || 1;
    let w, h;
    if (cached) {
      w = Math.floor(cached.viewport.width);
      h = Math.floor(cached.viewport.height);
    } else {
      w = userHlCanvas.offsetWidth || 0;
      h = userHlCanvas.offsetHeight || 0;
    }
    if (!w || !h) return;

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

  return { load, getDoc, getPageCount, getScale, setScale, fitToWidth, renderPage, getOutline, getPageForDest, search, highlightPage, addHighlight, getHighlights, setHighlights, clearHighlights, drawUserHighlights, setHighlightColor, getHighlightColorHex };
})();
