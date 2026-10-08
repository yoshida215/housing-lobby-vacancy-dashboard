(() => {
  'use strict';
  // 社内アカウント（Microsoft Entra ID）でのログイン。MSAL.js を使う。
  // 画面は公開のままだが、GASがトークンのない相手を断るため、データは社員にしか見えない。
  // クライアントID・テナントIDは秘密情報ではない（SPAでは画面に書く前提）。クライアントシークレットは使わない。
  const cfg = (window.APP_CONFIG || {}).auth;
  if (!cfg || !window.msal) { window.Auth = null; return; }
  const base = new URL('./', location.href).href.replace(/(housing-lobby-vacancy-dashboard\/).*$/, '$1');
  const client = new window.msal.PublicClientApplication({
    auth: {
      clientId: cfg.clientId,
      authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
      redirectUri: base,                 // 登録済みのリダイレクトURI（トップページ）。ログイン後は元のページへ戻る
      navigateToLoginRequestUrl: true
    },
    cache: {cacheLocation: 'sessionStorage'}
  });
  const request = {scopes: ['User.Read']};
  const fail = (message, retryable) => { const e = new Error(message); e.retryable = retryable; return e; };
  let account = null;

  // 画面を出す前に、必ずログインを通す（未ログインならMicrosoftのログイン画面へ）
  const ready = (async () => {
    await client.initialize();
    const result = await client.handleRedirectPromise().catch(err => { console.warn(err); return null; });
    account = result?.account || client.getActiveAccount() || client.getAllAccounts()[0] || null;
    if (!account) {
      document.body.classList.add('auth-wait');
      await client.loginRedirect({...request, redirectStartPage: location.href});
      return new Promise(() => {}); // ログイン画面へ移動するので、以降の描画はしない
    }
    client.setActiveAccount(account);
    showUser();
    return account;
  })();

  // GASを呼ぶたびに新しいトークンを取る。interactive=false（送信待ちの自動再送など）では画面遷移しない
  const token = async ({interactive = true} = {}) => {
    await ready;
    try {
      return (await client.acquireTokenSilent({...request, account})).accessToken;
    } catch (err) {
      const code = String(err?.errorCode || err?.message || '');
      if (/network|post_request_failed|no_network|timed_out/i.test(code)) throw fail('通信できません（電波・ネット接続を確認してください）', true);
      if (interactive) { await client.acquireTokenRedirect({...request, account, redirectStartPage: location.href}); return new Promise(() => {}); }
      throw fail('ログインの有効期限が切れました。画面を開き直してください', true);
    }
  };

  const login = () => client.loginRedirect({...request, redirectStartPage: location.href});
  const signOut = () => client.logoutRedirect({account, postLogoutRedirectUri: base});

  function showUser() {
    const host = document.querySelector('.masthead-inner');
    if (!host || document.getElementById('auth-user')) return;
    host.insertAdjacentHTML('beforeend', '<div class="auth-user" id="auth-user"><span></span><a href="#" id="auth-signout">ログアウト</a></div>');
    document.querySelector('#auth-user span').textContent = account.name || account.username;
    document.getElementById('auth-signout').addEventListener('click', e => { e.preventDefault(); signOut(); });
  }

  window.Auth = {ready, token, login, signOut, get account() { return account; }};
})();
