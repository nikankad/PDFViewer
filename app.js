// Main application logic — wires UI events to PDFHandler + Storage

(async () => {
  const ZOOM_STEP = 0.25;
  const ZOOM_MIN  = 0.25;
  const ZOOM_MAX  = 4.0;
  const REMOTE_PDF_MAX_BYTES = 40 * 1024 * 1024;
  const REMOTE_PDF_TIMEOUT_MS = 15000;

  let currentPage      = 1;
  let currentFileId    = null;
  let pageObserver     = null;
  let lazyObserver     = null;
  let searchResults    = [];
  let searchIndex      = 0;
  let highlightMode    = false;
  let recentSearchQuery = '';
  let recentSelectedTags = [];
  let progressSaveTimer = null;

  // ── Settings init ────────────────────────────────────

  const backgroundColor = Storage.getSetting('backgroundColor', '#1a1a1a');
  const defaultZoomPct = Storage.getSetting('defaultZoom', 150);
  const highlightColor = Storage.getSetting('highlightColor', '#ffdd00');
  UI.els.backgroundColorInput.value = backgroundColor;
  UI.els.defaultZoomInput.value = defaultZoomPct;
  UI.els.highlightColorPicker.value = highlightColor;
  PDFHandler.setHighlightColor(highlightColor);

  function applyBackgroundColor(color) {
    document.documentElement.style.setProperty('--bg', color);
    UI.els.backgroundColorInput.value = color;
    Storage.setSetting('backgroundColor', color);
  }

  function applyPdfDarkMode(on) {
    UI.els.pdfViewport.classList.toggle('pdf-dark-mode', on);
    UI.els.darkModeBtn.classList.toggle('active', on);
    Storage.setSetting('pdfDarkMode', on);
  }

  applyBackgroundColor(backgroundColor);
  applyPdfDarkMode(Storage.getSetting('pdfDarkMode', false));

  // ── File loading ─────────────────────────────────────

  function scheduleProgressSave() {
    if (!currentFileId) return;
    if (progressSaveTimer) clearTimeout(progressSaveTimer);
    const fileId = currentFileId;
    const pageToSave = currentPage;
    progressSaveTimer = setTimeout(() => {
      Storage.saveReadingProgress(fileId, pageToSave).catch(err => {
        console.warn('Failed to save reading progress', err);
      });
      progressSaveTimer = null;
    }, 220);
  }

  async function openFromBuffer(buf, name, initialPage = 1) {
    if (progressSaveTimer) {
      clearTimeout(progressSaveTimer);
      progressSaveTimer = null;
    }
    await PDFHandler.load(buf);
    if (currentFileId) {
      const cover = await PDFHandler.renderCover(96);
      if (cover) await Storage.saveCover(currentFileId, cover);
    }
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
    const totalPages = PDFHandler.getPageCount();
    UI.setDocumentName(name || 'Untitled.pdf');
    const targetPage = Math.min(Math.max(1, parseInt(initialPage, 10) || 1), totalPages);
    currentPage = targetPage;
    UI.setPageInfo(targetPage, totalPages);
    UI.setZoom(PDFHandler.getScale());
    UI.scrollToPage(targetPage);
    startObserver();
    scheduleProgressSave();
    setSaveBtnState(false);
    if (window._updateToolbarVisibility) window._updateToolbarVisibility();
  }

  async function openFile(file) {
    if (!file || file.type !== 'application/pdf') {
      return;
    }
    UI.setLoading(true);
    try {
      const buf = await file.arrayBuffer();
      currentFileId = await Storage.saveFile(file.name, buf);
      const savedPage = await Storage.getReadingProgress(currentFileId);
      await openFromBuffer(buf, file.name, savedPage);
      await refreshRecentList();
    } catch (err) {
      console.error(err);
      alert('Failed to open PDF: ' + (err.message || err));
    } finally {
      UI.setLoading(false);
    }
  }

  function getPdfNameFromUrl(url) {
    try {
      const parsed = new URL(url);
      const name = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || 'remote.pdf');
      return name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`;
    } catch (_) {
      return 'remote.pdf';
    }
  }

  async function openFromUrl(value) {
    const url = value.trim();
    if (!url) return;

    let parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      alert('Please enter a valid URL.');
      return;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      alert('Only http(s) PDF URLs are supported.');
      return;
    }

    UI.setLoading(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REMOTE_PDF_TIMEOUT_MS);
      let res;
      try {
        res = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
      if (contentLength > REMOTE_PDF_MAX_BYTES) {
        throw new Error('PDF is too large (max 40 MB)');
      }
      const type = res.headers.get('content-type') || '';
      if (type && !type.toLowerCase().includes('pdf') && !url.toLowerCase().includes('.pdf')) {
        throw new Error('URL did not return a PDF');
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength > REMOTE_PDF_MAX_BYTES) {
        throw new Error('PDF is too large (max 40 MB)');
      }
      const name = getPdfNameFromUrl(url);
      currentFileId = await Storage.saveFile(name, buf);
      const savedPage = await Storage.getReadingProgress(currentFileId);
      await openFromBuffer(buf, name, savedPage);
      await refreshRecentList();
      UI.els.urlInput.value = '';
    } catch (err) {
      console.error(err);
      alert('Failed to open PDF URL: ' + (err.message || err));
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
      const savedPage = await Storage.getReadingProgress(id);
      const recentFiles = await Storage.listRecent();
      const recent = recentFiles.find(file => file.id === id);
      await Storage.touchFile(id);
      await openFromBuffer(buf, recent?.name || 'Untitled.pdf', savedPage);
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

  // Use pdf.js/browser text selection rects directly for highlights.
  UI.els.pdfViewport.addEventListener('mouseup', () => {
    if (!highlightMode) return;

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;

    const range = sel.getRangeAt(0);
    const rangeRects = Array.from(range.getClientRects()).filter(r => r.width > 0.5 && r.height > 0.5);
    if (!rangeRects.length) return;

    let added = false;
    document.querySelectorAll('.page-wrapper').forEach(wrapper => {
      const textLayer = wrapper.querySelector('.textLayer');
      if (!textLayer) return;
      try {
        if (!range.intersectsNode(textLayer)) return;
      } catch (_) {
        return;
      }

      const pageRect = wrapper.getBoundingClientRect();
      const rects = rangeRects
        .map(r => {
          const left = Math.max(r.left, pageRect.left);
          const top = Math.max(r.top, pageRect.top);
          const right = Math.min(r.right, pageRect.right);
          const bottom = Math.min(r.bottom, pageRect.bottom);
          return { left, top, right, bottom };
        })
        .filter(r => r.right - r.left > 0.5 && r.bottom - r.top > 0.5)
        .map(r => ({
          left: r.left - pageRect.left,
          top: r.top - pageRect.top,
          right: r.right - pageRect.left,
          bottom: r.bottom - pageRect.top,
        }));

      if (!rects.length) return;
      const pageNum = parseInt(wrapper.dataset.page, 10);
      if (!PDFHandler.highlightFromSelection(pageNum, rects)) return;
      const userHlCanvas = wrapper.querySelector('.user-hl-layer');
      PDFHandler.drawUserHighlights(pageNum, userHlCanvas);
      added = true;
    });

    if (!added) return;
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
        scheduleProgressSave();
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
      scheduleProgressSave();
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
    scheduleProgressSave();
    const matchStr = searchResults.length > 1
      ? `${searchIndex + 1}/${searchResults.length} pages`
      : '1 page';
    UI.setSearchStatus(matchStr);
  }

  // ── Recent files ─────────────────────────────────────

  async function renderCoverFromBuffer(buf, width = 96) {
    const doc = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
    try {
      const page = await doc.getPage(1);
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
    } finally {
      doc.destroy();
    }
  }

  async function backfillRecentCovers(files) {
    for (const f of files) {
      if (f.cover) continue;
      try {
        const buf = await Storage.getFile(f.id);
        if (!buf) continue;
        const cover = await renderCoverFromBuffer(buf, 120);
        if (cover) {
          await Storage.saveCover(f.id, cover);
          f.cover = cover;
        }
      } catch (err) {
        console.warn('Failed to generate recent cover', f.name, err);
      }
    }
  }

  function parseTags(value) {
    const seen = new Set();
    return value
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => {
        const key = tag.toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function normalizeSearchText(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function fuzzyContains(text, query) {
    const rawText = String(text || '').toLowerCase();
    const rawQuery = String(query || '').toLowerCase();
    if (!rawQuery.trim()) return true;
    if (rawText.includes(rawQuery)) return true;

    const compactText = normalizeSearchText(rawText);
    const compactQuery = normalizeSearchText(rawQuery);
    if (!compactQuery) return true;
    if (compactText.includes(compactQuery)) return true;

    let i = 0;
    for (let j = 0; j < compactText.length && i < compactQuery.length; j++) {
      if (compactText[j] === compactQuery[i]) i++;
    }
    return i === compactQuery.length;
  }

  function filterRecentFiles(files) {
    const q = recentSearchQuery.trim().toLowerCase();
    const queryTokens = q.split(/\s+/).filter(Boolean);
    const selected = recentSelectedTags.map(t => t.toLowerCase());

    return files.filter(f => {
      const tags = (f.tags || []).map(tag => tag.toLowerCase());
      const hasSelectedTags = selected.every(tag => tags.includes(tag));
      if (!hasSelectedTags) return false;
      if (!queryTokens.length) return true;

      const haystack = `${f.name} ${(f.tags || []).join(' ')}`;
      return queryTokens.every(token => fuzzyContains(haystack, token));
    });
  }

  function getRecentTags(files) {
    const tags = new Map();
    files.forEach(f => {
      (f.tags || []).forEach(tag => {
        const key = tag.toLowerCase();
        if (!tags.has(key)) tags.set(key, tag);
      });
    });
    return Array.from(tags.values()).sort((a, b) => a.localeCompare(b));
  }

  async function editRecentTags(id, tags) {
    const input = prompt('Tags separated by commas', (tags || []).join(', '));
    if (input === null) return;
    await Storage.saveTags(id, parseTags(input));
    await refreshRecentList();
  }

  function renderRecentFiles(files) {
    const availableTags = getRecentTags(files);
    const availableKeys = new Set(availableTags.map(tag => tag.toLowerCase()));
    recentSelectedTags = recentSelectedTags.filter(tag => availableKeys.has(tag.toLowerCase()));

    UI.renderRecent(filterRecentFiles(files), openFromRecent, async id => {
      await Storage.deleteFile(id);
      await refreshRecentList();
    }, editRecentTags, recentSearchQuery, query => {
      recentSearchQuery = query;
      renderRecentFiles(files);
      requestAnimationFrame(() => {
        const search = UI.els.recentList.querySelector('.recent-search');
        if (!search) return;
        search.focus();
        search.setSelectionRange(search.value.length, search.value.length);
      });
    }, availableTags, recentSelectedTags, tag => {
      const key = tag.toLowerCase();
      const selected = new Set(recentSelectedTags.map(t => t.toLowerCase()));
      if (selected.has(key)) {
        recentSelectedTags = recentSelectedTags.filter(t => t.toLowerCase() !== key);
      } else {
        recentSelectedTags = [...recentSelectedTags, tag];
      }
      renderRecentFiles(files);
    });
  }

  async function refreshRecentList() {
    const files = await Storage.listRecent();
    await backfillRecentCovers(files);
    renderRecentFiles(files);
  }

  // ── Event wiring ─────────────────────────────────────

  UI.els.browseBtn.addEventListener('click', () => UI.els.fileInput.click());
  UI.els.fileInput.addEventListener('change', e => openFile(e.target.files[0]));
  UI.els.dropZone.addEventListener('click', e => {
    if (e.target.closest('.url-form')) return;
    if (e.target !== UI.els.browseBtn) UI.els.fileInput.click();
  });
  UI.els.urlForm.addEventListener('submit', e => {
    e.preventDefault();
    openFromUrl(UI.els.urlInput.value);
  });

  UI.els.dropZone.addEventListener('dragover', e => { e.preventDefault(); UI.els.dropZone.classList.add('dragover'); });
  UI.els.dropZone.addEventListener('dragleave', () => UI.els.dropZone.classList.remove('dragover'));
  UI.els.dropZone.addEventListener('drop', e => {
    e.preventDefault();
    UI.els.dropZone.classList.remove('dragover');
    openFile(e.dataTransfer.files[0]);
  });

  document.addEventListener('dragover', e => { e.preventDefault(); });
  document.addEventListener('drop', e => {
    e.preventDefault();
    openFile(e.dataTransfer.files[0]);
  });

  UI.els.openBtn.addEventListener('click', () => UI.els.fileInputViewer.click());
  UI.els.fileInputViewer.addEventListener('change', e => openFile(e.target.files[0]));
  UI.els.homeBtn.addEventListener('click', () => UI.showUpload());

  UI.els.prevBtn.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      UI.scrollToPage(currentPage);
      UI.setPageInfo(currentPage, PDFHandler.getPageCount());
      scheduleProgressSave();
    }
  });
  UI.els.nextBtn.addEventListener('click', () => {
    if (currentPage < PDFHandler.getPageCount()) {
      currentPage++;
      UI.scrollToPage(currentPage);
      UI.setPageInfo(currentPage, PDFHandler.getPageCount());
      scheduleProgressSave();
    }
  });
  UI.els.pageInput.addEventListener('change', () => {
    const n = parseInt(UI.els.pageInput.value, 10);
    if (n >= 1 && n <= PDFHandler.getPageCount()) {
      currentPage = n;
      UI.scrollToPage(n);
      scheduleProgressSave();
    }
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
        if (currentPage > 1) {
          currentPage--;
          UI.scrollToPage(currentPage);
          UI.setPageInfo(currentPage, PDFHandler.getPageCount());
          scheduleProgressSave();
        }
        break;
      case 'ArrowRight': case 'ArrowDown':
        if (currentPage < PDFHandler.getPageCount()) {
          currentPage++;
          UI.scrollToPage(currentPage);
          UI.setPageInfo(currentPage, PDFHandler.getPageCount());
          scheduleProgressSave();
        }
        break;
      case '[':
        if (currentPage > 1) {
          currentPage--;
          UI.scrollToPage(currentPage);
          UI.setPageInfo(currentPage, PDFHandler.getPageCount());
          scheduleProgressSave();
        }
        break;
      case ']':
        if (currentPage < PDFHandler.getPageCount()) {
          currentPage++;
          UI.scrollToPage(currentPage);
          UI.setPageInfo(currentPage, PDFHandler.getPageCount());
          scheduleProgressSave();
        }
        break;
      case 'Home':
        e.preventDefault();
        currentPage = 1;
        UI.scrollToPage(1);
        UI.setPageInfo(1, PDFHandler.getPageCount());
        scheduleProgressSave();
        break;
      case 'End':
        e.preventDefault();
        currentPage = PDFHandler.getPageCount();
        UI.scrollToPage(currentPage);
        UI.setPageInfo(currentPage, PDFHandler.getPageCount());
        scheduleProgressSave();
        break;
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

  UI.els.darkModeBtn.addEventListener('click', () => {
    applyPdfDarkMode(!Storage.getSetting('pdfDarkMode', false));
  });

  UI.els.backgroundColorInput.addEventListener('input', e => {
    applyBackgroundColor(e.target.value);
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
