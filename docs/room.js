(async () => {
  'use strict';
  const api = window.Api;
  const store = window.PatrolStore;
  const shared = api.configured;
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const id = new URLSearchParams(location.search).get('id');
  const data = await api.snapshot();
  const room = data.vacancies.find(row => row.id === id);
  el('asof').textContent = `Asana取得 ${new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(data.asOf))}${data.live ? '' : '（固定データ）'}`;
  if (!room) {el('room-not-found').hidden=false;return;}
  el('room-content').hidden = false;
  el('room-name').textContent = `${room.p || '物件名なし'} ${room.r || '号室なし'}`;
  el('room-meta').textContent = `${room.a || '地区なし'} ／ ${room.m || '管理種別なし'} ／ ${room.s || '状態なし'}`;
  el('asana-link').href = `https://app.asana.com/0/1201255767385595/${encodeURIComponent(room.id)}`;
  const propertyKey = String(room.p || '').normalize('NFKC').replace(/[\s・･.．\-‐‑–—－_（）()]+/g,'').toLowerCase();
  const propertyLocation = window.HOUSING_ADDRESSES?.properties[`${propertyKey}|${room.a || ''}`];
  el('room-address').textContent = propertyLocation?.address || '住所を確認中';
  el('location-help').textContent = propertyLocation?.address
    ? '車でのルートを開きます。出発地はGoogleマップで変更できます。'
    : '住所を確認でき次第、ルート検索を利用できます。';
  if (propertyLocation?.address) {
    const route = new URL('https://www.google.com/maps/dir/');
    route.search = new URLSearchParams({api:'1',destination:propertyLocation.address,travelmode:'driving'}).toString();
    el('route-link').href = route.href;
    el('route-link').hidden = false;
  }
  const asanaStaging = room.c === 'ステージング完了';
  // Asanaの現地確認項目（のぼり等）に値があればそれを初期チェックにする。ステージングは未入力なら空室状況で補う
  const asanaChecks = room.f || {};
  const initialCheck = key => asanaChecks[key] === true || (key === 'staging' && asanaChecks.staging == null && asanaStaging);
  const knownCount = Object.values(asanaChecks).filter(v => v !== null && v !== undefined).length;
  el('staging-source').textContent = (knownCount
    ? 'Asanaの現地確認項目の値を初期チェックにしています。現地で確認して変更してください。'
    : 'Asanaの現地確認項目はまだ未入力です。現地で確認してチェックしてください。')
    + (asanaChecks.staging == null ? (asanaStaging ? '（ステージングはAsanaの空室状況「ステージング完了」から仮チェック）' : '') : '');
  const labels = [
    ['nobori','のぼり'],
    ['recruitmentSign','募集看板'],
    ['managementSign','管理看板'],
    ['welcomeSet','ウェルカムセット'],
    ['staging','ステージング']
  ];
  const form = el('room-form');
  const today = store.today();
  const message = (text, error) => {el('save-message').textContent = text; el('save-message').classList.toggle('error', Boolean(error));};
  const resetForm = () => {
    form.reset();
    el('visit-date').value = today;
    labels.forEach(([key]) => {form.elements[key].checked = initialCheck(key);});
    const pref = api.prefs.get();
    el('inspector').value = pref.inspector || '';
    el('passcode').value = pref.passcode || '';
    updatePreview();
  };
  el('visit-date').max = today;
  const updatePreview = () => {el('next-preview').textContent = store.addDays(el('visit-date').value,45) || '—';};
  el('visit-date').addEventListener('change',updatePreview);
  document.querySelectorAll('.shared-only').forEach(node => {node.hidden = !shared;});
  if (!shared) {
    el('submit-button').textContent = '巡回記録を保存';
    el('storage-note').textContent = '共有保存は未接続のため、巡回記録はこのブラウザ内にのみ保存されます。';
  }
  resetForm();

  const mark = value => value === null || value === undefined ? '<span class="check-unknown">未記録</span>' : value ? '<span class="check-yes">✓ あり</span>' : '<span class="check-no">— なし</span>';
  let records = [];
  const loadRecords = async () => {
    if (!shared) {records = store.forRoom(id); return;}
    el('history-count').textContent = '読み込み中…';
    try {records = (await api.patrols(id)).records;}
    catch (err) {records = []; message(`Asanaの巡回履歴を読み込めませんでした：${err.message}`, true);}
  };
  const render = () => {
    const latest = records[0];
    el('last-patrol').textContent = latest?.date || '未登録';
    el('next-patrol').textContent = latest?.nextDate || '未設定';
    const from=el('history-from').value,to=el('history-to').value,check=el('history-check').value,query=el('history-query').value.trim().toLowerCase();
    const filtered=records.filter(record => (!from||record.date>=from)&&(!to||record.date<=to)&&(check==='all'||record.checks?.[check]===true)&&(!query||`${record.note||''} ${record.inspector||''}`.toLowerCase().includes(query)));
    el('history-count').textContent = `${filtered.length}件 / 全${records.length}件`;
    el('latest-checks').innerHTML = latest?.checks
      ? labels.map(([key,label]) => `<div class="check-summary-row"><span>${label}</span>${mark(latest.checks[key])}</div>`).join('')
      : '<p class="empty">この部屋の詳細チェックはまだ登録されていません。</p>';
    el('history-body').innerHTML = filtered.length ? filtered.map(record => `<tr><td>${esc(record.date)}</td><td>${esc(record.nextDate || store.addDays(record.date,45) || '—')}</td>${labels.map(([key]) => `<td>${mark(record.checks?.[key])}</td>`).join('')}<td>${esc(record.inspector || '')}</td><td>${esc(record.note || '')}</td></tr>`).join('') : '<tr><td colspan="9" class="empty">条件に合う巡回履歴はありません</td></tr>';
    renderLocal();
  };

  // このブラウザに残っている旧記録（共有保存前）をAsanaへ移す
  const migratedKey = rec => `${id}|${rec.date}|${rec.savedAt || ''}`;
  let loadedLocal = null;
  const renderLocal = () => {
    const box = el('local-records');
    if (!shared) {box.hidden = true; return;}
    const done = new Set(api.prefs.get().migrated || []);
    const local = store.forRoom(id).filter(rec => !done.has(migratedKey(rec)));
    box.hidden = !local.length;
    if (!local.length) return;
    box.innerHTML = `<h3>このブラウザだけに残っている記録（${local.length}件）</h3><p class="location-help">共有保存の前に入力された記録です。読み込んで内容を確認し、Asanaへ登録してください。</p>${local.map((rec,i) => `<div class="check-summary-row"><span>${esc(rec.date)}${rec.note ? `／${esc(rec.note.slice(0,20))}` : ''}</span><button type="button" class="secondary-button" data-local="${i}">フォームに読み込む</button></div>`).join('')}`;
    box.querySelectorAll('[data-local]').forEach(button => button.addEventListener('click', () => {
      const rec = local[Number(button.dataset.local)];
      el('visit-date').value = rec.date;
      labels.forEach(([key]) => {form.elements[key].checked = rec.checks ? Boolean(rec.checks[key]) : initialCheck(key);});
      el('visit-note').value = rec.note || '';
      loadedLocal = rec;
      updatePreview();
      message(rec.checks ? '旧記録を読み込みました。内容を確認して登録してください。' : '旧記録には5項目のチェックがありません。現地の記録に合わせてチェックしてから登録してください。');
      form.scrollIntoView({behavior:'smooth',block:'start'});
    }));
  };
  ['history-from','history-to','history-check','history-query'].forEach(key => el(key).addEventListener(key==='history-query'?'input':'change',render));

  let pending = null;
  const showPreview = visible => {
    el('preview').hidden = !visible;
    el('submit-button').hidden = visible;
    form.querySelectorAll('input,textarea').forEach(input => {input.disabled = visible;});
  };
  const collect = () => ({
    task: id,
    date: el('visit-date').value,
    checks: Object.fromEntries(labels.map(([key]) => [key,Boolean(form.elements[key].checked)])),
    note: el('visit-note').value.trim(),
    inspector: el('inspector').value.trim(),
    passcode: el('passcode').value
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const body = collect();
    if (!body.date || body.date > today) {message('巡回日は今日以前の日付を入力してください。', true);return;}
    if (!shared) {
      try {
        store.save(id,{date:body.date,checks:body.checks,note:body.note,source:'巡回入力'});
        message(`保存しました。次回巡回予定は${store.addDays(body.date,45)}です。`);
        await loadRecords(); render(); resetForm();
      } catch {message('保存できませんでした。ブラウザの保存設定を確認してください。', true);}
      return;
    }
    if (!body.inspector) {message('担当者名を入力してください。', true);return;}
    if (!body.passcode) {message('巡回登録の合言葉を入力してください。', true);return;}
    pending = {...body, clientId: pending?.clientId || api.newId()};
    message('確認内容を作成しています…');
    try {
      const preview = await api.previewPatrol(pending);
      el('preview-text').textContent = preview.text + (preview.actions?.length ? `\n\n▼ あわせてAsanaで行う更新\n${preview.actions.map(line => `・${line}`).join('\n')}` : '');
      showPreview(true);
      message('');
    } catch (err) {message(`確認できませんでした：${err.message}`, true);}
  });
  el('cancel-button').addEventListener('click', () => {showPreview(false); message('');});
  el('confirm-button').addEventListener('click', async () => {
    if (!pending) return;
    el('confirm-button').disabled = true;
    message('Asanaに登録しています…');
    try {
      const result = await api.savePatrol(pending);
      api.prefs.set({inspector: pending.inspector, passcode: pending.passcode});
      if (loadedLocal) api.prefs.set({migrated: [...(api.prefs.get().migrated || []), migratedKey(loadedLocal)]});
      loadedLocal = null;
      pending = null;
      showPreview(false);
      resetForm();
      message(`${result.duplicate ? '登録済みの記録でした' : 'Asanaに登録しました'}。次回巡回予定は${result.nextDate}です。${result.actions?.length ? `（${result.actions.join('／')}）` : ''}`);
      await loadRecords(); render();
    } catch (err) {
      message(`登録できませんでした：${err.message}（もう一度押しても二重登録にはなりません）`, true);
    } finally {
      el('confirm-button').disabled = false;
    }
  });
  await loadRecords();
  render();
})();
