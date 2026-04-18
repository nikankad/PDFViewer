// IndexedDB persistence layer for files and highlights

const Storage = (() => {
  const DB_NAME    = 'pdfviewer';
  const DB_VERSION = 1;
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('highlights')) {
          db.createObjectStore('highlights', { keyPath: 'fileId' });
        }
      };
      req.onsuccess = e => { _db = e.target.result; resolve(_db); };
      req.onerror   = e => reject(e.target.error);
    });
  }

  function tx(storeName, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode);
      const store = t.objectStore(storeName);
      const req = fn(store);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    }));
  }

  async function sha256(arrayBuffer) {
    const hash = await crypto.subtle.digest('SHA-256', arrayBuffer);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function saveFile(name, arrayBuffer) {
    const id = await sha256(arrayBuffer);
    await tx('files', 'readwrite', store => store.put({
      id,
      name,
      size: arrayBuffer.byteLength,
      lastOpened: Date.now(),
      bytes: arrayBuffer,
    }));
    return id;
  }

  async function touchFile(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction('files', 'readwrite');
      const store = t.objectStore('files');
      const getReq = store.get(id);
      getReq.onsuccess = e => {
        const rec = e.target.result;
        if (rec) { rec.lastOpened = Date.now(); store.put(rec); }
        resolve();
      };
      getReq.onerror = e => reject(e.target.error);
    });
  }

  async function getFile(id) {
    const rec = await tx('files', 'readonly', store => store.get(id));
    return rec ? rec.bytes : null;
  }

  async function listRecent() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction('files', 'readonly');
      const store = t.objectStore('files');
      const req = store.getAll();
      req.onsuccess = e => {
        const all = e.target.result.map(({ id, name, size, lastOpened }) => ({ id, name, size, lastOpened }));
        all.sort((a, b) => b.lastOpened - a.lastOpened);
        resolve(all);
      };
      req.onerror = e => reject(e.target.error);
    });
  }

  async function deleteFile(id) {
    await tx('files', 'readwrite', store => store.delete(id));
    await tx('highlights', 'readwrite', store => store.delete(id));
  }

  async function saveHighlights(fileId, highlights) {
    await tx('highlights', 'readwrite', store => store.put({ fileId, highlights }));
  }

  async function getHighlights(fileId) {
    const rec = await tx('highlights', 'readonly', store => store.get(fileId));
    return rec ? rec.highlights : [];
  }

  async function clearAllHighlights() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction('highlights', 'readwrite');
      const req = t.objectStore('highlights').clear();
      req.onsuccess = () => resolve();
      req.onerror = e => reject(e.target.error);
    });
  }

  function getSetting(key, defaultVal) {
    const v = localStorage.getItem('pdfviewer.' + key);
    return v === null ? defaultVal : JSON.parse(v);
  }

  function setSetting(key, val) {
    localStorage.setItem('pdfviewer.' + key, JSON.stringify(val));
  }

  return { saveFile, touchFile, getFile, listRecent, deleteFile, saveHighlights, getHighlights, sha256, clearAllHighlights, getSetting, setSetting };
})();
