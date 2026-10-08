(async () => {
  'use strict';
  const api = window.Api;
  const el = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const id = new URLSearchParams(location.search).get('id');
  el('back').href = id ? `room.html?id=${encodeURIComponent(id)}` : 'index.html';
  const pct = (n, d) => d ? `${(n / d * 100).toFixed(1)}%` : '―';
  const rows = (obj, total) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
    `<tr><td>${esc(k)}</td><td>${v}件</td><td>${pct(v, total)}</td><td><span class="bar" style="width:${Math.round(v / (total || 1) * 160)}px"></span></td></tr>`).join('');
  const rentText = v => { const n = parseFloat(String(v || '').replace(/[^0-9.]/g, '')); if (!(n > 0)) return ''; return `${(Math.round((n > 1000 ? n / 10000 : n) * 100) / 100).toFixed(2).replace(/\.?0+$/, '')}万円`; };
  const man = v => v == null ? '―' : `${(Math.round(v * 100) / 100).toFixed(2)}万円`;
  const marketHtml = d => {
    const m = d.market;
    if (!m) return '';
    if (m.error) return `<h2>近隣相場（${esc(m.town)}周辺の成約事例）</h2><p class="sub">${esc(m.error)}</p>`;
    if (!m.count) return '';
    const rentNum = parseFloat(String(d.rent || '').replace(/[^0-9.]/g, ''));
    const own = rentNum > 0 ? (rentNum > 1000 ? rentNum / 10000 : rentNum) : null;
    const sl = m.sameLayout;
    const cmp = own ? `<li>この部屋の賃料${man(own)}は、周辺の成約中央値（${man(m.median)}）より${own >= m.median ? '高め' : '低め'}です（差${man(Math.abs(own - m.median))}）。間取り・築年数が異なるため、下の間取り別も参照してください。</li>` : '';
    return `<h2>近隣相場（${esc(m.town)}周辺の成約事例）</h2>
      <ul><li>周辺の成約事例${m.count}件、賃料の中央値${man(m.median)}。</li>${sl ? `<li>同じ間取り（${esc(sl.layout)}）は${sl.count}件、中央値${man(sl.median)}（${man(sl.min)}〜${man(sl.max)}）。</li>` : ''}${cmp}</ul>
      <table><thead><tr><th>間取り</th><th>件数</th><th>中央値</th><th>最低〜最高</th></tr></thead><tbody>${m.byLayout.map(x => `<tr><td>${esc(x.layout)}</td><td>${x.count}件</td><td>${man(x.median)}</td><td>${man(x.min)}〜${man(x.max)}</td></tr>`).join('')}</tbody></table>
      <p class="sub" style="margin-top:12px">直近の成約例</p>
      <table><thead><tr><th>物件</th><th>間取り</th><th>賃料</th><th>築年月</th><th>成約日</th></tr></thead><tbody>${m.recent.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.layout)}</td><td>${man(x.rent)}</td><td>${esc(x.built)}</td><td>${esc(x.date)}</td></tr>`).join('')}</tbody></table>`;
  };
  const render = d => {
    const fmt = s => s ? s.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1年$2月$3日') : '―';
    const soft = d.total === 0
      ? ['この期間、この物件への反響の記録はありません。募集条件・掲載内容・写真の見直しを優先して検討します。']
      : [
        `反響${d.total}件（${d.people}人）のうち、内見に進んだのは${d.viewed}件（内見率${pct(d.viewed, d.total)}）、申込は${d.applied}件です。`,
        d.viewed ? `内見した${d.viewed}件のうち申込は${d.applied}件（内見からの成約率${pct(d.applied, d.viewed)}）。` : '内見に進んだ反響がありません。反響後の追客と内見誘導を強化します。',
        (d.byResult['問い合わせのみ'] || 0) ? `問い合わせ段階で止まっている反響が${d.byResult['問い合わせのみ']}件あります。追客の状況を確認します。` : '問い合わせ段階で止まっている反響はありません。',
        d.brokerVisits ? `仲介業者の同行内見が${d.brokerVisits}件ありました。` : '仲介業者の同行内見の記録はありません（報告漏れがないかも確認します）。'];
    el('report').innerHTML = `
      <h1>${esc(d.property)} ${esc(d.room)}　反響レポート</h1>
      <p class="sub">${esc(d.area || '')}／${esc(d.management || '')}${d.layout ? '／' + esc(d.layout) : ''}${rentText(d.rent) ? '／' + rentText(d.rent) : ''}　集計期間：${fmt(d.from)}〜${fmt(d.to)}（直近${d.months}か月）　作成日：${fmt(d.to)}</p>
      <div class="kpi-row">
        <div class="kpi-box"><span>物件への反響</span><strong>${d.total}件</strong></div>
        <div class="kpi-box"><span>内見率</span><strong>${pct(d.viewed, d.total)}</strong></div>
        <div class="kpi-box"><span>成約率</span><strong>${pct(d.applied, d.total)}</strong></div>
        <div class="kpi-box"><span>空室期間</span><strong>${d.vacantDays == null ? '―' : d.vacantDays + '日'}</strong></div>
      </div>
      <p class="sub">反響＝種別「反響」＋「かってに内見」。同一人物は${d.people}人（件数は物件ごとの人×物件単位）。うちこの号室への反響：${d.thisRoom}件。解約日：${fmt(d.moveOut)}</p>
      <h2>反響経由の内訳</h2>
      <table><thead><tr><th>経由</th><th>件数</th><th>構成比</th><th></th></tr></thead><tbody>${rows(d.bySource, d.total) || '<tr><td colspan="4">記録なし</td></tr>'}</tbody></table>
      <h2>内見結果の内訳</h2>
      <table><thead><tr><th>結果</th><th>件数</th><th>構成比</th><th></th></tr></thead><tbody>${rows(d.byResult, d.total) || '<tr><td colspan="4">記録なし</td></tr>'}</tbody></table>
      <h2>月別の反響数</h2>
      <table><thead><tr><th>月</th><th>件数</th><th>構成比</th><th></th></tr></thead><tbody>${rows(d.byMonth, d.total) || '<tr><td colspan="4">記録なし</td></tr>'}</tbody></table>
      ${marketHtml(d)}
      ${d.similar && d.similar.length ? `<h2>類似する成約事例（賃料・間取りが近いもの）</h2><ul>${d.similar.map(x => `<li>${esc(x.replace(/^-/, '（物件名なし）'))}</li>`).join('')}</ul>` : ''}
      <h2>状況と今後の対応</h2>
      <ul>${soft.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      <p class="sub" style="margin-top:22px">※個人名は掲載していません。集計はAsana「セルフ内見予約表」の登録分です（アットホームは登録分のみ）。</p>`;
    el('report').hidden = false; el('print').hidden = false; el('msg').hidden = true;
  };
  const run = async passcode => {
    el('msg').hidden = false; el('msg').textContent = 'レポートを作成しています…（Asanaの反響を集計するため、30秒ほどかかることがあります）';
    try {
      let address = '';
      try {
        const snap = await api.snapshot();
        const room = snap.vacancies.find(r => r.id === id);
        if (room) {
          const key = String(room.p || '').normalize('NFKC').replace(/[\s・･.．\-‐‑–—－_（）()]+/g, '').toLowerCase();
          address = window.HOUSING_ADDRESSES?.properties[`${key}|${room.a || ''}`]?.address || '';
        }
      } catch {}
      const d = await api.reportData({task: id, months: Number(el('months').value), passcode, address});
      api.prefs.set({passcode}); el('pass-form').hidden = true; render(d);
    } catch (e) {
      el('report').hidden = true; el('print').hidden = true;
      el('msg').textContent = e.message || '作成できませんでした';
      if (/合言葉/.test(e.message || '')) el('pass-form').hidden = false;
    }
  };
  if (!api.configured || !id) { el('msg').textContent = '共有データに接続していないため、レポートを作成できません。'; return; }
  el('pass-form').addEventListener('submit', e => { e.preventDefault(); run(el('pass').value); });
  el('months').addEventListener('change', () => run(api.prefs.get().passcode || ''));
  el('print').addEventListener('click', () => window.print());
  run(api.prefs.get().passcode || '');
})();
