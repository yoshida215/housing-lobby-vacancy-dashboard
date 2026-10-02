(() => {
  'use strict';
  // 画面上部に「送信待ち」の件数を出し、手動で再送もできる
  const bar = document.getElementById('outbox-bar');
  if (!bar || !window.Outbox) return;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  window.Outbox.onChange(items => {
    bar.hidden = !items.length;
    if (!items.length) return;
    const stopped = items.filter(i => i.stopped);
    bar.innerHTML = `<div class="outbox-inner"><strong>送信待ちの巡回登録 ${items.length}件</strong><span>${stopped.length ? `うち${stopped.length}件は送信できません（${esc(stopped[0].lastError || '')}）。内容を確認してください。` : 'つながると自動で送信します。'}</span><button type="button" class="secondary-button" id="outbox-retry">今すぐ再送</button>${stopped.length ? '<button type="button" class="secondary-button" id="outbox-clear">送れない分を削除</button>' : ''}</div><ul>${items.map(i => `<li>${esc(i.label || '')} ${esc(i.body?.date || '')}${i.lastError ? `（${esc(i.lastError)}）` : ''}</li>`).join('')}</ul>`;
    document.getElementById('outbox-retry').onclick = async () => { for (const i of items) if (i.stopped) await window.Outbox.add({...i.body}, i.label); window.Outbox.flush(); };
    const clear = document.getElementById('outbox-clear');
    if (clear) clear.onclick = async () => { if (!confirm('送信できない巡回登録を端末から削除します。よろしいですか？')) return; for (const i of stopped) await window.Outbox.remove(i.clientId); };
  });
})();
