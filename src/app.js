// Main application logic — wires UI events to PDFHandler + Storage

(async () => {
  const ZOOM_STEP = 0.25;
  const ZOOM_MIN  = 0.25;
  const ZOOM_MAX  = 4.0;

  let currentPage   = 1;
  let currentFileId = null;
  let pageObserver  = null;
  let searchResults = [];
  let searchIndex   = 0;

  // ── Settings init ────────────────────────────────────

  const defaultZoomPct = Storage.getSetting('defaultZoom', 150);
  const highlightColor = Storage.getSetting('highlightColor', '#ffdd00');
  UI.els.defaultZoomInput.value = defaultZoomPct;
  UI.els.highlightColorInput.value = highlightColor;
  PDFHandler.setHighlightColor(highlightColor);

  const pdfDarkModeToggle = document.getElementById('pdf-dark-mode-toggle');

  function applyPdfDarkMode(on) {
    UI.els.pdfViewport.classList.toggle('pdf-dark-mode', on);
    pdfDarkModeToggle.checked = on;
    Storage.setSetting('pdfDarkMode', on);
  }

  applyPdfDarkMode(Storage.getSetting('pdfDarkMode', false));

  // ── File loading ─────────────────────────────────────

  async function openFromBuffer(buf, name) {
    await PDFHandler.load(buf);
    currentPage = 1;
    PDFHandler.setScale(Storage.getSetting('defaultZoom', 150) / 100);
    UI.showViewer();
    await renderAll();

    // Load and draw saved user highlights
    if (currentFileId) {
      const saved = await Storage.getHighlights(currentFileId);
      if (saved && Object.keys(saved).length) {
        PDFHandler.setHighlights(saved);
        redrawUserHighlights();
      }
    }

    const outline = await PDFHandler.getOutline();
    await UI.buildTOC(outline, onTOCClick);
    UI.setPageInfo(1, PDFHandler.getPageCount());
    UI.setZoom(PDFHandler.getScale());
    UI.scrollToPage(1);
    startObserver();
    setSaveBtnState(false);
    if (window._updateToolbarVisibility) window._updateToolbarVisibility();
  }

  async function openFile(file) {
    if (!file || file.type !== 'application/pdf') {
      alert('Please open a valid PDF file.');
      return;
    }
    UI.setLoading(true);
    try {
      const buf = await file.arrayBuffer();
      currentFileId = await Storage.saveFile(file.name, buf);
      await openFromBuffer(buf, file.name);
      await refreshRecentList();
    } catch (err) {
      console.error(err);
      alert('Failed to open PDF: ' + (err.message || err));
    } finally {
      UI.setLoading(false);
    }
  }

  async function openFromRecent(id) {
    UI.setLoading(true);
    try {
      const buf = await Storage.getFile(id);
      if (!buf) { alert('File not found in storage.'); return; }
      currentFileId = id;
      await Storage.touchFile(id);
      await openFromBuffer(buf, '');
      await refreshRecentList();
    } catch (err) {
      console.error(err);
      alert('Failed to open recent file: ' + (err.message || err));
    } finally {
      UI.setLoading(false);
    }
  }

  // ── Page rendering ───────────────────────────────────

  async function renderAll() {
    UI.clearPages();
    await renderVisible();
  }

  async function renderVisible() {
    const total = PDFHandler.getPageCount();
    for (let i = 1; i <= total; i++) {
      const { canvas, textLayer } = UI.getOrCreatePageEl(i);
      await PDFHandler.renderPage(i, canvas, textLayer);
    }
  }

  async function rerenderAll() {
    UI.setLoading(true);
    try {
      await renderVisible();
      UI.setZoom(PDFHandler.getScale());
      redrawUserHighlights();
      const q = UI.els.searchInput.value.trim();
      if (q) applySearchHighlights(q);
    } finally {
      UI.setLoading(false);
    }
  }

  // ── User highlights ──────────────────────────────────

  function redrawUserHighlights() {
    document.querySelectorAll('.page-wrapper').forEach(wrapper => {
      const pageNum = parseInt(wrapper.dataset.page, 10);
      const userHlCanvas = wrapper.querySelector('.user-hl-layer');
      PDFHandler.drawUserHighlights(pageNum, userHlCanvas);
    });
  }

  // Capture selected text rect on a page and add as highlight
  UI.els.pdfViewport.addEventListener('mouseup', () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;

    const range = sel.getRangeAt(0);
    const rects = Array.from(range.getClientRects());
    if (!rects.length) return;

    // Find which page wrapper the selection is in
    let node = range.commonAncestorContainer;
    while (node && node !== document.body) {
      if (node.classList && node.classList.contains('page-wrapper')) break;
      node = node.parentNode;
    }
    if (!node || !node.dataset.page) return;

    const pageNum = parseInt(node.dataset.page, 10);
    const wrapperRect = node.getBoundingClientRect();
    const scale = PDFHandler.getScale();

    rects.forEach(r => {
      // Convert to page-local coords at scale=1
      PDFHandler.addHighlight(pageNum, {
        x: (r.left - wrapperRect.left) / scale,
        y: (r.top  - wrapperRect.top)  / scale,
        w: r.width  / scale,
        h: r.height / scale,
      });
    });

    const userHlCanvas = node.querySelector('.user-hl-layer');
    PDFHandler.drawUserHighlights(pageNum, userHlCanvas);
    setSaveBtnState(false); // unsaved changes
    sel.removeAllRanges();
  });

  // Save button
  function setSaveBtnState(saved) {
    UI.els.saveBtn.classList.toggle('saved', saved);
    UI.els.saveBtn.title = saved ? 'Highlights saved' : 'Save highlights';
  }

  UI.els.saveBtn.addEventListener('click', async () => {
    if (!currentFileId) return;
    await Storage.saveHighlights(currentFileId, PDFHandler.getHighlights());
    setSaveBtnState(true);
  });

  // ── Page observer ────────────────────────────────────

  function startObserver() {
    if (pageObserver) pageObserver.disconnect();
    const wrappers = document.querySelectorAll('.page-wrapper');
    pageObserver = UI.observePages(page => {
      if (page !== currentPage) {
        currentPage = page;
        UI.setPageInfo(currentPage, PDFHandler.getPageCount());
        if (window._updateToolbarVisibility) window._updateToolbarVisibility();
      }
    });
    wrappers.forEach(w => pageObserver.observe(w));
  }

  // ── Toolbar auto-hide ────────────────────────────────
  // Visible on page 1, hides when scrolled past page 1, shows on hover.

  (() => {
    const toolbar = document.querySelector('.toolbar');

    function updateToolbarVisibility() {
      if (currentPage <= 1) {
        toolbar.classList.remove('hidden-bar');
      } else {
        toolbar.classList.add('hidden-bar');
      }
    }

    // Use mousemove on the document — when toolbar is off-screen mouseenter never fires
    document.addEventListener('mousemove', e => {
      if (e.clientY < 52) {
        toolbar.classList.remove('hidden-bar');
      } else if (!toolbar.matches(':hover')) {
        updateToolbarVisibility();
      }
    });

    UI.els.pdfViewport.addEventListener('scroll', () => updateToolbarVisibility(), { passive: true });

    // Expose so startObserver can trigger it when currentPage changes
    window._updateToolbarVisibility = updateToolbarVisibility;
  })();

  // ── TOC navigation ───────────────────────────────────

  async function onTOCClick(dest) {
    const pageNum = await PDFHandler.getPageForDest(dest);
    if (pageNum) {
      currentPage = pageNum;
      UI.scrollToPage(pageNum);
      UI.setPageInfo(pageNum, PDFHandler.getPageCount());
    }
    if (window.innerWidth < 600) UI.toggleSidebar(false);
  }

  // ── Search ───────────────────────────────────────────

  function applySearchHighlights(query) {
    document.querySelectorAll('.page-wrapper').forEach(wrapper => {
      const pageNum = parseInt(wrapper.dataset.page, 10);
      const hlCanvas = wrapper.querySelector('.hl-layer');
      PDFHandler.highlightPage(pageNum, hlCanvas, query);
    });
  }

  async function doSearch() {
    const query = UI.els.searchInput.value.trim();
    if (!query) {
      UI.setSearchStatus('');
      searchResults = [];
      applySearchHighlights('');
      return;
    }
    UI.setSearchStatus('…');
    searchResults = await PDFHandler.search(query);
    searchIndex = 0;
    applySearchHighlights(query);
    if (searchResults.length === 0) {
      UI.setSearchStatus('No results');
    } else {
      const total = searchResults.reduce((s, r) => s + r.count, 0);
      UI.setSearchStatus(`${total} found`);
      jumpToSearchResult(0);
    }
  }

  function jumpToSearchResult(idx) {
    if (!searchResults.length) return;
    searchIndex = ((idx % searchResults.length) + searchResults.length) % searchResults.length;
    const { page } = searchResults[searchIndex];
    currentPage = page;
    UI.scrollToPage(page);
    UI.setPageInfo(page, PDFHandler.getPageCount());
    const matchStr = searchResults.length > 1
      ? `${searchIndex + 1}/${searchResults.length} pages`
      : '1 page';
    UI.setSearchStatus(matchStr);
  }

  // ── Recent files ─────────────────────────────────────

  async function refreshRecentList() {
    const files = await Storage.listRecent();
    UI.renderRecent(files, openFromRecent, async id => {
      await Storage.deleteFile(id);
      await refreshRecentList();
    });
  }

  // ── Event wiring ─────────────────────────────────────

  UI.els.browseBtn.addEventListener('click', () => UI.els.fileInput.click());
  UI.els.fileInput.addEventListener('change', e => openFile(e.target.files[0]));
  UI.els.dropZone.addEventListener('click', e => {
    if (e.target !== UI.els.browseBtn) UI.els.fileInput.click();
  });

  UI.els.dropZone.addEventListener('dragover', e => { e.preventDefault(); UI.els.dropZone.classList.add('dragover'); });
  UI.els.dropZone.addEventListener('dragleave', () => UI.els.dropZone.classList.remove('dragover'));
  UI.els.dropZone.addEventListener('drop', e => {
    e.preventDefault();
    UI.els.dropZone.classList.remove('dragover');
    openFile(e.dataTransfer.files[0]);
  });

  document.addEventListener('dragover', e => { e.preventDefault(); UI.els.dropOverlay.classList.remove('hidden'); });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) UI.els.dropOverlay.classList.add('hidden'); });
  document.addEventListener('drop', e => {
    e.preventDefault();
    UI.els.dropOverlay.classList.add('hidden');
    openFile(e.dataTransfer.files[0]);
  });

  UI.els.openBtn.addEventListener('click', () => UI.els.fileInputViewer.click());
  UI.els.fileInputViewer.addEventListener('change', e => openFile(e.target.files[0]));

  UI.els.prevBtn.addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; UI.scrollToPage(currentPage); UI.setPageInfo(currentPage, PDFHandler.getPageCount()); }
  });
  UI.els.nextBtn.addEventListener('click', () => {
    if (currentPage < PDFHandler.getPageCount()) { currentPage++; UI.scrollToPage(currentPage); UI.setPageInfo(currentPage, PDFHandler.getPageCount()); }
  });
  UI.els.pageInput.addEventListener('change', () => {
    const n = parseInt(UI.els.pageInput.value, 10);
    if (n >= 1 && n <= PDFHandler.getPageCount()) { currentPage = n; UI.scrollToPage(n); }
    else UI.els.pageInput.value = currentPage;
  });

  UI.els.zoomInBtn.addEventListener('click', async () => {
    PDFHandler.setScale(Math.min(ZOOM_MAX, PDFHandler.getScale() + ZOOM_STEP));
    await rerenderAll();
  });
  UI.els.zoomOutBtn.addEventListener('click', async () => {
    PDFHandler.setScale(Math.max(ZOOM_MIN, PDFHandler.getScale() - ZOOM_STEP));
    await rerenderAll();
  });

  UI.els.tocBtn.addEventListener('click', () => UI.toggleSidebar());
  UI.els.sidebarClose.addEventListener('click', () => UI.toggleSidebar(false));

  UI.els.searchBtn.addEventListener('click', () => UI.toggleSearch());
  UI.els.searchCloseBtn.addEventListener('click', () => { UI.toggleSearch(false); applySearchHighlights(''); searchResults = []; UI.setSearchStatus(''); });
  UI.els.searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.shiftKey ? jumpToSearchResult(searchIndex - 1) : doSearch(); }
    if (e.key === 'Escape') { UI.toggleSearch(false); applySearchHighlights(''); searchResults = []; UI.setSearchStatus(''); }
  });
  UI.els.searchNextBtn.addEventListener('click', () => jumpToSearchResult(searchIndex + 1));
  UI.els.searchPrevBtn.addEventListener('click', () => jumpToSearchResult(searchIndex - 1));

  document.addEventListener('keydown', e => {
    const tag = document.activeElement.tagName;
    if (tag === 'INPUT') return;
    switch (e.key) {
      case '+': case '=': e.preventDefault(); PDFHandler.setScale(Math.min(ZOOM_MAX, PDFHandler.getScale() + ZOOM_STEP)); rerenderAll(); break;
      case '-':           e.preventDefault(); PDFHandler.setScale(Math.max(ZOOM_MIN, PDFHandler.getScale() - ZOOM_STEP)); rerenderAll(); break;
      case 'ArrowLeft': case 'ArrowUp':
        if (currentPage > 1) { currentPage--; UI.scrollToPage(currentPage); UI.setPageInfo(currentPage, PDFHandler.getPageCount()); } break;
      case 'ArrowRight': case 'ArrowDown':
        if (currentPage < PDFHandler.getPageCount()) { currentPage++; UI.scrollToPage(currentPage); UI.setPageInfo(currentPage, PDFHandler.getPageCount()); } break;
      case 'f': if (e.ctrlKey || e.metaKey) { e.preventDefault(); UI.toggleSearch(true); } break;
    }
  });

  // ── Settings events ──────────────────────────────────

  UI.els.settingsBtn.addEventListener('click', () => UI.toggleSettings());
  UI.els.settingsClose.addEventListener('click', () => UI.toggleSettings(false));

  pdfDarkModeToggle.addEventListener('change', () => {
    applyPdfDarkMode(pdfDarkModeToggle.checked);
  });

  UI.els.highlightColorInput.addEventListener('input', e => {
    const hex = e.target.value;
    PDFHandler.setHighlightColor(hex);
    Storage.setSetting('highlightColor', hex);
  });

  UI.els.defaultZoomInput.addEventListener('change', e => {
    const pct = Math.min(400, Math.max(25, parseInt(e.target.value, 10) || 150));
    UI.els.defaultZoomInput.value = pct;
    Storage.setSetting('defaultZoom', pct);
  });

  UI.els.clearRecentBtn.addEventListener('click', async () => {
    if (!confirm('Remove all recent files?')) return;
    const files = await Storage.listRecent();
    for (const f of files) await Storage.deleteFile(f.id);
    await refreshRecentList();
  });

  UI.els.clearHighlightsBtn.addEventListener('click', async () => {
    if (!confirm('Clear all saved highlights?')) return;
    await Storage.clearAllHighlights();
    PDFHandler.clearHighlights();
    redrawUserHighlights();
    setSaveBtnState(false);
  });

  // ── Init: load recent files on page load ─────────────
  await refreshRecentList();
})();
