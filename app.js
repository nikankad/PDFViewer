// Main application logic — wires UI events to PDFHandler

(async () => {
  const ZOOM_STEP = 0.25;
  const ZOOM_MIN  = 0.25;
  const ZOOM_MAX  = 4.0;

  let currentPage = 1;
  let pageObserver = null;
  let searchResults = [];
  let searchIndex = 0;

  // ── File loading ─────────────────────────────────────

  async function openFile(file) {
    if (!file || file.type !== 'application/pdf') {
      alert('Please open a valid PDF file.');
      return;
    }
    UI.setLoading(true);
    try {
      const buf = await file.arrayBuffer();
      await PDFHandler.load(buf);
      currentPage = 1;
      await renderAll();
      const outline = await PDFHandler.getOutline();
      await UI.buildTOC(outline, onTOCClick);
      UI.showViewer();
      UI.setPageInfo(1, PDFHandler.getPageCount());
      UI.setZoom(PDFHandler.getScale());
      UI.scrollToPage(1);
      startObserver();
    } catch (err) {
      console.error(err);
      alert('Failed to open PDF: ' + (err.message || err));
    } finally {
      UI.setLoading(false);
    }
  }

  // ── Page rendering ───────────────────────────────────

  async function renderAll() {
    UI.clearPages();
    const total = PDFHandler.getPageCount();
    for (let i = 1; i <= total; i++) {
      const { canvas, textLayer } = UI.getOrCreatePageEl(i);
      // Render lazily via intersection observer for performance
      // but always create placeholders so scroll position is stable
    }
    // Render pages in batches using IntersectionObserver
    await renderVisible();
  }

  async function renderVisible() {
    const total = PDFHandler.getPageCount();
    // For simplicity and mobile performance, render all pages but
    // re-render only visible ones when scale changes.
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
    } finally {
      UI.setLoading(false);
    }
  }

  // ── Page observer (tracks current page during scroll) ─

  function startObserver() {
    if (pageObserver) pageObserver.disconnect();
    // Re-observe all page wrappers
    const wrappers = document.querySelectorAll('.page-wrapper');
    pageObserver = UI.observePages(page => {
      if (page !== currentPage) {
        currentPage = page;
        UI.setPageInfo(currentPage, PDFHandler.getPageCount());
      }
    });
    wrappers.forEach(w => pageObserver.observe(w));
  }

  // ── TOC navigation ───────────────────────────────────

  async function onTOCClick(dest) {
    const pageNum = await PDFHandler.getPageForDest(dest);
    if (pageNum) {
      currentPage = pageNum;
      UI.scrollToPage(pageNum);
      UI.setPageInfo(pageNum, PDFHandler.getPageCount());
    }
    // Close sidebar on mobile
    if (window.innerWidth < 600) UI.toggleSidebar(false);
  }

  // ── Search ───────────────────────────────────────────

  async function doSearch() {
    const query = UI.els.searchInput.value.trim();
    if (!query) {
      UI.setSearchStatus('');
      searchResults = [];
      return;
    }
    UI.setSearchStatus('…');
    searchResults = await PDFHandler.search(query);
    searchIndex = 0;
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

  // ── Event wiring ─────────────────────────────────────

  // Upload screen
  UI.els.browseBtn.addEventListener('click', () => UI.els.fileInput.click());
  UI.els.fileInput.addEventListener('change', e => openFile(e.target.files[0]));
  UI.els.dropZone.addEventListener('click', e => {
    if (e.target !== UI.els.browseBtn) UI.els.fileInput.click();
  });

  // Drag-and-drop on upload screen
  UI.els.dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    UI.els.dropZone.classList.add('dragover');
  });
  UI.els.dropZone.addEventListener('dragleave', () => {
    UI.els.dropZone.classList.remove('dragover');
  });
  UI.els.dropZone.addEventListener('drop', e => {
    e.preventDefault();
    UI.els.dropZone.classList.remove('dragover');
    openFile(e.dataTransfer.files[0]);
  });

  // Global drag-and-drop (works on viewer too)
  document.addEventListener('dragover', e => {
    e.preventDefault();
    UI.els.dropOverlay.classList.remove('hidden');
  });
  document.addEventListener('dragleave', e => {
    if (!e.relatedTarget) UI.els.dropOverlay.classList.add('hidden');
  });
  document.addEventListener('drop', e => {
    e.preventDefault();
    UI.els.dropOverlay.classList.add('hidden');
    openFile(e.dataTransfer.files[0]);
  });

  // Open new PDF from viewer
  UI.els.openBtn.addEventListener('click', () => UI.els.fileInputViewer.click());
  UI.els.fileInputViewer.addEventListener('change', e => openFile(e.target.files[0]));

  // Navigation
  UI.els.prevBtn.addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; UI.scrollToPage(currentPage); UI.setPageInfo(currentPage, PDFHandler.getPageCount()); }
  });
  UI.els.nextBtn.addEventListener('click', () => {
    if (currentPage < PDFHandler.getPageCount()) { currentPage++; UI.scrollToPage(currentPage); UI.setPageInfo(currentPage, PDFHandler.getPageCount()); }
  });
  UI.els.pageInput.addEventListener('change', () => {
    const n = parseInt(UI.els.pageInput.value, 10);
    if (n >= 1 && n <= PDFHandler.getPageCount()) {
      currentPage = n;
      UI.scrollToPage(n);
    } else {
      UI.els.pageInput.value = currentPage;
    }
  });

  // Zoom
  UI.els.zoomInBtn.addEventListener('click', async () => {
    PDFHandler.setScale(Math.min(ZOOM_MAX, PDFHandler.getScale() + ZOOM_STEP));
    await rerenderAll();
  });
  UI.els.zoomOutBtn.addEventListener('click', async () => {
    PDFHandler.setScale(Math.max(ZOOM_MIN, PDFHandler.getScale() - ZOOM_STEP));
    await rerenderAll();
  });

  // TOC sidebar
  UI.els.tocBtn.addEventListener('click', () => UI.toggleSidebar());
  UI.els.sidebarClose.addEventListener('click', () => UI.toggleSidebar(false));

  // Search
  UI.els.searchBtn.addEventListener('click', () => UI.toggleSearch());
  UI.els.searchCloseBtn.addEventListener('click', () => UI.toggleSearch(false));
  UI.els.searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.shiftKey ? jumpToSearchResult(searchIndex - 1) : doSearch(); }
    if (e.key === 'Escape') UI.toggleSearch(false);
  });
  UI.els.searchNextBtn.addEventListener('click', () => jumpToSearchResult(searchIndex + 1));
  UI.els.searchPrevBtn.addEventListener('click', () => jumpToSearchResult(searchIndex - 1));

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    const tag = document.activeElement.tagName;
    if (tag === 'INPUT') return;
    switch (e.key) {
      case '+': case '=':
        e.preventDefault();
        PDFHandler.setScale(Math.min(ZOOM_MAX, PDFHandler.getScale() + ZOOM_STEP));
        rerenderAll(); break;
      case '-':
        e.preventDefault();
        PDFHandler.setScale(Math.max(ZOOM_MIN, PDFHandler.getScale() - ZOOM_STEP));
        rerenderAll(); break;
      case 'ArrowLeft': case 'ArrowUp':
        if (currentPage > 1) { currentPage--; UI.scrollToPage(currentPage); UI.setPageInfo(currentPage, PDFHandler.getPageCount()); } break;
      case 'ArrowRight': case 'ArrowDown':
        if (currentPage < PDFHandler.getPageCount()) { currentPage++; UI.scrollToPage(currentPage); UI.setPageInfo(currentPage, PDFHandler.getPageCount()); } break;
      case 'f':
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); UI.toggleSearch(true); } break;
    }
  });
})();
