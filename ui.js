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
    tocBtn:          $('toc-btn'),
    prevBtn:         $('prev-btn'),
    nextBtn:         $('next-btn'),
    pageInput:       $('page-input'),
    pageTotal:       $('page-total'),
    zoomInBtn:       $('zoom-in-btn'),
    zoomOutBtn:      $('zoom-out-btn'),
    zoomLabel:       $('zoom-label'),
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
    tocList:         $('toc-list'),

    // Pages
    pagesContainer:  $('pages-container'),
    pdfViewport:     $('pdf-viewport'),
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
    els.zoomLabel.textContent = Math.round(scale * 100) + '%';
  }

  function toggleSidebar(force) {
    const hidden = force !== undefined ? !force : els.sidebar.classList.contains('hidden');
    els.sidebar.classList.toggle('hidden', !hidden);
  }

  function toggleSearch(force) {
    const show = force !== undefined ? force : els.searchBar.classList.contains('hidden');
    els.searchBar.classList.toggle('hidden', !show);
    if (show) {
      els.searchInput.focus();
      els.searchInput.select();
    }
  }

  function setSearchStatus(text) {
    els.searchStatus.textContent = text;
  }

  // Build TOC from pdf.js outline
  async function buildTOC(outline, onItemClick) {
    els.tocList.innerHTML = '';
    if (!outline || outline.length === 0) {
      els.tocList.innerHTML = '<p class="toc-empty">No outline available</p>';
      return;
    }
    function renderItems(items, level) {
      items.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'toc-item';
        btn.textContent = item.title;
        btn.dataset.level = level;
        btn.title = item.title;
        btn.addEventListener('click', () => onItemClick(item.dest));
        els.tocList.appendChild(btn);
        if (item.items && item.items.length) renderItems(item.items, level + 1);
      });
    }
    renderItems(outline, 0);
  }

  // Create or return a page wrapper div with canvas and text layer
  function getOrCreatePageEl(pageNum) {
    let wrapper = els.pagesContainer.querySelector(`[data-page="${pageNum}"]`);
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'page-wrapper';
      wrapper.dataset.page = pageNum;

      const canvas = document.createElement('canvas');
      const textLayer = document.createElement('div');
      textLayer.className = 'textLayer';

      wrapper.appendChild(canvas);
      wrapper.appendChild(textLayer);
      els.pagesContainer.appendChild(wrapper);
    }
    return {
      wrapper,
      canvas: wrapper.querySelector('canvas'),
      textLayer: wrapper.querySelector('.textLayer'),
    };
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
    toggleSearch,
    setSearchStatus,
    buildTOC,
    getOrCreatePageEl,
    clearPages,
    scrollToPage,
    observePages,
  };
})();
