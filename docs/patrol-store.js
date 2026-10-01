(() => {
  'use strict';
  const KEY = 'housing-lobby-vacancy-prototype-patrol-v2';
  const LEGACY_KEY = 'housing-lobby-vacancy-prototype-patrol-v1';
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const addDays = (date, days) => {
    if (!datePattern.test(date)) return null;
    const [year, month, day] = date.split('-').map(Number);
    const result = new Date(Date.UTC(year, month - 1, day + days));
    return result.toISOString().slice(0, 10);
  };
  const read = key => {
    try { const value = JSON.parse(localStorage.getItem(key) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
    catch { return {}; }
  };
  const all = () => {
    const records = read(KEY);
    const legacy = read(LEGACY_KEY);
    for (const [id, item] of Object.entries(legacy)) {
      if (Array.isArray(records[id]) || !datePattern.test(item?.date || '')) continue;
      records[id] = [{date:item.date,nextDate:addDays(item.date,45),note:item.note||'',checks:null,source:'旧試作版'}];
    }
    return records;
  };
  const forRoom = id => (all()[id] || []).slice().sort((a,b) => b.date.localeCompare(a.date) || (b.savedAt||'').localeCompare(a.savedAt||''));
  const latest = id => forRoom(id)[0] || null;
  const save = (id, record) => {
    if (!/^\d+$/.test(String(id)) || !datePattern.test(record?.date || '')) throw new Error('物件または巡回日が正しくありません');
    const records = all();
    const item = {...record,nextDate:addDays(record.date,45),savedAt:new Date().toISOString()};
    records[id] = [...(records[id]||[]),item];
    localStorage.setItem(KEY,JSON.stringify(records));
    return item;
  };
  const today = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  window.PatrolStore = {all,forRoom,latest,save,addDays,today};
})();
