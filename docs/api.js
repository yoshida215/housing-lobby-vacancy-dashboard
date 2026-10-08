(() => {
  'use strict';
  const cfg = window.APP_CONFIG || {};
  const apiUrl = String(cfg.apiUrl || '').trim();
  const PREF_KEY = 'housing-lobby-dashboard-prefs-v1';
  const prefs = {
    get() { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch { return {}; } },
    set(patch) { try { localStorage.setItem(PREF_KEY, JSON.stringify({...prefs.get(), ...patch})); } catch {} }
  };
  // エラーには retryable を付ける（true＝通信・Asanaの一時的な問題で、あとで自動再送してよい）
  const fail = (message, retryable) => { const e = new Error(message); e.retryable = retryable; return e; };
  // すべてPOST。社内ログインのトークンは本文に入れる（ヘッダーに付けるとGASがCORSの事前確認に応えられない。URLにも載せない）
  const request = async (params, body, timeoutMs = 90000, {interactive = true} = {}) => {
    const payload = {...(params || {}), ...(body || {})};
    if (window.Auth) payload.token = await window.Auth.token({interactive});
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(apiUrl, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'}, body: JSON.stringify(payload), signal: ctrl.signal});
    } catch (err) {
      throw fail(err.name === 'AbortError' ? '応答がありません（時間切れ）' : '通信できません（電波・ネット接続を確認してください）', true);
    } finally { clearTimeout(timer); }
    if (!res.ok) throw fail(`通信エラー（${res.status}）`, res.status >= 500 || res.status === 429);
    let data;
    try { data = await res.json(); } catch { throw fail('サーバーの応答を読み取れません', true); }
    if (data.auth && window.Auth) {
      if (interactive) { await window.Auth.login(); return new Promise(() => {}); }
      throw fail(data.error, true); // 送信待ちは、ログインし直したあとに再送する
    }
    if (data.error) throw fail(data.error, Boolean(data.retryable));
    return data;
  };
  // 最後に取得できたデータを端末にも保存（サーバーにもつながらないときの予備）
  const LAST_KEY = 'housing-lobby-last-snapshot-v1';
  const saveLocal = data => { try { localStorage.setItem(LAST_KEY, JSON.stringify(data)); } catch {} };
  const loadLocal = () => { try { return JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch { return null; } };
  // API未設定・通信失敗時は同梱スナップショットで表示する
  const fallbackSnapshot = () => {
    const s = window.HOUSING_SNAPSHOT;
    const index = {};
    const store = window.PatrolStore;
    if (store) for (const id of Object.keys(store.all())) {
      const latest = store.latest(id);
      if (latest?.date) index[id] = {date: latest.date, nextDate: latest.nextDate || store.addDays(latest.date, 45), local: true};
    }
    return {asOf: s.asOf, live: false, vacancies: s.vacancies, restorations: s.restorations, rates: {}, patrolIndex: index};
  };
  window.Api = {
    configured: Boolean(apiUrl),
    prefs,
    async snapshot(refresh) {
      if (!apiUrl) return fallbackSnapshot();
      try {
        const data = await request({action: 'snapshot', ...(refresh ? {refresh: '1'} : {})});
        saveLocal(data);
        return data;
      } catch (err) {
        const local = loadLocal();
        const data = local && local.asOf > window.HOUSING_SNAPSHOT.asOf ? {...local, live: false, stale: true} : fallbackSnapshot();
        data.error = err.message;
        return data;
      }
    },
    patrols: task => request({action: 'patrols', task}),
    status: () => request({action: 'status'}),
    promotion: (month, refresh) => {
      if (!apiUrl) return Promise.reject(new Error('共有データに接続していません'));
      return request({action: 'promotion', month, ...(refresh ? {refresh: '1'} : {})});
    },
    reportData: body => request(null, {action: 'reportData', ...body}, 120000),
    lpStatus: task => request({action: 'lpStatus', task}),
    lpRequest: body => request(null, {action: 'lpRequest', ...body}),
    previewPatrol: body => request(null, {action: 'previewPatrol', ...body}),
    savePatrol: (body, opts) => request(null, {action: 'savePatrol', ...body}, 90000, opts),
    setManagement: body => request(null, {action: 'setManagement', ...body}),
    newId: () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)
  };
})();
