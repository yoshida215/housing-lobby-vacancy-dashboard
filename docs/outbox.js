(() => {
  'use strict';
  // 送信待ち（巡回登録）：電波が悪い・Asanaが不調などで送れなかった登録を端末に保存し、つながったら自動で再送する。
  // サーバー側は登録IDで重複を防ぐので、何度再送しても二重登録にはならない。写真も含めて IndexedDB に保存する。
  const DB = 'housing-lobby-outbox', STORE = 'patrols';
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, {keyPath: 'clientId'});
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode), store = t.objectStore(STORE);
      const result = fn(store);
      t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
      t.onerror = () => reject(t.error);
    });
  };
  const listeners = new Set();
  const notify = async () => { const items = await list().catch(() => []); listeners.forEach(fn => fn(items)); };
  const list = () => tx('readonly', store => store.getAll());
  const put = async item => { await tx('readwrite', store => store.put(item)); notify(); };
  const remove = async clientId => { await tx('readwrite', store => store.delete(clientId)); notify(); };
  let flushing = false;
  const flush = async () => {
    if (flushing || !window.Api?.configured || navigator.onLine === false) return;
    flushing = true;
    try {
      for (const item of (await list()).filter(i => !i.stopped)) {
        try {
          await window.Api.savePatrol(item.body);
          await remove(item.clientId);
        } catch (err) {
          await put({...item, tries: (item.tries || 0) + 1, lastError: err.message, stopped: err.retryable === false});
          if (err.retryable !== false) break; // まだつながらない。次の機会に
        }
      }
    } finally { flushing = false; notify(); }
  };
  window.Outbox = {
    add: (body, label) => put({clientId: body.clientId, body, label, savedAt: new Date().toISOString(), tries: 0}),
    list, remove, flush,
    onChange: fn => { listeners.add(fn); notify(); }
  };
  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flush(); });
  setInterval(flush, 60000);
  setTimeout(flush, 1500);
})();
