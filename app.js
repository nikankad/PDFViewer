// Main application logic — wires UI events to PDFHandler + Storage

(async () => {
  const ZOOM_STEP = 0.25;
  const ZOOM_MIN  = 0.25;
  const ZOOM_MAX  = 4.0;

  let currentPage      = 1;
  let currentFileId    = null;
  let pageObserver     = null;
  let lazyObserver     = null;
  let searchResults    = [];
  let searchIndex      = 0;
  let highlightMode    = false;

  // ── Settings init ────────────────────────────────────

  const defaultZoomPct = Storage.getSetting('defaultZoom', 150);
  const highlightColor = Storage.getSetting('highlightColor', '#ffdd00');
  UI.els.defaultZoomInput.value = defaultZoomPct;
  UI.els.highlightColorPicker.value = highlightColor;
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

    // Load highlights before lazy rendering starts so they appear on first render
    if (currentFileId) {
      const saved = await Storage.getHighlights(currentFileId);
      if (saved && Object.keys(saved).length) PDFHandler.setHighlights(saved);
    }

    await renderAll();

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
    const total = PDFHandler.getPageCount();
    const dims = await PDFHandler.getPageDimensions(1);
    for (let i = 1; i <= total; i++) UI.createPlaceholder(i, dims.width, dims.height);
    setupLazyRender();
  }

  function setupLazyRender() {
    if (lazyObserver) lazyObserver.disconnect();
    lazyObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !entry.target.dataset.rendered) {
          renderPageLazy(parseInt(entry.target.dataset.page, 10));
        }
      });
    }, { root: UI.els.pdfViewport, rootMargin: '200% 0px', threshold: 0 });
    document.querySelectorAll('.page-wrapper').forEach(w => lazyObserver.observe(w));
  }

  async function renderPageLazy(pageNum) {
    const wrapper = document.querySelector(`.page-wrapper[data-page="${pageNum}"]`);
    if (!wrapper || wrapper.dataset.rendered) return;
    wrapper.dataset.rendered = 'true';
    const { canvas, textLayer, userHlLayer, hlLayer } = UI.getOrCreatePageEl(pageNum);
    await PDFHandler.renderPage(pageNum, canvas, textLayer);
    wrapper.style.minHeight = '';
    PDFHandler.drawUserHighlights(pageNum, userHlLayer);
    const q = UI.els.searchInput.value.trim();
    if (q) PDFHandler.highlightPage(pageNum, hlLayer, q);
  }

  async function rerenderAll() {
    UI.setLoading(true);
    try {
      const dims = await PDFHandler.getPageDimensions(1);
      document.querySelectorAll('.page-wrapper').forEach(w => {
        delete w.dataset.rendered;
        Array.from(w.children).forEach(c => c.remove());
        w.style.width = dims.width + 'px';
        w.style.minHeight = dims.height + 'px';
      });
      UI.setZoom(PDFHandler.getScale());
      setupLazyRender();
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

  // Capture selected text rect on a page and add as highlight (only when highlight mode is active)
  UI.els.pdfViewport.addEventListener('mouseup', () => {
    if (!highlightMode) return;

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
    const textLayerDiv = node.querySelector('.textLayer');
    const refRect = (textLayerDiv || node).getBoundingClientRect();

    // Convert to page-relative CSS pixel coords at current scale (what highlightFromSelection expects)
    const pageRects = rects
      .filter(r => r.width > 0.5 && r.height > 0.5)
      .map(r => ({
        left:   r.left   - refRect.left,
        top:    r.top    - refRect.top,
        right:  r.right  - refRect.left,
        bottom: r.bottom - refRect.top,
      }));

    // Use cache geometry for accurate positioning (handles equations, transformed text, etc.)
    const added = PDFHandler.highlightFromSelection(pageNum, pageRects);

    // Fallback to raw DOM rects if no cache items matched (e.g. image-based content)
    if (!added) {
      const scale = PDFHandler.getScale();
      pageRects.forEach(r => {
        PDFHandler.addHighlight(pageNum, {
          x: r.left  / scale,
          y: r.top   / scale,
          w: (r.right  - r.left) / scale,
          h: (r.bottom - r.top)  / scale,
        });
      });
    }

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

  window._updateToolbarVisibility = () => {};

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
  UI.els.zoomResetBtn.addEventListener('click', async () => {
    PDFHandler.setScale(1.0);
    await rerenderAll();
  });

  UI.els.tocBtn.addEventListener('click', () => UI.toggleSidebar());
  document.getElementById('sidebar-close').addEventListener('click', () => UI.toggleSidebar(false));

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
    if (!PDFHandler.getDoc() && e.key !== 'Escape') return;
    const mod = (e.ctrlKey || e.metaKey) && e.altKey;
    switch (e.key) {
      case '+': case '=': e.preventDefault(); PDFHandler.setScale(Math.min(ZOOM_MAX, PDFHandler.getScale() + ZOOM_STEP)); rerenderAll(); break;
      case '-':           e.preventDefault(); PDFHandler.setScale(Math.max(ZOOM_MIN, PDFHandler.getScale() - ZOOM_STEP)); rerenderAll(); break;
      case 'ArrowLeft': case 'ArrowUp':
        if (currentPage > 1) { currentPage--; UI.scrollToPage(currentPage); UI.setPageInfo(currentPage, PDFHandler.getPageCount()); } break;
      case 'ArrowRight': case 'ArrowDown':
        if (currentPage < PDFHandler.getPageCount()) { currentPage++; UI.scrollToPage(currentPage); UI.setPageInfo(currentPage, PDFHandler.getPageCount()); } break;
      case '[':
        if (currentPage > 1) { currentPage--; UI.scrollToPage(currentPage); UI.setPageInfo(currentPage, PDFHandler.getPageCount()); } break;
      case ']':
        if (currentPage < PDFHandler.getPageCount()) { currentPage++; UI.scrollToPage(currentPage); UI.setPageInfo(currentPage, PDFHandler.getPageCount()); } break;
      case 'Home': e.preventDefault(); currentPage = 1; UI.scrollToPage(1); UI.setPageInfo(1, PDFHandler.getPageCount()); break;
      case 'End':  e.preventDefault(); currentPage = PDFHandler.getPageCount(); UI.scrollToPage(currentPage); UI.setPageInfo(currentPage, PDFHandler.getPageCount()); break;
      case '0': if (mod) { PDFHandler.setScale(Storage.getSetting('defaultZoom', 150) / 100); rerenderAll(); } break;
      case 'f': e.preventDefault(); if (mod) { UI.toggleSearch(true); } else if (!e.ctrlKey && !e.metaKey) { PDFHandler.fitToWidth(UI.els.pdfViewport.clientWidth); rerenderAll(); } break;
      case 't': if (mod) UI.toggleSidebar(); break;
      case 's': if (mod) { e.preventDefault(); UI.toggleSearch(true); } break;
      case 'd': if (mod) applyPdfDarkMode(!Storage.getSetting('pdfDarkMode', false)); break;
      case 'h': if (mod) {
        e.preventDefault();
        highlightMode = !highlightMode;
        UI.els.highlightBtn.classList.toggle('active', highlightMode);
        UI.els.pdfViewport.classList.toggle('highlight-mode', highlightMode);
        UI.els.highlightPicker.classList.toggle('hidden', !highlightMode);
        UI.els.highlightBtn.title = highlightMode ? 'Disable highlighting' : 'Enable highlighting';
      } break;
      case 'Escape':
        if (!UI.els.searchBar.classList.contains('hidden')) {
          UI.toggleSearch(false); applySearchHighlights(''); searchResults = []; UI.setSearchStatus('');
        } else if (!UI.els.sidebar.classList.contains('hidden')) {
          UI.toggleSidebar(false);
        } else if (!UI.els.settingsPanel.classList.contains('hidden')) {
          UI.toggleSettings(false);
        }
        break;
    }
  });

  // ── Settings events ──────────────────────────────────

  UI.els.settingsBtn.addEventListener('click', () => UI.toggleSettings());
  document.getElementById('settings-close').addEventListener('click', () => UI.toggleSettings(false));

  pdfDarkModeToggle.addEventListener('change', () => {
    applyPdfDarkMode(pdfDarkModeToggle.checked);
  });

  UI.els.highlightColorBar.style.background = highlightColor;

  UI.els.highlightColorPicker.addEventListener('input', e => {
    const hex = e.target.value;
    PDFHandler.setHighlightColor(hex);
    Storage.setSetting('highlightColor', hex);
    UI.els.highlightColorBar.style.background = hex;
  });

  // Highlight button toggle
  UI.els.highlightBtn.addEventListener('click', () => {
    highlightMode = !highlightMode;
    UI.els.highlightBtn.classList.toggle('active', highlightMode);
    UI.els.pdfViewport.classList.toggle('highlight-mode', highlightMode);
    UI.els.highlightPicker.classList.toggle('hidden', !highlightMode);
    UI.els.highlightBtn.title = highlightMode ? 'Disable highlighting' : 'Enable highlighting';
  });

  // Close color picker when clicking outside
  document.addEventListener('click', e => {
    const highlightContainer = document.getElementById('highlight-container');
    if (highlightContainer && !highlightContainer.contains(e.target)) {
      UI.els.highlightPicker.classList.add('hidden');
    }
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
