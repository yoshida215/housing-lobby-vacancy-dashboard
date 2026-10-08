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
      <p class="sub">${esc(d.area || '')}／${esc(d.management || '')}　集計期間：${fmt(d.from)}〜${fmt(d.to)}（直近${d.months}か月）　作成日：${fmt(d.to)}</p>
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
      <h2>状況と今後の対応</h2>
      <ul>${soft.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      <p class="sub" style="margin-top:22px">※個人名は掲載していません。集計はAsana「セルフ内見予約表」の登録分です（アットホームは登録分のみ）。</p>`;
    el('report').hidden = false; el('print').hidden = false; el('msg').hidden = true;
  };
  const run = async passcode => {
    el('msg').hidden = false; el('msg').textContent = 'レポートを作成しています…（Asanaの反響を集計するため、30秒ほどかかることがあります）';
    try {
      const d = await api.reportData({task: id, months: Number(el('months').value), passcode});
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
