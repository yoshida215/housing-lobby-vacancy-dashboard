(async () => {
  'use strict';
  const el = id => document.getElementById(id);
  el('data-notice').textContent = 'データを読み込んでいます…';
  const data = await window.Api.snapshot(new URLSearchParams(location.search).get('refresh') === '1');
  const todayJst = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const currentMonth = todayJst.slice(0, 7);
  const months = Object.keys(data.rates || {}).filter(m => m <= currentMonth).sort();
  const latestMonth = months[months.length - 1] || null;
  const monthLabel = m => m ? `${Number(m.slice(0,4))}年${Number(m.slice(5))}月` : '—';
  const areas = ['長崎中央', '長崎北', '諫早', '大村'];
  const keys = ['sub', 'general'];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const norm = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  const fmt = value => Number(value).toLocaleString('ja-JP');
  const dateTime = value => new Intl.DateTimeFormat('ja-JP', {timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
  const taskUrl = id => `https://app.asana.com/0/1201255767385595/${encodeURIComponent(id)}`;
  const roomUrl = id => `room.html?id=${encodeURIComponent(id)}`;
  const sourceUrl = id => `https://app.asana.com/0/1206192676880472/${encodeURIComponent(id)}`;
  const category = row => {
    if (row.s === '空室中' && ['原状回復完了', 'ステージング完了'].includes(row.c)) return '①';
    if (row.s === '空室中' && row.c === '工事掃除中') return '②';
    if (row.s === '入居中（退去予定）') return '③';
    if (row.s === '募集止め') return '④';
    return 'other';
  };
  const group = row => row.m === 'サブ' ? 'sub' : ['一般管理', 'セキスイ物件'].includes(row.m) ? 'general' : null;
  const included = row => areas.includes(row.a) && Boolean(group(row));
  // 管理戸数は非公開。GASが計算した率だけを使う。当月分が無ければ最新の登録月（会議資料の実績月）を分母とする
  const rateMonth = latestMonth;
  const R = rateMonth ? data.rates[rateMonth] : null;
  const managementCurrent = Boolean(R);
  const pctOf = value => value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`;
  const emptyCounts = () => ({'①':0,'②':0,'③':0,'④':0,'⑤':0,other:0});
  const counts = {};
  for (const area of areas) for (const key of keys) counts[`${area}|${key}`] = emptyCounts();
  for (const row of data.vacancies) {
    if (!included(row)) continue;
    const bucket = counts[`${row.a}|${group(row)}`];
    bucket[category(row)]++;
    if (row.w === '14日免除') bucket['⑤']++;
  }
  const total = emptyCounts();
  for (const area of areas) for (const key of keys) {
    for (const type of Object.keys(total)) total[type] += counts[`${area}|${key}`][type];
  }
  const occupancy = r => managementCurrent ? pctOf(r?.occ) : '更新待ち';
  const evaluated = r => managementCurrent ? pctOf(r?.ev) : '更新待ち';
  const baseLabel = managementCurrent ? `管理戸数：${monthLabel(rateMonth)}実績（会議資料）` : '';
  const badge = (value, tone='muted') => `<span class="badge ${tone}">${esc(value)}</span>`;

  el('asof').textContent = `Asana取得 ${dateTime(data.asOf)}${data.live ? '（最新）' : '（固定データ）'} ／ ${managementCurrent ? baseLabel : '管理戸数 未登録'}`;
  const notices = [];
  if (data.error) notices.push(`最新データを取得できなかったため、${dateTime(data.asOf)}時点の固定データで表示しています（${data.error}）。`);
  else if (!data.live) notices.push(`${dateTime(data.asOf)}時点の固定データです。`);
  else notices.push('Asanaの最新データを表示しています（最大10分前）。巡回記録はAsanaの物件タスクの「巡回確認（日付）」サブタスクに蓄積されます。');
  if (!managementCurrent) notices.push('管理戸数が未登録のため、入居率・評価入居率は表示しません。');
  else if (rateMonth !== currentMonth) notices.push(`入居率の分母は最新の会議資料（${monthLabel(rateMonth)}実績）の管理戸数です。`);
  el('data-notice').textContent = notices.join(' ');
  const activateView = name => {
    const selected = ['overview','occupancy','restoration','patrol','promotion'].includes(name) ? name : 'overview';
    if (selected === 'promotion') window.dispatchEvent(new Event('promotion:show'));
    document.querySelectorAll('.tab').forEach(tab => {const active=tab.dataset.view===selected;tab.classList.toggle('active',active);if(active)tab.setAttribute('aria-current','page');else tab.removeAttribute('aria-current');});
    document.querySelectorAll('.view').forEach(view => {const active=view.id===`view-${selected}`;view.classList.toggle('active',active);view.hidden=!active;});
  };
  document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => {location.hash=button.dataset.view;activateView(button.dataset.view);}));
  window.addEventListener('hashchange',() => activateView(location.hash.slice(1)));
  activateView(location.hash.slice(1));

  const excluded = data.vacancies.filter(row => !included(row)).length;
  el('kpis').innerHTML = [
    ['入居率', occupancy(R?.total), managementCurrent ? baseLabel : '管理戸数を確認中', 'featured'],
    ['評価入居率', evaluated(R?.total), managementCurrent ? '⑤14日免除を反映' : '管理戸数を確認中', ''],
    ['原復済の空室', `${fmt(total['①'])}戸`, 'ステージング完了を含む', ''],
    ['要確認', `${fmt(total.other + excluded)}件`, `分類外 ${total.other}件／対象外 ${excluded}件`, '']
  ].map(([label,value,note,tone]) => `<div class="kpi ${tone}"><div class="label">${label}</div><strong>${value}</strong><small>${note}</small></div>`).join('');
  el('area-bars').innerHTML = areas.map(area => {
    const c = emptyCounts();
    for (const key of keys) for (const type of Object.keys(c)) c[type] += counts[`${area}|${key}`][type];
    const rate = (R?.areas?.[area]?.occ ?? 0) * 100;
    return `<div class="bar-row"><span>${area}</span><div class="track"><div class="fill" style="width:${managementCurrent ? Math.max(0,Math.min(100,rate)) : 0}%"></div></div><strong>${occupancy(R?.areas?.[area])}</strong></div>`;
  }).join('');
  el('exceptions').innerHTML = [
    ['①〜④に分類できない', total.other],
    ['地区・管理種別が集計対象外', excluded],
    ['14日ルール完了・募集中で未照合', data.restorations.filter(x => !data.vacancies.some(y => norm(x.p)===norm(y.p) && norm(x.r)===norm(y.r))).length]
  ].map(([label,n]) => `<div class="exception-row"><span>${esc(label)}</span><strong>${fmt(n)}件</strong></div>`).join('');
  const summaryRows = [];
  for (const area of areas) for (const key of keys) {
    const c = counts[`${area}|${key}`], r = R?.groups?.[`${area}|${key}`];
    summaryRows.push(`<tr><td><strong>${area}</strong>　${key==='sub'?'サブ':'一般'}</td><td class="num">${c['①']}</td><td class="num">${c['②']}</td><td class="num">${c['③']}</td><td class="num">${c['④']}</td><td class="num">${c['⑤']}</td><td class="num"><strong>${occupancy(r)}</strong></td><td class="num">${evaluated(r)}</td></tr>`);
  }
  summaryRows.push(`<tr class="total-row"><td>全体</td><td class="num">${total['①']}</td><td class="num">${total['②']}</td><td class="num">${total['③']}</td><td class="num">${total['④']}</td><td class="num">${total['⑤']}</td><td class="num">${occupancy(R?.total)}</td><td class="num">${evaluated(R?.total)}</td></tr>`);
  document.querySelector('#summary-table tbody').innerHTML = summaryRows.join('');

  const listingBody = el('listing-body');
  const renderListings = () => {
    const area = el('area-filter').value, status = el('status-filter').value, query = norm(el('search').value);
    const rows = data.vacancies.filter(row => (area==='all'||row.a===area) && (status==='all'||category(row)===status) && (!query||norm(`${row.p} ${row.r}`).includes(query)));
    el('listing-count').textContent = `${fmt(rows.length)}件 / 全${fmt(data.vacancies.length)}件`;
    listingBody.innerHTML = rows.length ? rows.map(row => `<tr><td><a class="room-link" href="${roomUrl(row.id)}">${esc(row.p||'物件名なし')} ${esc(row.r||'号室なし')}</a></td><td>${esc(row.a||'地区なし')}</td><td>${esc(row.m||'種別なし')}</td><td>${category(row)==='other'?badge('要確認','warn'):badge(category(row),category(row)==='①'?'good':'muted')}</td><td>${esc(row.c||'空欄')}</td><td><a href="${taskUrl(row.id)}" target="_blank" rel="noopener noreferrer">開く ↗</a></td></tr>`).join('') : '<tr><td colspan="6" class="empty">該当する物件はありません</td></tr>';
  };
  ['area-filter','status-filter','search'].forEach(id => el(id).addEventListener(id==='search'?'input':'change', renderListings));
  renderListings();

  el('completed-count').textContent = `${data.restorations.length}件`;
  el('reflected-count').textContent = `${total['①']}戸`;
  el('restoration-body').innerHTML = data.restorations.map(row => {
    const matches = data.vacancies.filter(v => norm(v.p)===norm(row.p) && norm(v.r)===norm(row.r));
    const status = matches.length===1 ? matches[0].c : null;
    const outcome = matches.length===0 ? badge('他セクションを要確認','warn') : matches.length>1 ? badge('募集中で重複','warn') : ['原状回復完了','ステージング完了'].includes(status) ? badge('反映済（募集中）','good') : badge('状態を要確認','warn');
    return `<tr><td>${esc(row.p||'物件名なし')} ${esc(String(row.r||'号室なし').trim())}</td><td>${dateTime(row.at)}</td><td>${outcome}</td><td>${esc(status||'—')}</td><td><a href="${sourceUrl(row.id)}" target="_blank" rel="noopener noreferrer">開く ↗</a></td></tr>`;
  }).join('');

  // 空室日数＝今日−解約日。長い順（解約日不明は最後）
  const dayNum = d => Date.UTC(...d.split('-').map((v,i)=>i===1?Number(v)-1:Number(v)));
  const vacancyDays = row => row.v ? Math.floor((dayNum(todayJst) - dayNum(row.v)) / 86400000) : null;
  window.DASH = {data, vacancyDays, todayJst, roomUrl, esc, norm, badge, fmt};
  const patrolRows = data.vacancies.filter(row => row.s==='空室中' && row.p && row.r)
    .sort((a,b) => (vacancyDays(b) ?? -1e9) - (vacancyDays(a) ?? -1e9) || `${a.a}${a.p}${a.r}`.localeCompare(`${b.a}${b.p}${b.r}`,'ja'));
  const daysCell = row => { const d = vacancyDays(row); return d === null ? '<span class="check-unknown">解約日不明</span>' : d < 0 ? badge('退去前','muted') : d >= 60 ? badge(`${d}日`,'warn') : `${d}日`; };
  const patrolIndex = data.patrolIndex || {};
  const latestPatrol = id => patrolIndex[id] || null;
  const renderPatrol = () => {
    const today=todayJst;
    const recorded = patrolRows.filter(row => latestPatrol(row.id)?.date).length;
    const due = patrolRows.filter(row => {const rec=latestPatrol(row.id);return !rec?.nextDate || rec.nextDate<=today;}).length;
    el('patrol-count').textContent = `${fmt(patrolRows.length)}物件`;
    el('patrol-summary').innerHTML = `<div class="summary-stat"><span>巡回記録あり</span><strong>${fmt(recorded)}件</strong></div><div class="summary-stat"><span>要巡回（未巡回・次回予定日到来）</span><strong>${fmt(due)}件</strong></div>`;
    const query=norm(el('patrol-search').value),area=el('patrol-area').value,status=el('patrol-status').value;
    const visible=patrolRows.filter(row=>{
      const rec=latestPatrol(row.id),dueNow=!rec?.nextDate||rec.nextDate<=today;
      return (!query||norm(`${row.p} ${row.r}`).includes(query)) && (area==='all'||row.a===area) && (status==='all'||(status==='due'&&dueNow)||(status==='planned'&&!dueNow));
    });
    el('patrol-body').innerHTML = visible.length ? visible.map(row => {
      const rec=latestPatrol(row.id),dueNow=!rec?.nextDate||rec.nextDate<=today;
      const asanaStage=row.c==='ステージング完了' ? badge('あり','good') : badge('未確認','muted');
      return `<tr><td><a class="room-link" href="${roomUrl(row.id)}">${esc(row.p)} ${esc(row.r)}</a></td><td class="num">${daysCell(row)}</td><td>${esc(row.a||'地区なし')}</td><td>${esc(rec?.date||'—')}</td><td>${esc(rec?.nextDate||'—')}</td><td>${dueNow?badge('要巡回','warn'):badge('予定前','good')}</td><td>${asanaStage}</td></tr>`;
    }).join('') : '<tr><td colspan="7" class="empty">該当する部屋はありません</td></tr>';
  };
  el('patrol-search').addEventListener('input',renderPatrol);
  el('patrol-area').addEventListener('change',renderPatrol);
  el('patrol-status').addEventListener('change',renderPatrol);
  renderPatrol();

  // 管理戸数の登録（月ごと・管理用合言葉が必要）
  const form = el('management-form');
  if (!window.Api.configured) { el('management-panel').hidden = true; return; }
  const prev = new Date(Date.UTC(Number(currentMonth.slice(0,4)), Number(currentMonth.slice(5)) - 2, 1)).toISOString().slice(0,7);
  form.elements.month.value = prev;
  el('management-base').textContent = `登録済み：${months.length ? months.map(monthLabel).join('、') : 'なし'}。全体会議資料「○月度（○月実績）」の実績月で登録します。登録した戸数は画面に表示されません（非公開）。`;
  el('management-inputs').innerHTML = areas.map(area => `<div class="mgmt-row"><span>${area}</span><label>サブ<input type="number" min="0" step="1" required name="${area}|sub"></label><label>一般<input type="number" min="0" step="1" required name="${area}|general"></label></div>`).join('');
  form.elements.source.value = '';
  form.elements.passcode.value = window.Api.prefs.get().adminPasscode || '';
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const msg = el('management-message');
    const body = {month: form.elements.month.value, source: form.elements.source.value.trim(), passcode: form.elements.passcode.value, areas: {}};
    for (const area of areas) body.areas[area] = {sub: Number(form.elements[`${area}|sub`].value), general: Number(form.elements[`${area}|general`].value)};
    const total = areas.reduce((n, a) => n + body.areas[a].sub + body.areas[a].general, 0);
    if (!confirm(`${monthLabel(body.month)}の管理戸数を合計${fmt(total)}戸で登録します。よろしいですか？`)) return;
    msg.textContent = '登録しています…';
    try {
      await window.Api.setManagement(body);
      window.Api.prefs.set({adminPasscode: body.passcode});
      msg.textContent = '登録しました。画面を更新します。';
      setTimeout(() => location.reload(), 800);
    } catch (err) { msg.textContent = `登録できませんでした：${err.message}`; }
  });
})();
