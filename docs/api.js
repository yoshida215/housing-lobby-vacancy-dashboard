(() => {
  'use strict';
  const cfg = window.APP_CONFIG || {};
  const apiUrl = String(cfg.apiUrl || '').trim();
  const PREF_KEY = 'housing-lobby-dashboard-prefs-v1';
  const prefs = {
    get() { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch { return {}; } },
    set(patch) { try { localStorage.setItem(PREF_KEY, JSON.stringify({...prefs.get(), ...patch})); } catch {} }
  };
  const request = async (params, body) => {
    const url = new URL(apiUrl);
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url.href, body
      ? {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'}, body: JSON.stringify(body)}
      : {method: 'GET'});
    if (!res.ok) throw new Error(`通信エラー（${res.status}）`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  };
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
      try { return await request({action: 'snapshot', ...(refresh ? {refresh: '1'} : {})}); }
      catch (err) { const data = fallbackSnapshot(); data.error = err.message; return data; }
    },
    patrols: task => request({action: 'patrols', task}),
    status: () => request({action: 'ping'}),
    promotion: (month, refresh) => {
      if (!apiUrl) return Promise.reject(new Error('共有データに接続していません'));
      return request({action: 'promotion', month, ...(refresh ? {refresh: '1'} : {})});
    },
    previewPatrol: body => request(null, {action: 'previewPatrol', ...body}),
    savePatrol: body => request(null, {action: 'savePatrol', ...body}),
    setManagement: body => request(null, {action: 'setManagement', ...body}),
    newId: () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)
  };
})();
