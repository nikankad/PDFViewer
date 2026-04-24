// DOM helpers and UI state management

const UI = (() => {
  const $ = id => document.getElementById(id);

  const els = {
    uploadScreen:    $('upload-screen'),
    viewerScreen:    $('viewer-screen'),
    dropZone:        $('drop-zone'),
    dropOverlay:     $('drop-overlay'),
    fileInput:       $('file-input'),
    fileInputViewer: $('file-input-viewer'),
    browseBtn:       $('browse-btn'),
    openBtn:         $('open-btn'),
    loading:         $('loading'),

    // Toolbar
    homeBtn:         $('home-btn'),
    tocBtn:          $('toc-btn'),
    prevBtn:         $('prev-btn'),
    nextBtn:         $('next-btn'),
    pageInput:       $('page-input'),
    pageTotal:       $('page-total'),
    zoomInBtn:       $('zoom-in-btn'),
    zoomOutBtn:      $('zoom-out-btn'),
    searchBtn:       $('search-btn'),

    // Search bar
    searchBar:       $('search-bar'),
    searchInput:     $('search-input'),
    searchPrevBtn:   $('search-prev-btn'),
    searchNextBtn:   $('search-next-btn'),
    searchCloseBtn:  $('search-close-btn'),
    searchStatus:    $('search-status'),

    // Sidebar
    sidebar:         $('sidebar'),
    sidebarClose:    $('sidebar-close'),
    tocSearchInput:  $('toc-search-input'),
    tocList:         $('toc-list'),

    // Pages
    pagesContainer:  $('pages-container'),
    pdfViewport:     $('pdf-viewport'),

    // Persistence
    saveBtn:         $('save-btn'),
    recentList:      $('recent-list'),

    // Settings
    darkModeBtn:          $('dark-mode-btn'),
    settingsBtn:          $('settings-btn'),
    settingsPanel:        $('settings-panel'),
    settingsClose:        $('settings-close'),
    backgroundColorInput: $('background-color-input'),
    defaultZoomInput:     $('default-zoom-input'),
    clearRecentBtn:       $('clear-recent-btn'),
    clearHighlightsBtn:   $('clear-highlights-btn'),

    // Highlight
    highlightBtn:         $('highlight-btn'),
    highlightColorPicker: $('highlight-color-picker'),
    highlightPicker:      $('highlight-picker'),
    highlightColorBar:    $('highlight-color-bar'),

    // Zoom
    zoomResetBtn:         $('zoom-reset-btn'),
  };

  function showUpload() {
    els.uploadScreen.classList.remove('hidden');
    els.viewerScreen.classList.add('hidden');
  }

  function showViewer() {
    els.uploadScreen.classList.add('hidden');
    els.viewerScreen.classList.remove('hidden');
  }

  function setLoading(on) {
    els.loading.classList.toggle('hidden', !on);
  }

  function setPageInfo(current, total) {
    els.pageInput.value = current;
    els.pageInput.max = total;
    els.pageTotal.textContent = total;
  }

  function setZoom(scale) {
    els.zoomResetBtn.textContent = Math.round(scale * 100) + '%';
  }

  function toggleSidebar(force) {
    const show = force !== undefined ? force : els.sidebar.classList.contains('hidden');
    els.sidebar.classList.toggle('hidden', !show);
    if (show) els.settingsPanel.classList.add('hidden');
  }

  function toggleSettings(force) {
    const show = force !== undefined ? force : els.settingsPanel.classList.contains('hidden');
    els.settingsPanel.classList.toggle('hidden', !show);
    if (show) els.sidebar.classList.add('hidden');
  }

  function toggleSearch(force) {
    const show = force !== undefined ? force : els.searchBar.classList.contains('hidden');
    els.searchBar.classList.toggle('hidden', !show);
    document.body.classList.toggle('search-open', show);
    if (show) {
      els.searchInput.focus();
      els.searchInput.select();
    }
  }

  function setSearchStatus(text) {
    els.searchStatus.textContent = text;
  }

  let tocOutline = [];
  let tocClickHandler = null;

  function renderTOC(query = '') {
    els.tocList.innerHTML = '';

    if (!tocOutline.length) {
      els.tocList.innerHTML = '<p class="toc-empty">No outline available</p>';
      return;
    }

    const normalizedQuery = query.trim().toLowerCase();
    let matches = 0;

    function renderItems(items, level) {
      items.forEach(item => {
        const title = item.title || 'Untitled';
        const titleMatches = !normalizedQuery || title.toLowerCase().includes(normalizedQuery);

        if (titleMatches) {
          const btn = document.createElement('button');
          btn.className = 'toc-item';
          btn.textContent = title;
          btn.dataset.level = level;
          btn.title = title;
          btn.addEventListener('click', () => tocClickHandler(item.dest));
          els.tocList.appendChild(btn);
          matches++;
        }

        if (item.items && item.items.length) renderItems(item.items, level + 1);
      });
    }

    renderItems(tocOutline, 0);

    if (matches === 0) {
      els.tocList.innerHTML = '<p class="toc-empty">No matching sections</p>';
    }
  }

  // Build TOC from pdf.js outline
  async function buildTOC(outline, onItemClick) {
    tocOutline = outline || [];
    tocClickHandler = onItemClick;
    if (els.tocSearchInput) els.tocSearchInput.value = '';
    renderTOC();
  }

  els.tocSearchInput.addEventListener('input', e => {
    renderTOC(e.target.value);
  });

  // Create a lightweight placeholder wrapper so scroll height is correct before rendering
  function createPlaceholder(pageNum, width, height) {
    let wrapper = els.pagesContainer.querySelector(`[data-page="${pageNum}"]`);
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'page-wrapper';
      wrapper.dataset.page = pageNum;
      els.pagesContainer.appendChild(wrapper);
    }
    wrapper.style.width = width + 'px';
    wrapper.style.minHeight = height + 'px';
    return wrapper;
  }

  // Create or return a page wrapper div with canvas, highlight layers, and text layer.
  // Canvases are added lazily — wrapper may already exist as a placeholder.
  function getOrCreatePageEl(pageNum) {
    let wrapper = els.pagesContainer.querySelector(`[data-page="${pageNum}"]`);
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'page-wrapper';
      wrapper.dataset.page = pageNum;
      els.pagesContainer.appendChild(wrapper);
    }
    if (!wrapper.querySelector('canvas')) {
      const canvas = document.createElement('canvas');
      const userHlLayer = document.createElement('canvas');
      userHlLayer.className = 'user-hl-layer';
      const hlLayer = document.createElement('canvas');
      hlLayer.className = 'hl-layer';
      const textLayer = document.createElement('div');
      textLayer.className = 'textLayer';
      wrapper.appendChild(canvas);
      wrapper.appendChild(userHlLayer);
      wrapper.appendChild(hlLayer);
      wrapper.appendChild(textLayer);
    }
    return {
      wrapper,
      canvas: wrapper.querySelector('canvas'),
      userHlLayer: wrapper.querySelector('.user-hl-layer'),
      hlLayer: wrapper.querySelector('.hl-layer'),
      textLayer: wrapper.querySelector('.textLayer'),
    };
  }

  // Render recent files list. Calls onOpen(id) or onDelete(id).
  function renderRecent(files, onOpen, onDelete, onOpenPdf) {
    if (!els.recentList) return;
    if (!files.length) {
      els.recentList.classList.add('hidden');
      return;
    }
    els.recentList.classList.remove('hidden');
    els.recentList.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'recent-header';
    const title = document.createElement('div');
    title.className = 'recent-title-wrap';
    title.innerHTML = '<p class="recent-label">Recent Library</p>';
    header.appendChild(title);
    els.recentList.appendChild(header);

    const shelf = document.createElement('div');
    shelf.className = 'recent-shelf';
    files.forEach(f => {
      const card = document.createElement('div');
      card.className = 'recent-card';

      const cover = document.createElement('button');
      cover.className = 'recent-cover';
      cover.title = `Open ${f.name}`;
      cover.addEventListener('click', () => onOpen(f.id));
      if (f.cover) {
        const img = document.createElement('img');
        img.src = f.cover;
        img.alt = '';
        cover.appendChild(img);
      } else {
        cover.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>`;
      }

      const info = document.createElement('button');
      info.className = 'recent-info';
      info.title = f.name;
      const nameSpan = document.createElement('span');
      nameSpan.className = 'recent-name';
      nameSpan.textContent = f.name;
      const metaSpan = document.createElement('span');
      metaSpan.className = 'recent-meta';
      metaSpan.textContent = `${formatDate(f.lastOpened)} \u00b7 ${formatSize(f.size)}`;
      info.appendChild(nameSpan);
      info.appendChild(metaSpan);
      info.addEventListener('click', () => onOpen(f.id));

      const del = document.createElement('button');
      del.className = 'recent-delete icon-btn';
      del.title = 'Remove from recent';
      del.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>`;
      del.addEventListener('click', e => { e.stopPropagation(); onDelete(f.id); });

      card.appendChild(cover);
      card.appendChild(info);
      card.appendChild(del);
      shelf.appendChild(card);
    });
    els.recentList.appendChild(shelf);
  }

  function escapeHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function formatDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function formatSize(bytes) {
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function clearPages() {
    els.pagesContainer.innerHTML = '';
  }

  // Scroll a page into view
  function scrollToPage(pageNum) {
    const wrapper = els.pagesContainer.querySelector(`[data-page="${pageNum}"]`);
    if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Observe which page is most visible and call callback(pageNum)
  function observePages(callback) {
    const observer = new IntersectionObserver(entries => {
      let best = null, bestRatio = 0;
      entries.forEach(e => {
        if (e.intersectionRatio > bestRatio) {
          bestRatio = e.intersectionRatio;
          best = e.target;
        }
      });
      if (best) callback(parseInt(best.dataset.page, 10));
    }, { root: els.pdfViewport, threshold: Array.from({ length: 11 }, (_, i) => i / 10) });

    return observer;
  }

  return {
    els,
    showUpload,
    showViewer,
    setLoading,
    setPageInfo,
    setZoom,
    toggleSidebar,
    toggleSettings,
    toggleSearch,
    setSearchStatus,
    buildTOC,
    getOrCreatePageEl,
    createPlaceholder,
    clearPages,
    scrollToPage,
    observePages,
    renderRecent,
  };
})();
