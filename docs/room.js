(async () => {
  'use strict';
  const api = window.Api;
  const store = window.PatrolStore;
  const shared = api.configured;
  const items = window.PATROL_ITEMS;
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
  // 同じ物件・号室のタスクが【募集中】に複数ある場合は知らせる（登録先の取り違え防止）
  const norm = v => String(v ?? '').normalize('NFKC').replace(/\s+/g, '');
  const siblings = data.vacancies.filter(row => row.id !== room.id && row.p && norm(row.p) === norm(room.p) && norm(row.r) === norm(room.r));
  if (siblings.length) {
    el('sibling-note').hidden = false;
    el('sibling-note').innerHTML = `この部屋にはAsanaのタスクが他にもあります。登録先を確認してください：${siblings.map(row => `<a href="room.html?id=${encodeURIComponent(row.id)}">${esc(row.s || '状態なし')}${row.c ? `・${esc(row.c)}` : ''}のタスク</a>`).join('、')}（このページは「${esc(room.s || '状態なし')}${room.c ? `・${esc(room.c)}` : ''}」のタスク）`;
  }
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

  // 鍵種別（Asanaの既存項目）
  const keyOptions = data.keyOptions?.length ? data.keyOptions : ['キーボックス','アンロック','オペロ','EDロック','ビットキー','ビットキー（EDロック）'];
  el('key-type').innerHTML += keyOptions.map(name => `<option>${esc(name)}</option>`).join('');
  const nonElectronic = () => (window.NON_ELECTRONIC_KEYS || []).includes(el('key-type').value || room.k || '');

  // 前回の巡回記録（巡回確認）の結果を初期表示にする。Asanaの項目（プロパティ）は使わない。ステージングは記録がなければ空室状況で補う
  const asanaStaging = room.c === 'ステージング完了';
  let lastChecks = {};
  const initialValue = item => {
    const v = lastChecks[item.key];
    if (v === true || v === false || v === 'na') return v;
    if (item.key === 'staging') return asanaStaging;
    if (item.key === 'keyBattery' && nonElectronic()) return 'na';
    return false;
  };
  const showSource = () => {
    const known = Object.values(lastChecks).some(v => v !== null && v !== undefined);
    el('staging-source').textContent = (known
      ? '前回の巡回記録の結果を初期表示にしています。現地で確認して変更してください。'
      : 'この部屋の巡回記録はまだありません。現地で確認してチェックしてください。')
      + (lastChecks.staging == null && asanaStaging ? '（ステージングはAsanaの空室状況「ステージング完了」から仮チェック）' : '');
  };

  // 項目カード・該当なし・写真欄を生成
  el('check-grid').insertAdjacentHTML('beforeend', items.map(item => `
    <label class="check-card" data-card="${item.key}"><input type="checkbox" name="${item.key}"><span class="check-mark" aria-hidden="true">✓</span><span>${esc(item.name)}</span><span class="check-sub">✓＝${esc(item.ok)}／なし＝${esc(item.ng)}${item.task ? `→「${esc(item.task)}」` : ''}</span></label>
    <div class="photo-block" data-extra="${item.key}" hidden>
      ${item.na ? `<label class="na-toggle"><input type="checkbox" name="${item.key}__na">${esc(item.na)}</label>` : ''}
    </div>`).join(''));
  const form = el('room-form');
  const valueOf = item => item.na && form.elements[`${item.key}__na`].checked ? 'na' : Boolean(form.elements[item.key].checked);
  const setValue = (item, v) => {
    form.elements[item.key].checked = v === true;
    if (item.na) form.elements[`${item.key}__na`].checked = v === 'na';
  };
  const refreshCards = () => items.forEach(item => {
    const v = valueOf(item);
    const extra = form.querySelector(`[data-extra="${item.key}"]`);
    extra.hidden = !item.na;
    form.querySelector(`[data-card="${item.key}"]`).classList.toggle('is-na', v === 'na');
    if (v === 'na') form.elements[item.key].checked = false;
  });
  form.addEventListener('change', event => {
    const name = event.target.name || '';
    if (name.endsWith('__na') && event.target.checked) form.elements[name.slice(0, -4)].checked = false;
    const item = items.find(x => x.key === name);
    if (item?.na && event.target.checked) form.elements[`${item.key}__na`].checked = false;
    refreshCards();
  });
  el('key-type').addEventListener('change', () => {
    const battery = items.find(x => x.key === 'keyBattery');
    if (battery && nonElectronic()) setValue(battery, 'na');
    refreshCards();
  });

  // 写真：端末で縮小（長辺1600px・JPEG）してから送る
  const photos = {};
  const shrink = file => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      resolve({dataUrl, data: dataUrl.split(',')[1]});
    };
    img.onerror = () => {URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした'));};
    img.src = url;
  });
  const renderThumbs = key => {
    const box = el('thumbs-general');
    box.innerHTML = (photos[key] || []).map((p, i) => `<img src="${p.dataUrl}" alt="写真${i + 1}" title="押すと削除" data-remove="${key}|${i}">`).join('');
  };
  const addPhotos = async (key, files) => {
    for (const file of files) {
      try { photos[key] = [...(photos[key] || []), {...(await shrink(file)), name: file.name}]; }
      catch (err) { message(err.message, true); }
    }
    renderThumbs(key);
  };
  form.addEventListener('change', event => {
    const key = event.target.id === 'photo-general' ? 'general' : null;
    if (key && event.target.files?.length) { addPhotos(key, [...event.target.files]); event.target.value = ''; }
  });
  form.addEventListener('click', event => {
    const target = event.target.dataset?.remove;
    if (!target) return;
    const [key, index] = target.split('|');
    photos[key].splice(Number(index), 1);
    renderThumbs(key);
  });
  // 写真は「その他の写真」のみ。登録時に「その他不備」タスクを作って添付する
  const photoList = () => (photos.general || []).map(p => ({name: p.name, data: p.data}));

  const today = store.today();
  const message = (text, error) => {el('save-message').textContent = text; el('save-message').classList.toggle('error', Boolean(error));};
  const updatePreview = () => {el('next-preview').textContent = store.addDays(el('visit-date').value,45) || '—';};
  const resetForm = () => {
    form.reset();
    el('visit-date').value = today;
    el('key-type').value = keyOptions.includes(room.k) ? room.k : '';
    items.forEach(item => setValue(item, initialValue(item)));
    Object.keys(photos).forEach(key => {photos[key] = []; renderThumbs(key);});
    const pref = api.prefs.get();
    el('inspector').value = pref.inspector || '';
    el('passcode').value = pref.passcode || '';
    updatePreview();
    refreshCards();
  };
  el('visit-date').max = today;
  el('visit-date').addEventListener('change',updatePreview);
  document.querySelectorAll('.shared-only').forEach(node => {node.hidden = !shared;});
  if (!shared) {
    el('submit-button').textContent = '巡回記録を保存';
    el('storage-note').textContent = '共有保存は未接続のため、巡回記録はこのブラウザ内にのみ保存されます。';
  }
  resetForm();

  // 履歴・最新状態
  el('history-check').innerHTML += '<option value="issues">要対応あり</option>' + items.map(item => `<option value="${item.key}">${esc(item.name)}：${esc(item.ng)}</option>`).join('');
  const mark = (item, value) => value === null || value === undefined ? '<span class="check-unknown">未記録</span>'
    : value === 'na' ? `<span class="check-unknown">${esc(item.na || '該当なし')}</span>`
    : value ? `<span class="check-yes">✓ ${esc(item.ok)}</span>` : `<span class="check-no">— ${esc(item.ng)}</span>`;
  const issuesOf = record => items.filter(item => record.checks?.[item.key] === false).map(item => `${item.name}：${item.ng}`);
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
    const filtered=records.filter(record => (!from||record.date>=from)&&(!to||record.date<=to)
      &&(check==='all'||(check==='issues'?issuesOf(record).length>0:record.checks?.[check]===false))
      &&(!query||`${record.note||''} ${record.inspector||''}`.toLowerCase().includes(query)));
    el('history-count').textContent = `${filtered.length}件 / 全${records.length}件`;
    el('latest-checks').innerHTML = latest?.checks
      ? items.map(item => `<div class="check-summary-row"><span>${esc(item.name)}</span>${mark(item, latest.checks[item.key])}</div>`).join('') + (latest.keyType ? `<div class="check-summary-row"><span>鍵種別</span><span>${esc(latest.keyType)}</span></div>` : '')
      : '<p class="empty">この部屋の詳細チェックはまだ登録されていません。</p>';
    el('history-body').innerHTML = filtered.length ? filtered.map(record => {
      const issues = issuesOf(record);
      return `<tr><td>${esc(record.date)}</td><td>${esc(record.nextDate || store.addDays(record.date,45) || '—')}</td><td class="issue-list">${issues.length ? issues.map(x => `<span class="badge warn">${esc(x)}</span>`).join(' ') : record.checks && !record.otherIssue ? '<span class="badge good">なし</span>' : record.checks ? '' : '<span class="check-unknown">未記録</span>'}${record.otherIssue ? ` <span class="badge warn">その他：${esc(record.otherIssue)}</span>` : ''}</td><td>${esc(record.keyType || '')}</td><td>${record.photoCount ? `${record.photoCount}枚` : ''}</td><td>${esc(record.inspector || '')}</td><td>${esc(record.note || '')}</td></tr>`;
    }).join('') : '<tr><td colspan="7" class="empty">条件に合う巡回履歴はありません</td></tr>';
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
      items.forEach(item => setValue(item, rec.checks && item.key in rec.checks ? Boolean(rec.checks[item.key]) : initialValue(item)));
      el('visit-note').value = rec.note || '';
      loadedLocal = rec;
      updatePreview();
      refreshCards();
      message('旧記録を読み込みました。追加された項目を現地の記録に合わせてチェックしてから登録してください。');
      form.scrollIntoView({behavior:'smooth',block:'start'});
    }));
  };
  ['history-from','history-to','history-check','history-query'].forEach(key => el(key).addEventListener(key==='history-query'?'input':'change',render));

  let pending = null;
  const showPreview = visible => {
    el('preview').hidden = !visible;
    el('submit-button').hidden = visible;
    form.querySelectorAll('input,textarea,select').forEach(input => {input.disabled = visible;});
  };
  const collect = () => {
    const checks = Object.fromEntries(items.map(item => [item.key, valueOf(item)]));
    return {
      task: id,
      date: el('visit-date').value,
      checks,
      keyType: el('key-type').value,
      photoCount: photoList().length,
      otherIssue: el('other-issue').value.trim(),
      note: el('visit-note').value.trim(),
      inspector: el('inspector').value.trim(),
      passcode: el('passcode').value
    };
  };
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
    const list = photoList();
    message(list.length ? `Asanaに登録しています（写真${list.length}枚を送信中）…` : 'Asanaに登録しています…');
    try {
      const result = await api.savePatrol({...pending, photos: list});
      api.prefs.set({inspector: pending.inspector, passcode: pending.passcode});
      if (loadedLocal) api.prefs.set({migrated: [...(api.prefs.get().migrated || []), migratedKey(loadedLocal)]});
      loadedLocal = null;
      pending = null;
      showPreview(false);
      resetForm();
      message(`${result.duplicate ? '登録済みの記録でした' : 'Asanaに登録しました'}。次回巡回予定は${result.nextDate}です。${result.actions?.length ? `（${result.actions.join('／')}）` : ''}${result.photos ? `写真${result.photos}枚を添付しました。` : ''}`);
      await loadRecords(); lastChecks = records[0]?.checks || {}; showSource(); resetForm(); render();
    } catch (err) {
      message(`登録できませんでした：${err.message}（もう一度押しても二重登録にはなりません）`, true);
    } finally {
      el('confirm-button').disabled = false;
    }
  });
  await loadRecords();
  lastChecks = records[0]?.checks || {};
  showSource();
  resetForm();
  render();
})();
