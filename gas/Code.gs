/**
 * 空室業務ダッシュボード API（Google Apps Script）
 *
 * - 画面（GitHub Pages）からの読み取り・巡回登録を受け、Asanaへ中継する。
 * - Asanaトークンはスクリプトプロパティ ASANA_TOKEN にのみ保存する。画面側には渡さない。
 * - 巡回記録は物件タスク直下のサブタスク「巡回確認（日付）」に蓄積する（運用ルール.md 参照）。
 *
 * スクリプトプロパティ：
 *   ASANA_TOKEN     Asana個人アクセストークン（必須）
 *   EDIT_PASSCODE   巡回登録用の合言葉（空欄なら合言葉なしで登録できる）
 *   ADMIN_PASSCODE  管理戸数登録用の合言葉（必須）
 *   HISTORY_SHEET_ID 日次入居率を記録するスプレッドシートID（任意）
 *   ASSIGNEE_NAGASAKI 長崎北・長崎中央・セキスイ・古里のサブタスク担当者（Asanaのメールアドレス）
 *   ASSIGNEE_KENOU    諫早・大村のサブタスク担当者（Asanaのメールアドレス）
 *   ALERT_EMAIL       障害通知の送り先（任意）
 *   MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET  管理戸数の自動取得用（Microsoft Entraのアプリ登録。任意）
 */

const CFG = {
  workspace: '1200966151623344',
  project: '1201255767385595',          // 【空室一覧】
  section: '1201255767385596',          // 【募集中】
  restorationProject: '1206192676880472', // 14日ルール　原状回復工事業務
  restorationSince: '2026-09-13T15:00:00Z', // 2026-09-14 00:00 JST
  fields: {
    p: '1200985392689758', // 物件名
    r: '1200985444170345', // 号室
    s: '1201172475020557', // ステータス①
    c: '1204492192227099', // 空室状況
    a: '1201159351214435', // 地区
    m: '1201172482791543', // 管理種別
    w: '1206967651739664'  // 評価入居率対象
  },
  areas: ['長崎中央', '長崎北', '諫早', '大村'],
  moveOutField: '1201222607611150', // 解約日（テキスト）。空室日数の起点
  applicationFields: {
    date: '1204061090287264', broker: '1214016908312487', contract: '1214044050776097',
    route: '1214044050776101', selfViewing: '1214044050776108'
  },
  selfViewing: {
    project: '1201888167643147', // セルフ内見予約表（反響）
    type: '1214044050776245', source: '1203496884706218', result: '1202105588703093', store: '1203505276357321'
  },
  meetingDocs: {
    driveId: 'b!hr3BLeHR3kGhFBj-PRWaEAsQrCRVof5CtE5S4_fM07x9HrQe6ngeSYxlhRj_B_nL', // Teams 全社チーム
    folder: '18全体月次会議／全員グループ　会議資料　全体会議　月1回'
  },
  marker: '【巡回記録】',
  intervalDays: 45,
  // 現地確認の項目（docs/patrol-items.js と同じ内容に保つ）。Asanaの項目（プロパティ）とは連動しない
  // ok＝チェックあり、ng＝チェックなし（task があれば「巡回確認」の中に対応タスクを作る）、na＝該当なし
  patrolFields: [
    {key: 'nobori', name: 'のぼり', ok: 'あり', ng: 'なし', task: 'のぼりを設置'},
    {key: 'recruitmentSign', name: '募集看板', ok: 'あり', ng: 'なし', task: '募集看板を設置'},
    {key: 'managementSign', name: '管理看板', ok: 'あり', ng: 'なし', task: '管理看板を設置'},
    {key: 'welcomeSet', name: 'ウェルカムセット', ok: 'あり', ng: 'なし', task: 'ウェルカムセットを設置'},
    {key: 'staging', name: 'ステージング', ok: 'あり', ng: 'なし', task: null},
    {key: 'roomCleaning', name: '室内清掃', ok: '済', ng: '要清掃', task: '室内清掃'},
    {key: 'commonCleaning', name: '共用部清掃', ok: '済', ng: '要清掃', task: '共用部清掃'},
    {key: 'postSeal', name: 'ポストシール', ok: 'あり', ng: 'なし', task: 'ポストシールを貼付'},
    {key: 'colorCone', name: 'カラーコーン', ok: 'あり', ng: 'なし', task: 'カラーコーンを設置'},
    {key: 'airFreshener', name: '芳香剤補充', ok: '済', ng: '要補充', task: '芳香剤を補充'},
    {key: 'tatamiMold', name: '畳カビ確認', ok: '問題なし', ng: 'カビあり', na: '該当なし', task: '畳カビ対応'},
    {key: 'keyBattery', name: '電子キー電池確認', ok: '問題なし', ng: '要交換', na: '該当なし', task: '電子キー電池交換'}
  ],
  keyTypeField: '1200977170310201', // 既存の「鍵種別」（選択肢の読み取り・初期表示のみ。書き込まない）
  maxPhotos: 15,
  dueDays: 7, // サブタスクの期日＝作成日の1週間後
  patrolTaskName: date => '巡回確認（' + date + '）',   // 物件タスク直下のサブタスク（巡回記録の本体）
  otherTaskName: 'その他不備',                         // 写真があるとき巡回確認の中に作り、写真を添付する
  cacheSeconds: 600
};

/* ---------- エントリポイント ---------- */

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    switch (p.action) {
      case 'snapshot': return json_(getSnapshot_(p.refresh === '1'));
      case 'patrols': return json_(getPatrols_(p.task));
      case 'lpStatus': return json_(lpStatus_(p.task));
      case 'lpQueue': return json_(lpQueue_(p.key));
      case 'ping': {
        const pr = PropertiesService.getScriptProperties();
        return json_({ok: true, at: new Date().toISOString(), passcodeRequired: Boolean(pr.getProperty('EDIT_PASSCODE')),
          lastOk: pr.getProperty('STATUS_LAST_OK'), lastError: pr.getProperty('STATUS_LAST_ERROR'), autoRefresh: ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'refreshJob')});
      }
      case 'promotion': return json_(getPromotion_(p.month, p.refresh === '1'));
      default: return json_({error: '不明な操作です'});
    }
  } catch (err) {
    return json_({error: String(err.message || err)});
  }
}

// 画面からは Content-Type: text/plain で JSON を送る（CORSプリフライト回避）
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (_) { return json_({error: '送信内容を読み取れません'}); }
  try {
    switch (body.action) {
      case 'previewPatrol': return json_(previewPatrol_(body));
      case 'savePatrol': return json_(savePatrol_(body));
      case 'setManagement': return json_(setManagement_(body));
      case 'lpRequest': return json_(lpRequest_(body));
      case 'lpUpdate': return json_(lpUpdate_(body));
      case 'reportData': return json_(reportData_(body));
      case 'checkPasscode': return json_({ok: passOk_('EDIT_PASSCODE', body.passcode)});
      default: return json_({error: '不明な操作です'});
    }
  } catch (err) {
    // retryable＝通信・Asana側の一時的な問題。画面はこの場合だけ「送信待ち」に保存して自動再送する
    const retryable = Boolean(err.retryable) || /Lock|timeout|タイムアウト|Service invoked too many times|Address unavailable/i.test(String(err.message || err));
    return json_({error: String(err.message || err), retryable: retryable});
  }
}

/* ---------- スナップショット（空室・原状回復・管理戸数・巡回索引） ---------- */

function getSnapshot_(refresh) {
  const cache = CacheService.getScriptCache();
  if (!refresh) {
    const hit = cacheGet_(cache, 'snapshot');
    if (hit) {
      const data = JSON.parse(hit);
      data.patrolIndex = readPatrolIndex_(); // 巡回は常に最新を返す
      return data;
    }
  }
  let data;
  try {
    data = refreshSnapshot_();
  } catch (err) {
    // Asanaに接続できないときは、最後に正常に取得したデータを返す（画面に取得時刻と注意を出す）
    const last = persistGet_('S');
    if (!last) throw err;
    data = JSON.parse(last);
    data.stale = true;
    data.staleReason = String(err.message || err);
    cachePut_(cache, 'snapshot', JSON.stringify(data), 120);
  }
  data.patrolIndex = readPatrolIndex_();
  return data;
}

// Asanaから取り直し、異常がなければ「最後に正常に取得したデータ」として保存する
function refreshSnapshot_() {
  const data = buildSnapshot_();
  const last = persistGet_('S');
  if (last) {
    const prev = JSON.parse(last);
    const n = data.vacancies.length, m = (prev.vacancies || []).length;
    if (m >= 20 && n < m * 0.5) {
      const e = new Error('空室件数が前回の' + m + '件から' + n + '件に急減したため、取得結果を保留しました（Asanaの不調またはセクション変更の可能性）');
      e.retryable = true;
      throw e;
    }
  }
  const named = data.vacancies.filter(v => v.p).length;
  if (data.vacancies.length && named === 0) {
    const e = new Error('物件名が1件も読めません。Asanaの項目「物件名」が変更された可能性があります');
    e.retryable = true;
    throw e;
  }
  persistPut_('S', JSON.stringify(data));
  CacheService.getScriptCache().remove('snapshot_n');
  cachePut_(CacheService.getScriptCache(), 'snapshot', JSON.stringify(data), CFG.cacheSeconds);
  setStatus_('ok', 'snapshot');
  return data;
}

function buildSnapshot_() {
  const optFields = 'name,completed,parent,custom_fields.gid,custom_fields.display_value';
  const rows = asanaList_('/sections/' + CFG.section + '/tasks', {opt_fields: optFields, limit: 100});
  const seen = {};
  const vacancies = [];
  rows.forEach(t => {
    if (t.completed || t.parent || seen[t.gid]) return;
    seen[t.gid] = true;
    const row = {id: t.gid};
    const byId = {};
    (t.custom_fields || []).forEach(f => { byId[f.gid] = f.display_value; });
    Object.keys(CFG.fields).forEach(k => { row[k] = byId[CFG.fields[k]] || null; });
    row.k = byId[CFG.keyTypeField] || null;
    row.v = parseJpDate_(byId[CFG.moveOutField]); // 解約日（YYYY-MM-DD）
    vacancies.push(row);
  });

  const since = CFG.restorationSince;
  const done = asanaList_('/tasks', {
    project: CFG.restorationProject,
    completed_since: since,
    opt_fields: 'name,completed,completed_at,custom_fields.gid,custom_fields.display_value',
    limit: 100
  });
  const restorations = done
    .filter(t => t.completed && t.completed_at && t.completed_at >= since)
    .map(t => {
      const byId = {};
      (t.custom_fields || []).forEach(f => { byId[f.gid] = f.display_value; });
      return {id: t.gid, p: byId[CFG.fields.p] || t.name || null, r: byId[CFG.fields.r] || null, at: t.completed_at};
    })
    .sort((a, b) => b.at.localeCompare(a.at));

  return {
    asOf: new Date().toISOString(),
    live: true,
    vacancies: vacancies,
    restorations: restorations,
    rates: computeRates_(vacancies), // 管理戸数そのものは返さない（非公開）。率のみ返す
    keyOptions: keyTypeOptions_().map(o => o.name)
  };
}

/* ---------- 管理戸数（月ごと・非公開） ---------- */

function countVacancies_(vacancies) {
  const counts = {};
  CFG.areas.forEach(a => ['sub', 'general'].forEach(g => { counts[a + '|' + g] = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}; }));
  vacancies.forEach(v => {
    const g = v.m === 'サブ' ? 'sub' : (v.m === '一般管理' || v.m === 'セキスイ物件') ? 'general' : null;
    if (!g || CFG.areas.indexOf(v.a) < 0) return;
    const c = counts[v.a + '|' + g];
    if (v.s === '空室中' && (v.c === '原状回復完了' || v.c === 'ステージング完了')) c[1]++;
    else if (v.s === '空室中' && v.c === '工事掃除中') c[2]++;
    else if (v.s === '入居中（退去予定）') c[3]++;
    else if (v.s === '募集止め') c[4]++;
    if (v.w === '14日免除') c[5]++;
  });
  return counts;
}

// 入居率＝1−(①＋②)÷管理戸数、評価入居率＝1−(①−⑤)÷管理戸数
function rate_(c, den) {
  return den ? {occ: 1 - (c[1] + c[2]) / den, ev: 1 - (c[1] - c[5]) / den} : null;
}

function computeRates_(vacancies) {
  const counts = countVacancies_(vacancies);
  const months = readManagement_();
  const out = {};
  Object.keys(months).forEach(month => {
    const m = months[month];
    const groups = {}, areas = {};
    const all = {1: 0, 2: 0, 5: 0}; let allDen = 0;
    CFG.areas.forEach(a => {
      const ac = {1: 0, 2: 0, 5: 0}; let aDen = 0;
      ['sub', 'general'].forEach(g => {
        const c = counts[a + '|' + g], den = m.areas[a][g];
        groups[a + '|' + g] = rate_(c, den);
        [1, 2, 5].forEach(k => { ac[k] += c[k]; all[k] += c[k]; });
        aDen += den; allDen += den;
      });
      areas[a] = rate_(ac, aDen);
    });
    out[month] = {source: m.source, savedAt: m.savedAt, groups: groups, areas: areas, total: rate_(all, allDen)};
  });
  return out;
}

function readManagement_() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const months = {};
  Object.keys(props).forEach(k => {
    if (/^M_\d{4}-\d{2}$/.test(k)) {
      try { months[k.slice(2)] = JSON.parse(props[k]); } catch (_) {}
    }
  });
  return months; // {"2026-10": {areas:{長崎中央:{sub,general},...}, source, savedAt}}
}

function setManagement_(body) {
  if (!passOk_('ADMIN_PASSCODE', body.passcode)) throw new Error('管理用の合言葉が違います');
  if (!/^\d{4}-\d{2}$/.test(body.month || '')) throw new Error('対象月が正しくありません');
  const areas = {};
  CFG.areas.forEach(a => {
    const v = (body.areas || {})[a] || {};
    const sub = Number(v.sub), general = Number(v.general);
    if (!isFinite(sub) || !isFinite(general) || sub < 0 || general < 0 || sub % 1 || general % 1) {
      throw new Error(a + 'の管理戸数が正しくありません');
    }
    areas[a] = {sub: sub, general: general};
  });
  const value = {areas: areas, source: String(body.source || '').slice(0, 120), savedAt: new Date().toISOString()};
  PropertiesService.getScriptProperties().setProperty('M_' + body.month, JSON.stringify(value));
  CacheService.getScriptCache().remove('snapshot_n');
  return {ok: true, month: body.month};
}

/* ---------- 巡回記録 ---------- */

function getPatrols_(task) {
  if (!/^\d+$/.test(task || '')) throw new Error('部屋IDが正しくありません');
  // 正本：物件タスク直下の「巡回確認（日付）」サブタスクの説明欄。旧形式のコメントも読む
  const subs = asanaList_('/tasks/' + task + '/subtasks', {opt_fields: 'name,notes,created_at,created_by.name', limit: 100})
    .filter(t => /^巡回確認（/.test(t.name || '') && String(t.notes || '').indexOf(CFG.marker) === 0)
    .map(t => ({text: t.notes, created_at: t.created_at, created_by: t.created_by}));
  const stories = asanaList_('/tasks/' + task + '/stories', {opt_fields: 'text,type,created_at,created_by.name', limit: 100})
    .filter(st => st.type === 'comment' && String(st.text || '').indexOf(CFG.marker) === 0);
  const seen = {};
  const records = subs.concat(stories)
    .map(st => parsePatrol_(st))
    .filter(rec => rec && !(rec.clientId && seen[rec.clientId]) && (seen[rec.clientId] = true))
    .sort((a, b) => b.date.localeCompare(a.date) || b.savedAt.localeCompare(a.savedAt));
  if (records.length) updatePatrolIndex_(task, records[0].date);
  return {task: task, records: records};
}

function parsePatrol_(story) {
  const lines = String(story.text).split('\n');
  const head = lines[0].match(/(\d{4}-\d{2}-\d{2})/);
  if (!head) return null;
  const get = label => {
    const line = lines.find(l => l.indexOf(label + '：') === 0);
    return line == null ? null : line.slice(label.length + 1).trim();
  };
  const checks = {};
  CFG.patrolFields.forEach(x => { checks[x.key] = valueFromLabel_(x, get(x.name)); });
  const photoMatch = String(story.text).match(/^写真：(\d+)枚/m);
  const idMatch = String(story.text).match(/ID:([A-Za-z0-9-]+)/);
  const noteIndex = lines.findIndex(l => l.indexOf('メモ：') === 0);
  let note = '';
  if (noteIndex >= 0) {
    const rest = [lines[noteIndex].slice(3)].concat(lines.slice(noteIndex + 1));
    note = rest.filter(l => !/^（空室業務ダッシュボードから登録/.test(l)).join('\n').trim();
  }
  return {
    date: head[1],
    nextDate: addDays_(head[1], CFG.intervalDays),
    checks: checks,
    inspector: get('担当') || '',
    keyType: get('鍵種別') || '',
    otherIssue: get('その他不備') || '',
    photoCount: photoMatch ? Number(photoMatch[1]) : 0,
    note: note,
    savedAt: story.created_at,
    postedBy: story.created_by ? story.created_by.name : '',
    clientId: idMatch ? idMatch[1] : null,
    source: 'Asana'
  };
}

function validatePatrol_(body) {
  if (!/^\d+$/.test(body.task || '')) throw new Error('部屋IDが正しくありません');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')) throw new Error('巡回日が正しくありません');
  if (body.date > todayJst_()) throw new Error('巡回日は今日以前の日付にしてください');
  if (!/^[A-Za-z0-9-]{8,48}$/.test(body.clientId || '')) throw new Error('登録IDが正しくありません');
  const inspector = String(body.inspector || '').trim();
  if (!inspector) throw new Error('担当者名を入力してください');
  if (inspector.length > 30) throw new Error('担当者名は30文字以内にしてください');
  const note = String(body.note || '').trim();
  if (note.length > 1000) throw new Error('メモは1000文字以内にしてください');
  const checks = {};
  CFG.patrolFields.forEach(x => {
    const v = (body.checks || {})[x.key];
    checks[x.key] = v === 'na' && x.na ? 'na' : v === true;
  });
  const keyType = String(body.keyType || '');
  if (keyType && !keyTypeOptions_().some(o => o.name === keyType)) throw new Error('鍵種別が正しくありません');
  const photoCount = Math.max(0, Math.min(CFG.maxPhotos, Number(body.photoCount) || 0));
  const otherIssue = String(body.otherIssue || '').trim();
  if (otherIssue.length > 1000) throw new Error('その他不備のコメントは1000文字以内にしてください');
  return {task: body.task, date: body.date, clientId: body.clientId, inspector: inspector, note: note, checks: checks, keyType: keyType, photoCount: photoCount, otherIssue: otherIssue};
}

// true/false/'na' ⇔ 選択肢の名前
function labelOf_(x, v) { return v === 'na' ? x.na : v ? x.ok : x.ng; }
function valueFromLabel_(x, label) {
  if (label === x.ok) return true;
  if (label === x.ng) return false;
  if (x.na && label === x.na) return 'na';
  return null;
}

function keyTypeOptions_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('keyOptions');
  if (hit) return JSON.parse(hit);
  const opts = (asanaGet_('/custom_fields/' + CFG.keyTypeField, {opt_fields: 'enum_options.name,enum_options.gid,enum_options.enabled'}).enum_options || [])
    .filter(o => o.enabled).map(o => ({name: o.name, gid: o.gid}));
  cache.put('keyOptions', JSON.stringify(opts), 3600);
  return opts;
}

function patrolText_(r) {
  const lines = [CFG.marker + r.date, '次回巡回予定：' + addDays_(r.date, CFG.intervalDays) + '（' + CFG.intervalDays + '日後）'];
  CFG.patrolFields.forEach(x => lines.push(x.name + '：' + labelOf_(x, r.checks[x.key])));
  if (r.keyType) lines.push('鍵種別：' + r.keyType);
  if (r.otherIssue) lines.push('その他不備：' + r.otherIssue.replace(/\n/g, ' '));
  if (r.photoCount) lines.push('写真：' + r.photoCount + '枚');
  lines.push('担当：' + r.inspector);
  if (r.note) lines.push('メモ：' + r.note);
  lines.push('（空室業務ダッシュボードから登録・ID:' + r.clientId + '）');
  return lines.join('\n');
}

// 送信前の確認用（dry-run）。Asanaには書き込まない。
function previewPatrol_(body) {
  if (!passOk_('EDIT_PASSCODE', body.passcode)) throw new Error('巡回登録用の合言葉が違います');
  const r = validatePatrol_(body);
  const task = asanaGet_('/tasks/' + r.task, {opt_fields: 'name,memberships.project.gid,custom_fields.gid,custom_fields.display_value'});
  assertInProject_(task);
  const plan = planFollowUps_(r, task);
  const who = assignmentFor_(task);
  if (plan.parent || plan.create.length) plan.lines.push('作成するサブタスクの担当：' + (who.assignee || '未設定（' + who.reason + '）') + '／期日：' + who.due);
  return {ok: true, room: roomLabel_(task), text: patrolText_(r), actions: plan.lines};
}

/* 巡回結果に応じたAsana更新の計画（dry-run と本実行で共通）
   物件タスク └ 巡回確認（日付） └ 対応タスク（○○を設置 など）  の2段構成 */
function planFollowUps_(r, task) {
  const plan = {parent: null, existingParent: null, create: [], complete: [], parentsToCheck: {}, openByKey: {}, mineChildren: {}, lines: []};
  const subs = asanaList_('/tasks/' + r.task + '/subtasks', {opt_fields: 'name,notes,completed', limit: 100});
  const mine = subs.find(t => String(t.notes || '').indexOf('ID:' + r.clientId) >= 0);
  if (mine) {
    // 同じ登録の再送（途中で失敗した場合など）。足りない対応タスクだけ作り足す
    plan.existingParent = mine.gid;
    asanaList_('/tasks/' + mine.gid + '/subtasks', {opt_fields: 'name,completed', limit: 100}).forEach(t => { plan.mineChildren[t.name] = t.gid; });
  } else {
    plan.parent = CFG.patrolTaskName(r.date);
    plan.lines.push('サブタスク「' + plan.parent + '」を作成（巡回記録）');
  }

  // 未完了の対応タスク（今回以外の巡回確認の中、および旧形式の直下サブタスク）
  const openTasks = {};
  subs.filter(t => /^巡回確認（/.test(t.name || '') && (!mine || t.gid !== mine.gid)).forEach(p => {
    asanaList_('/tasks/' + p.gid + '/subtasks', {opt_fields: 'name,completed', limit: 100})
      .filter(t => !t.completed).forEach(t => { (openTasks[t.name] = openTasks[t.name] || []).push({gid: t.gid, parent: p.gid, from: p.name}); });
  });
  subs.filter(t => !t.completed && /^【巡回】/.test(t.name || '')).forEach(t => {
    const name = t.name.replace(/^【巡回】/, '');
    (openTasks[name] = openTasks[name] || []).push({gid: t.gid, parent: null, from: '旧形式'});
  });

  // ルール：物件タスクの項目（プロパティ）には一切書き込まない。結果は巡回確認の説明欄とサブタスクだけに残す
  CFG.patrolFields.forEach(x => {
    const v = r.checks[x.key];
    if (!x.task) return;
    const open = openTasks[x.task] || [];
    if (v === false) {
      if (plan.mineChildren[x.task]) plan.openByKey[x.key] = plan.mineChildren[x.task];
      else if (open.length) { plan.openByKey[x.key] = open[0].gid; plan.lines.push('「' + x.task + '」は未完了のタスクがあるため作成しない（' + open[0].from + '）'); }
      else { plan.create.push({key: x.key, name: x.task}); plan.lines.push('　└ 「' + x.task + '」を作成'); }
    } else if (open.length) {
      open.forEach(t => { plan.complete.push(t.gid); if (t.parent) plan.parentsToCheck[t.parent] = true; });
      plan.lines.push('「' + x.task + '」を完了（' + open[0].from + '）');
    }
  });
  if (r.photoCount || r.otherIssue) {
    if (plan.mineChildren[CFG.otherTaskName]) plan.openByKey.other = plan.mineChildren[CFG.otherTaskName];
    else {
      plan.create.push({key: 'other', name: CFG.otherTaskName});
      plan.lines.push('　└ 「' + CFG.otherTaskName + '」を作成（' + [r.otherIssue ? 'コメントあり' : '', r.photoCount ? '写真' + r.photoCount + '枚を添付' : ''].filter(Boolean).join('・') + '）');
    }
  }
  return plan;
}

// 実行し、写真の添付先（項目キー→タスクGID、null→巡回確認）を返す
/* サブタスクの担当者と期日。地区・管理種別で振り分け、メールアドレスはスクリプトプロパティから読む */
function assignmentFor_(task) {
  const byId = {};
  (task.custom_fields || []).forEach(f => { byId[f.gid] = f.display_value; });
  const area = byId[CFG.fields.a] || '';
  // 地区が諫早・大村なら県央担当（管理種別は問わない）。それ以外（長崎北・長崎中央・古里・空欄など）は長崎担当
  const key = (area === '諫早' || area === '大村') ? 'ASSIGNEE_KENOU' : 'ASSIGNEE_NAGASAKI';
  const email = String(PropertiesService.getScriptProperties().getProperty(key) || '').trim();
  return {
    assignee: email || null,
    reason: key + ' が未設定',
    due: addDays_(todayJst_(), CFG.dueDays)
  };
}

function subtaskData_(name, notes, who) {
  const data = {name: name, notes: notes, due_on: who.due};
  if (who.assignee) data.assignee = who.assignee;
  return {data: data};
}

function applyFollowUps_(r, plan, task) {
  const targets = Object.assign({}, plan.openByKey);
  const who = assignmentFor_(task);
  const parentGid = plan.existingParent || asanaPost_('/tasks/' + r.task + '/subtasks', subtaskData_(plan.parent, patrolText_(r), who)).gid;
  targets[''] = parentGid;
  {
    plan.create.forEach(c => {
      const x = CFG.patrolFields.find(f => f.key === c.key);
      const notes = x
        ? r.date + 'の巡回（担当：' + r.inspector + '）で「' + x.name + '：' + x.ng + '」を確認。\n対応後、次の巡回で「' + x.ok + '」を登録すると自動で完了になります。'
        : (r.otherIssue ? r.otherIssue + '\n\n' : '') + '―――\n' + r.date + 'の巡回（担当：' + r.inspector + '）で確認。' + (r.photoCount ? '写真' + r.photoCount + '枚を添付しています。' : '') + '\n対応後、このタスクを完了にしてください。';
      const t = asanaPost_('/tasks/' + parentGid + '/subtasks', subtaskData_(c.name, notes, who));
      targets[c.key] = t.gid;
      targets['created_' + c.key] = true;
    });
    const hasChildren = plan.create.length || Object.keys(plan.mineChildren).length;
    if (!hasChildren) asanaFetch_('put', '/tasks/' + parentGid, null, {data: {completed: true}}); // 要対応なし＝巡回確認は完了
  }
  plan.complete.forEach(gid => asanaFetch_('put', '/tasks/' + gid, null, {data: {completed: true}}));
  // 中の対応タスクがすべて完了した巡回確認は完了にする
  Object.keys(plan.parentsToCheck).forEach(gid => {
    const rest = asanaList_('/tasks/' + gid + '/subtasks', {opt_fields: 'completed', limit: 100}).filter(t => !t.completed);
    if (!rest.length) asanaFetch_('put', '/tasks/' + gid, null, {data: {completed: true}});
  });
  return targets;
}

function savePatrol_(body) {
  if (!passOk_('EDIT_PASSCODE', body.passcode)) throw new Error('巡回登録用の合言葉が違います');
  const r = validatePatrol_(body);
  const photos = (Array.isArray(body.photos) ? body.photos : []).slice(0, CFG.maxPhotos);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const task = asanaGet_('/tasks/' + r.task, {opt_fields: 'name,memberships.project.gid,custom_fields.gid,custom_fields.display_value'});
    assertInProject_(task);
    // 同じ登録IDの巡回確認サブタスクがあれば作らない（二重送信対策）。項目・対応タスクも差分だけ反映
    const plan = planFollowUps_(r, task);
    const targets = applyFollowUps_(r, plan, task);
    // 写真：既に添付済みの枚数から続きだけ送る（途中で失敗した再送でも重複しない）
    let attached = 0;
    const photoParent = targets.other || targets[''];
    const already = photos.length && !targets.created_other
      ? (asanaList_('/attachments', {parent: photoParent, opt_fields: 'name', limit: 100}).filter(a => /_other_\d+\.jpg$/.test(a.name || '')).length) : 0;
    photos.slice(already).forEach((p, i) => {
      if (!p || typeof p.data !== 'string' || p.data.length > 6000000) return;
      asanaUpload_(photoParent, p.data, r.date + '_other_' + (already + i + 1) + '.jpg'); // 日本語名は添付で文字化けするため英字
      attached++;
    });
    const dup = Boolean(plan.existingParent) && !plan.create.length && !attached;
    updatePatrolIndex_(r.task, r.date);
    CacheService.getScriptCache().remove('snapshot_n');
    return {ok: true, duplicate: dup, room: roomLabel_(task), nextDate: addDays_(r.date, CFG.intervalDays), actions: plan.lines, photos: attached};
  } finally {
    lock.releaseLock();
  }
}

function assertInProject_(task) {
  const inProject = (task.memberships || []).some(m => m.project && m.project.gid === CFG.project);
  if (!inProject) throw new Error('【空室一覧】のタスクではないため登録できません');
}

function roomLabel_(task) {
  const byId = {};
  (task.custom_fields || []).forEach(f => { byId[f.gid] = f.display_value; });
  return [(byId[CFG.fields.p] || task.name || ''), (byId[CFG.fields.r] || '')].join(' ').trim();
}

/* ---------- 現地確認の項目（Asanaカスタムフィールド） ---------- */

// ルール：Asanaに項目（カスタムフィールド）を新規作成しない。項目の追加・値の書き込みを行う関数は置かない。

/* 巡回索引：タスクごとの最新巡回日（一覧表示用）。正本はAsanaコメント。 */
function readPatrolIndex_() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const index = {};
  Object.keys(props).forEach(k => {
    if (k.indexOf('L_') === 0) index[k.slice(2)] = {date: props[k], nextDate: addDays_(props[k], CFG.intervalDays)};
  });
  return index;
}

function updatePatrolIndex_(task, date) {
  const props = PropertiesService.getScriptProperties();
  const cur = props.getProperty('L_' + task);
  if (!cur || cur < date) props.setProperty('L_' + task, date);
}

/** 手動実行用：Asanaコメントから巡回索引を作り直す（募集中の全タスクを走査） */
function rebuildPatrolIndex() {
  const snap = buildSnapshot_();
  let found = 0;
  snap.vacancies.forEach(v => {
    const res = getPatrols_(v.id);
    if (res.records.length) found++;
  });
  Logger.log('巡回記録のある部屋：' + found + '件 / ' + snap.vacancies.length + '件');
}

/* ---------- 日次記録（毎日17:30） ---------- */

/** 手動で1回実行すると、毎日17:30（JST）の記録トリガーを登録する */
function installDailyTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'recordDailyOccupancy').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('recordDailyOccupancy').timeBased().everyDays(1).atHour(17).nearMinute(30).inTimezone('Asia/Tokyo').create();
}

/** 入居率の日次値をスプレッドシートへ1行追記する（HISTORY_SHEET_ID 設定時のみ） */
function recordDailyOccupancy() {
  const snap = getSnapshot_(true);
  const sheetId = PropertiesService.getScriptProperties().getProperty('HISTORY_SHEET_ID');
  if (!sheetId) return;
  const months = readManagement_();
  const latest = Object.keys(months).sort().pop();
  const m = latest ? months[latest] : null;
  const sheet = SpreadsheetApp.openById(sheetId).getSheets()[0];
  if (sheet.getLastRow() === 0) sheet.appendRow(['日付', '地区', '種別', '管理戸数', '管理戸数の月', '①原復済', '②原復未', '③退去予定', '④募集止め', '⑤14日免除', '入居率', '評価入居率']);
  const counts = countVacancies_(snap.vacancies);
  const today = todayJst_();
  CFG.areas.forEach(a => ['sub', 'general'].forEach(g => {
    const c = counts[a + '|' + g];
    const den = m ? m.areas[a][g] : '';
    const r = rate_(c, den);
    sheet.appendRow([today, a, g === 'sub' ? 'サブ' : '一般', den, latest || '', c[1], c[2], c[3], c[4], c[5], r ? r.occ : '', r ? r.ev : '']);
  }));
}

/* ---------- 入居促進（月次の申込・反響） ---------- */
/* 個人名は返さない。件数と内訳だけ。
   申込：【空室一覧】の全タスク（未完了＋対象月以降に完了）のうち「申込日」が対象月のもの（ステータスは問わない・親タスクのみ）
   反響：【セルフ内見予約表】のうち期日（反響受付日／内見日）が対象月のもの。2軸（物件ごと／人物名ごと）で数える */

function getPromotion_(month, refresh) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw new Error('対象月が正しくありません');
  const cache = CacheService.getScriptCache();
  const key = 'promo_' + month;
  if (!refresh) { const hit = cacheGet_(cache, key); if (hit) return JSON.parse(hit); }
  let data;
  try {
    data = buildPromotion_(month);
  } catch (err) {
    const last = persistGet_('P' + month.replace('-', ''));
    if (!last) throw err;
    data = JSON.parse(last);
    data.stale = true;
    data.staleReason = String(err.message || err);
    return data;
  }
  persistPut_('P' + month.replace('-', ''), JSON.stringify(data));
  const current = month >= todayJst_().slice(0, 7);
  cachePut_(cache, key, JSON.stringify(data), current ? 1800 : 21600);
  return data;
}

function monthRange_(month) {
  const [y, m] = month.split('-').map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return {start: month + '-01', end: end, sinceUtc: new Date(Date.UTC(y, m - 1, 1) - 9 * 3600 * 1000).toISOString()};
}

function tally_(list, fn) {
  const out = {};
  list.forEach(x => { const k = fn(x) || '未設定'; out[k] = (out[k] || 0) + 1; });
  return out;
}

function buildPromotion_(month) {
  const range = monthRange_(month);
  const fieldOf = t => { const o = {}; (t.custom_fields || []).forEach(f => { o[f.gid] = f.display_value; }); return o; };
  const optFields = 'name,completed,parent,due_on,created_at,custom_fields.gid,custom_fields.display_value';

  // 申込
  const af = CFG.applicationFields;
  const seen = {};
  const apps = asanaList_('/projects/' + CFG.project + '/tasks', {completed_since: range.sinceUtc, opt_fields: optFields, limit: 100})
    .filter(t => !t.parent && !seen[t.gid] && (seen[t.gid] = true))
    .map(t => ({t: t, f: fieldOf(t)}))
    .filter(x => { const d = parseJpDate_(x.f[af.date]); return d && d >= range.start && d <= range.end && !['テンプレ', '除外'].includes(x.f[CFG.fields.s]); });
  const application = {
    total: apps.length,
    byStatus: tally_(apps, x => x.f[CFG.fields.s]),
    byArea: tally_(apps, x => x.f[CFG.fields.a]),
    byKind: tally_(apps, x => x.f[CFG.fields.m]),
    byBroker: tally_(apps, x => x.f[af.broker]),
    byContract: tally_(apps, x => x.f[af.contract]),
    byRoute: tally_(apps, x => x.f[af.route]),
    bySelfViewing: tally_(apps, x => x.f[af.selfViewing])
  };

  // 反響（セルフ内見予約表）
  const sv = CFG.selfViewing;
  const seen2 = {};
  let rows = asanaList_('/projects/' + sv.project + '/tasks', {completed_since: range.sinceUtc, opt_fields: optFields, limit: 100})
    // 親タスクの有無は問わない（反響タスクを空室一覧の部屋に紐付ける運用があるため）。社内用サブタスクは種別が空なので反響に入らない
    .filter(t => !seen2[t.gid] && (seen2[t.gid] = true) && t.due_on && t.due_on >= range.start && t.due_on <= range.end)
    .map(t => ({t: t, f: fieldOf(t)}));
  // 登録エラーの重複（同一秒に一括生成＋主要項目が空）を除外
  const bySecond = tally_(rows, x => String(x.t.created_at || '').slice(0, 19));
  const blank = x => !x.f[CFG.fields.p] && !x.f[sv.source] && !x.f[sv.result];
  const excluded = rows.filter(x => bySecond[String(x.t.created_at || '').slice(0, 19)] > 1 && blank(x)).length;
  rows = rows.filter(x => !(bySecond[String(x.t.created_at || '').slice(0, 19)] > 1 && blank(x)));
  const normName = s => String(s || '').normalize('NFKC').replace(/\s+/g, '');
  const propertyOf = x => normName(x.f[CFG.fields.p]).replace(/[0-9０-９]+号?室?$/, '');
  const group5 = src => ({SUUMO: 'SUUMO', 'アットホーム': 'アットホーム', '看板': '看板', '仲介業者': '仲介', '仲介同行': '仲介', 'ホームページ': 'HP', '紹介': '紹介'})[src] || (src ? 'その他' : '未設定');
  const axisCount = (list, keyFn) => {
    const people = {}, props = {};
    list.forEach(x => {
      const k = keyFn(x) || '未設定';
      const person = normName(x.t.name);
      (people[k] = people[k] || {})[person] = true;                       // ②人物名ごと
      (props[k] = props[k] || {})[person + '|' + propertyOf(x)] = true;    // ①物件ごと（同一物件の複数号室は1件）
    });
    const out = {};
    Object.keys(people).forEach(k => { out[k] = {people: Object.keys(people[k]).length, properties: Object.keys(props[k]).length}; });
    return out;
  };
  const inquiry = rows.filter(x => x.f[sv.type] === '反響' || x.f[sv.type] === 'かってに内見');
  const broker = rows.filter(x => x.f[sv.type] === '仲介同行');
  const response = {
    total: axisCount(inquiry, () => '合計')['合計'] || {people: 0, properties: 0},
    byType: axisCount(inquiry, x => x.f[sv.type]),
    bySource: axisCount(inquiry, x => x.f[sv.source]),
    byGroup: axisCount(inquiry, x => group5(x.f[sv.source])),
    byResult: axisCount(inquiry, x => x.f[sv.result]),
    byStore: axisCount(inquiry, x => x.f[sv.store]),
    byArea: axisCount(inquiry, x => x.f[CFG.fields.a]),
    brokerVisits: broker.length,
    excluded: excluded,
    // 物件別の反響件数（物件ごと軸）。空室の「反響ゼロ」判定に使う。個人名は含めない
    byProperty: (() => { const o = {}; inquiry.forEach(x => { const p = propertyOf(x); if (!p) return; (o[p] = o[p] || {})[normName(x.t.name)] = true; }); Object.keys(o).forEach(k => { o[k] = Object.keys(o[k]).length; }); return o; })()
  };
  return {month: month, asOf: new Date().toISOString(), range: range, application: application, response: response};
}

/* ---------- 管理戸数の自動取得（Teams 全体会議資料・Microsoft Graph） ---------- */
/* 事前に Microsoft Entra でアプリ登録（アプリケーション権限 Sites.Read.All／Files.Read.All・管理者の同意）が必要。
   MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET をスクリプトプロパティに保存し、installManagementTrigger を1回実行する */

function graphToken_() {
  const pr = PropertiesService.getScriptProperties();
  const tenant = pr.getProperty('MS_TENANT_ID'), id = pr.getProperty('MS_CLIENT_ID'), secret = pr.getProperty('MS_CLIENT_SECRET');
  if (!tenant || !id || !secret) throw new Error('MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET が未設定です');
  const res = UrlFetchApp.fetch('https://login.microsoftonline.com/' + tenant + '/oauth2/v2.0/token', {
    method: 'post', muteHttpExceptions: true,
    payload: {client_id: id, client_secret: secret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials'}
  });
  const body = JSON.parse(res.getContentText());
  if (!body.access_token) throw new Error('Microsoftの認証に失敗しました：' + (body.error_description || res.getResponseCode()));
  return body.access_token;
}

function graphGet_(token, path) {
  const res = UrlFetchApp.fetch('https://graph.microsoft.com/v1.0' + path, {headers: {Authorization: 'Bearer ' + token}, muteHttpExceptions: true});
  if (res.getResponseCode() >= 300) throw new Error('Microsoft Graph ' + res.getResponseCode() + '：' + path);
  return JSON.parse(res.getContentText());
}

function graphChildren_(token, itemPath) {
  const enc = itemPath.split('/').map(encodeURIComponent).join('/');
  return graphGet_(token, '/drives/' + CFG.meetingDocs.driveId + '/root:/' + enc + ':/children?$top=200').value || [];
}

/** 最新の全体会議資料を探して管理戸数を読み、M_YYYY-MM（実績月）に保存する。変化がなければ何もしない */
function importManagementFromMeetingDoc() {
  const token = graphToken_();
  const base = CFG.meetingDocs.folder;
  const years = graphChildren_(token, base).filter(x => x.folder && /^\d{4}年$/.test(x.name)).map(x => x.name).sort();
  if (!years.length) throw new Error('年フォルダが見つかりません');
  const yearPath = base + '/' + years[years.length - 1];
  const rounds = graphChildren_(token, yearPath).filter(x => x.folder && /^第\d+回\d{6}/.test(x.name))
    .sort((a, b) => Number(b.name.match(/^第(\d+)回/)[1]) - Number(a.name.match(/^第(\d+)回/)[1]));
  for (const round of rounds) {
    const file = graphChildren_(token, yearPath + '/' + round.name)
      .filter(x => x.file && /全体会議資料.*\.xlsx$/.test(x.name) && /(\d{4})年(\d{1,2})月度[（(](\d{1,2})月実績/.test(x.name))[0];
    if (!file) continue;
    const m = file.name.match(/(\d{4})年(\d{1,2})月度[（(](\d{1,2})月実績/);
    const year = Number(m[3]) > Number(m[2]) ? Number(m[1]) - 1 : Number(m[1]);
    const month = year + '-' + ('0' + m[3]).slice(-2);
    const sheets = graphGet_(token, '/drives/' + CFG.meetingDocs.driveId + '/items/' + file.id + '/workbook/worksheets').value || [];
    const sheet = sheets.find(w => /^令和\d+年\d+月期/.test(String(w.name).trim()));
    if (!sheet) throw new Error(file.name + '：「令和○年○月期」タブが見つかりません');
    const values = graphGet_(token, '/drives/' + CFG.meetingDocs.driveId + '/items/' + file.id +
      "/workbook/worksheets('" + encodeURIComponent(sheet.name) + "')/range(address='X4:AF8')").values;
    // 「2.エリア別」：4行目＝見出し、5行目＝サブリース戸数、8行目＝一般管理戸数。列 X/Z/AB/AD＝長崎中央/長崎北/諫早/大村、AF＝計
    const cols = {'長崎中央': 0, '長崎北': 2, '諫早': 4, '大村': 6};
    const areas = {};
    Object.keys(cols).forEach(a => {
      if (String(values[0][cols[a]]).trim() !== a) throw new Error(file.name + '：見出しが想定と違います（' + values[0][cols[a]] + '）。セル位置を確認してください');
      areas[a] = {sub: Number(values[1][cols[a]]), general: Number(values[4][cols[a]])};
      if (!isFinite(areas[a].sub) || !isFinite(areas[a].general)) throw new Error(file.name + '：' + a + 'の戸数が数値ではありません');
    });
    const sum = k => Object.keys(areas).reduce((n, a) => n + areas[a][k], 0);
    if (sum('sub') !== Number(values[1][8]) || sum('general') !== Number(values[4][8])) throw new Error(file.name + '：合計が一致しません');
    const pr = PropertiesService.getScriptProperties();
    const before = pr.getProperty('M_' + month);
    const prevAreas = before ? JSON.stringify(JSON.parse(before).areas) : null;
    if (prevAreas === JSON.stringify(areas)) { Logger.log(month + '：変更なし（' + file.name + '）'); return; }
    pr.setProperty('M_' + month, JSON.stringify({areas: areas, source: file.name + '「' + sheet.name.trim() + '」2.エリア別（自動取得）', savedAt: new Date().toISOString()}));
    CacheService.getScriptCache().remove('snapshot_n');
    Logger.log(month + '：登録しました（' + file.name + '）');
    notifyAdmin_('管理戸数を自動登録しました', month + ' の管理戸数を ' + file.name + ' から登録しました（サブ' + sum('sub') + '・一般' + sum('general') + '）。');
    return;
  }
  throw new Error('全体会議資料が見つかりません');
}

/** 手動で1回実行：自動処理を登録する（15分ごとのデータ更新、毎日17:30の点検・管理戸数の自動取得） */
function installTriggers() {
  ScriptApp.getProjectTriggers().filter(t => ['dailyJob', 'refreshJob'].includes(t.getHandlerFunction())).forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyJob').timeBased().everyDays(1).atHour(17).nearMinute(30).inTimezone('Asia/Tokyo').create();
  ScriptApp.newTrigger('refreshJob').timeBased().everyMinutes(15).create();
  Logger.log('自動処理を登録しました');
}
function installManagementTrigger() { installTriggers(); } // 旧名

/** 15分ごと：Asanaから取り直して「最後に正常なデータ」を更新する。失敗が続いたら通知 */
function refreshJob() {
  try {
    refreshSnapshot_();
  } catch (e) {
    setStatus_('error', String(e.message || e));
    const pr = PropertiesService.getScriptProperties();
    const fails = Number(pr.getProperty('STATUS_FAILS') || 0) + 1;
    pr.setProperty('STATUS_FAILS', String(fails));
    if (fails === 4) notifyAdmin_('空室業務ダッシュボード：Asanaからデータを取得できません', '1時間以上、取得に失敗しています。画面は最後に取得したデータで表示を続けています。\n\n' + e.message, 'refresh');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('STATUS_FAILS', '0');
}

function setStatus_(kind, text) {
  const pr = PropertiesService.getScriptProperties();
  if (kind === 'ok') pr.setProperty('STATUS_LAST_OK', new Date().toISOString());
  else pr.setProperties({STATUS_LAST_ERROR: new Date().toISOString() + ' ' + String(text).slice(0, 300)});
}

/* 「最後に正常に取得したデータ」をスクリプトプロパティに分割保存（1値9KBまで） */
function persistPut_(prefix, text) {
  const pr = PropertiesService.getScriptProperties();
  const size = 8000, parts = {};
  const n = Math.ceil(text.length / size);
  for (let i = 0; i < n; i++) parts['X_' + prefix + '_' + i] = text.slice(i * size, (i + 1) * size);
  const oldN = Number(pr.getProperty('X_' + prefix + '_n') || 0);
  parts['X_' + prefix + '_n'] = String(n);
  pr.setProperties(parts);
  for (let i = n; i < oldN; i++) pr.deleteProperty('X_' + prefix + '_' + i);
}

function persistGet_(prefix) {
  const all = PropertiesService.getScriptProperties().getProperties();
  const n = Number(all['X_' + prefix + '_n'] || 0);
  if (!n) return null;
  let out = '';
  for (let i = 0; i < n; i++) { if (all['X_' + prefix + '_' + i] == null) return null; out += all['X_' + prefix + '_' + i]; }
  return out;
}

function dailyJob() {
  const errors = [];
  try { asanaGet_('/users/me', {opt_fields: 'name'}); } catch (e) { errors.push('Asana接続：' + e.message); }
  const lastOk = PropertiesService.getScriptProperties().getProperty('STATUS_LAST_OK');
  if (!lastOk || Date.now() - new Date(lastOk).getTime() > 6 * 3600 * 1000) errors.push('空室データの更新が6時間以上止まっています（最終成功：' + (lastOk || 'なし') + '）。installTriggers を実行済みか確認してください');
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'refreshJob')) errors.push('15分ごとの自動更新が登録されていません（installTriggers を実行）');
  if (PropertiesService.getScriptProperties().getProperty('MS_CLIENT_ID')) {
    try { importManagementFromMeetingDoc(); } catch (e) { errors.push('管理戸数の自動取得：' + e.message); }
  }
  const latest = Object.keys(readManagement_()).sort().pop();
  const expected = (() => { const [y, m] = todayJst_().split('-').map(Number); return new Date(Date.UTC(y, m - 3, 1)).toISOString().slice(0, 7); })();
  if (!latest || latest < expected) errors.push('管理戸数が古いままです（最新：' + (latest || 'なし') + '）');
  if (errors.length) notifyAdmin_('空室業務ダッシュボード：要確認', errors.join('\n'));
}

function notifyAdmin_(subject, body, throttleKey) {
  const pr = PropertiesService.getScriptProperties();
  const to = pr.getProperty('ALERT_EMAIL');
  if (!to) return;
  if (throttleKey) { // 同じ種類の通知は6時間に1回まで
    const k = 'ALERTED_' + throttleKey, last = pr.getProperty(k);
    if (last && Date.now() - new Date(last).getTime() < 6 * 3600 * 1000) return;
    pr.setProperty(k, new Date().toISOString());
  }
  try { MailApp.sendEmail(to, subject, body + '\n\n（空室業務ダッシュボード GAS から自動送信）'); } catch (e) { Logger.log('通知を送れませんでした：' + e.message); }
}

/* ---------- Asana API ---------- */

function asanaToken_() {
  const t = PropertiesService.getScriptProperties().getProperty('ASANA_TOKEN');
  if (!t) throw new Error('ASANA_TOKEN が未設定です');
  return t;
}

function asanaFetch_(method, path, params, payload) {
  const qs = params ? '?' + Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&') : '';
  const opt = {method: method, headers: {Authorization: 'Bearer ' + asanaToken_()}, muteHttpExceptions: true};
  if (payload) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(payload); }
  let lastError = '';
  // 混雑（429）・Asana側の障害（5xx）・通信エラーは、間隔をあけて最大4回やり直す
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try { res = UrlFetchApp.fetch('https://app.asana.com/api/1.0' + path + qs, opt); }
    catch (e) { lastError = '通信エラー：' + e.message; Utilities.sleep(1000 * Math.pow(2, attempt)); continue; }
    const code = res.getResponseCode();
    if (code === 429 || code >= 500) {
      lastError = 'Asana ' + code;
      const wait = Number((res.getHeaders() || {})['Retry-After']) * 1000 || 1000 * Math.pow(2, attempt);
      Utilities.sleep(Math.min(wait, 15000));
      continue;
    }
    let body = {};
    try { body = JSON.parse(res.getContentText() || '{}'); } catch (_) {}
    if (code >= 300) {
      const e = new Error('Asana ' + code + ': ' + ((body.errors && body.errors[0] && body.errors[0].message) || ''));
      e.retryable = code === 401 || code === 403 ? false : code >= 500;
      if (code === 401) notifyAdmin_('空室業務ダッシュボード：Asanaトークンが無効です', 'ASANA_TOKEN を発行し直して差し替えてください。', 'token');
      throw e;
    }
    return body;
  }
  const e = new Error('Asanaに接続できませんでした（' + lastError + '）。時間をおいて自動で再送します');
  e.retryable = true;
  throw e;
}

function asanaUpload_(parentGid, base64, name) {
  const blob = Utilities.newBlob(Utilities.base64Decode(base64), 'image/jpeg', name);
  const res = UrlFetchApp.fetch('https://app.asana.com/api/1.0/attachments', {
    method: 'post', headers: {Authorization: 'Bearer ' + asanaToken_()},
    payload: {parent: parentGid, file: blob}, muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) throw new Error('写真を添付できませんでした（Asana ' + res.getResponseCode() + '）');
}

function asanaGet_(path, params) { return asanaFetch_('get', path, params).data; }
function asanaPost_(path, payload) { return asanaFetch_('post', path, null, payload).data; }

// 最終ページまで取得（検索APIは使わない＝インデックス遅延による漏れを避ける）
function asanaList_(path, params) {
  const out = [];
  let offset = null;
  do {
    const p = Object.assign({}, params);
    if (offset) p.offset = offset;
    const body = asanaFetch_('get', path, p);
    (body.data || []).forEach(x => out.push(x));
    offset = body.next_page ? body.next_page.offset : null;
  } while (offset);
  return out;
}

/* ---------- 共通 ---------- */

function passOk_(key, value) {
  const expected = PropertiesService.getScriptProperties().getProperty(key);
  if (key === 'EDIT_PASSCODE' && !expected) return true; // 巡回登録は合言葉を空にすると誰でも登録できる
  return Boolean(expected) && String(value || '') === expected;
}

// 「2026年09月21日」「2026/9/21」「2026-09-21」などを YYYY-MM-DD に
function parseJpDate_(text) {
  const m = String(text || '').normalize('NFKC').match(/(\d{4})\D{1,2}(\d{1,2})\D{1,2}(\d{1,2})/);
  if (!m) return null;
  return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
}

function todayJst_() { return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'); }

function addDays_(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// CacheServiceは1値100KBまでのため分割保存
function cachePut_(cache, key, text, seconds) {
  const size = 90000, parts = {};
  const n = Math.ceil(text.length / size);
  for (let i = 0; i < n; i++) parts[key + '_' + i] = text.slice(i * size, (i + 1) * size);
  parts[key + '_n'] = String(n);
  cache.putAll(parts, seconds);
}

function cacheGet_(cache, key) {
  const n = Number(cache.get(key + '_n'));
  if (!n) return null;
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(key + '_' + i);
  const got = cache.getAll(keys);
  if (Object.keys(got).length !== n) return null;
  return keys.map(k => got[k]).join('');
}


/* ---------- 反響レポート（部屋ページのボタンから。氏名は返さず件数のみ） ---------- */

function normKey_(v) { return String(v == null ? '' : v).normalize('NFKC').replace(/[\s・･.．\-‐‑–—－_（）()]+/g, '').toLowerCase(); }

function reportData_(body) {
  if (!passOk_('EDIT_PASSCODE', body.passcode)) throw new Error('合言葉が違います');
  const task = asanaGet_('/tasks/' + encodeURIComponent(body.task), {opt_fields: 'name,memberships.project.gid,custom_fields.gid,custom_fields.display_value'});
  assertInProject_(task);
  const f = {};
  (task.custom_fields || []).forEach(x => { f[x.gid] = x.display_value; });
  const prop = f[CFG.fields.p] || task.name || '';
  const room = f[CFG.fields.r] || '';
  const months = Math.min(Number(body.months) || 3, 6);
  const to = todayJst_();
  const from = Utilities.formatDate(new Date(Date.now() - months * 31 * 86400000), 'Asia/Tokyo', 'yyyy-MM-dd');
  const sv = CFG.selfViewing;
  const rows = asanaList_('/tasks', {project: sv.project, opt_fields: 'name,due_on,custom_fields.gid,custom_fields.display_value', limit: 100});
  const key = normKey_(prop);
  const roomKey = normKey_(room);
  const mine = [];
  rows.forEach(t => {
    if (!t.due_on || t.due_on < from || t.due_on > to) return;
    const g = {};
    (t.custom_fields || []).forEach(x => { g[x.gid] = x.display_value; });
    const pv = String(g[CFG.fields.p] || '');
    const parts = pv.split(/[、,，]|(?<=[^\s])・(?=[^\s])/).map(normKey_).filter(Boolean);
    const exact = normKey_(pv) === key;
    if (!exact && parts.indexOf(key) < 0) return;
    const multi = !exact && parts.length > 1;
    const rooms = multi ? [] : String(g[CFG.fields.r] || '').normalize('NFKC').split(/[・,、\s]+/).filter(Boolean);
    mine.push({
      name: t.name, due: t.due_on, type: g[sv.type] || '未設定', source: g[sv.source] || '未設定',
      result: g[sv.result] || '未設定', thisRoom: !multi && (!roomKey || rooms.some(x => normKey_(x) === roomKey))
    });
  });
  const count = (list, fn) => { const o = {}; list.forEach(x => { const k = fn(x); o[k] = (o[k] || 0) + 1; }); return o; };
  const inquiry = mine.filter(x => x.type === '反響' || x.type === 'かってに内見');
  const viewed = inquiry.filter(x => x.result === '内見のみ' || x.result === '申込');
  const applied = inquiry.filter(x => x.result === '申込');
  const people = {}; inquiry.forEach(x => { people[x.name] = true; });
  const byMonth = count(inquiry, x => x.due.slice(0, 7));
  const vac = vacancyListInfo_(prop, room);
  const moveOut = parseJpDate_(f[CFG.moveOutField]);
  const vacantDays = moveOut && moveOut <= to ? Math.round((new Date(to) - new Date(moveOut)) / 86400000) : null; // 退去前は空室期間なし
  return {
    generatedAt: new Date().toISOString(), from: from, to: to, months: months,
    property: prop, room: room, area: f[CFG.fields.a] || null, management: f[CFG.fields.m] || null,
    status: f[CFG.fields.s] || null, condition: f[CFG.fields.c] || null, moveOut: moveOut, vacantDays: vacantDays,
    total: inquiry.length, people: Object.keys(people).length, thisRoom: inquiry.filter(x => x.thisRoom).length,
    viewed: viewed.length, applied: applied.length,
    byType: count(inquiry, x => x.type), bySource: count(inquiry, x => x.source),
    byResult: count(inquiry, x => x.result), byMonth: byMonth,
    brokerVisits: mine.filter(x => x.type === '仲介同行').length,
    rent: f['1200978990082563'] || (vac && vac.rent) || null,
    layout: vac ? vac.layout : null,
    similar: vac ? vac.similar : [],
    market: marketComps_(body.address || (vac && vac.addr), vac && vac.layout, rentMan_(f['1200978990082563'] || (vac && vac.rent)))
  };
}


/* ---------- 近隣相場（長崎市内の成約事例。スクリプトプロパティ CONTRACT_SHEET_ID のシートを読む） ---------- */

const CITY_RE = /(長崎市|諫早市|大村市|時津町|長与町)/;

// 住所 → {city, town}。西彼杵郡の町は郡名を除いた「時津町」「長与町」を市区町とみなす
function townOf_(address) {
  const a = String(address || '').normalize('NFKC').replace(/\s+/g, '').replace(/^長崎県/, '').replace(/西彼杵郡/, '');
  const c = a.match(CITY_RE);
  if (!c) return null;
  const rest = a.slice(a.indexOf(c[1]) + c[1].length);
  const m = rest.match(/^(.+?)(?:[0-9]+丁目|[0-9]|$)/);
  return m && m[1] ? {city: c[1], town: m[1]} : null;
}

function cityOfAddr_(addr) {
  const a = String(addr || '').normalize('NFKC').replace(/西彼杵郡/, '');
  const c = a.match(CITY_RE);
  return c ? c[1] : null;
}

const SIMILAR_LAYOUTS = {
  '1R': ['1K', '1SK'], '1K': ['1R', '1SK', '1DK', '1LDK'], '1SK': ['1R', '1K', '1DK', '1LDK'],
  '1DK': ['1K', '1LDK', '2K'], '1LDK': ['1DK', '2K', '2DK'], '2K': ['2DK', '1LDK'],
  '2DK': ['2K', '2LDK'], '2LDK': ['3LDK', '2DK'], '3K': ['3LDK', '2LDK'], '3DK': ['3LDK', '2LDK'],
  '3LDK': ['2LDK', '4LDK']
};

function normLayout_(v) {
  const t = String(v || '').normalize('NFKC').toUpperCase().replace(/\s+/g, '');
  return /ワンルーム|^1R$/.test(t) ? '1R' : t;
}

function statsOf_(list) {
  if (!list.length) return null;
  const b = list.slice().sort((x, y) => x - y);
  const q = p => { const i = (b.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return b[lo] + (b[hi] - b[lo]) * (i - lo); };
  return {count: b.length, median: q(0.5), q1: q(0.25), q3: q(0.75), min: b[0], max: b[b.length - 1]};
}

function marketComps_(address, layout, ownRent) {
  const t = townOf_(address);
  if (!t) return null;
  const town = t.town;
  const id = PropertiesService.getScriptProperties().getProperty('CONTRACT_SHEET_ID');
  if (!id) return {town: town, error: '成約事例シートが未設定です'};
  let values;
  try { values = SpreadsheetApp.openById(id).getSheets()[0].getDataRange().getValues(); }
  catch (e) { return {town: town, error: '成約事例シートを読めません'}; }
  const since = Utilities.formatDate(new Date(Date.now() - 365 * 86400000), 'Asia/Tokyo', 'yyyy/MM/dd');
  const nowYear = Number(Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy'));
  const all = values.slice(1).map(r => {
    const built = r[5] instanceof Date ? Utilities.formatDate(r[5], 'Asia/Tokyo', 'yyyy/MM') : String(r[5] || '');
    const y = Number((built.match(/^(\d{4})/) || [])[1]);
    return {
      name: String(r[1] || '').replace(/[0-9０-９]{3,4}$/, '').replace(/^-$/, '（名称なし）'),
      addr: String(r[2] || '').normalize('NFKC'), layout: normLayout_(r[3]), rent: Number(r[4]), built: built,
      age: y ? nowYear - y : null,
      date: r[6] instanceof Date ? Utilities.formatDate(r[6], 'Asia/Tokyo', 'yyyy/MM/dd') : String(r[6] || '')
    };
  }).filter(x => x.rent > 0 && cityOfAddr_(x.addr) !== null && x.date >= since);
  const lay = normLayout_(layout);
  const simLayouts = lay ? (SIMILAR_LAYOUTS[lay] || []) : [];
  const pick = (rows) => ({
    same: rows.filter(x => lay && x.layout === lay),
    similar: rows.filter(x => simLayouts.indexOf(x.layout) >= 0)
  });
  const sameCity = all.filter(x => cityOfAddr_(x.addr) === t.city);
  const inTown = sameCity.filter(x => x.addr.normalize('NFKC').replace(/西彼杵郡/, '').indexOf(t.city + town) >= 0);
  if (!inTown.length && !all.length) return {town: town, count: 0};
  let scope = 'town', g = pick(inTown);
  if (lay && g.same.length + g.similar.length < 5) { scope = 'city'; g = pick(sameCity); }
  const base = lay ? g.same.concat(g.similar) : inTown;
  if (!base.length) return {town: town, count: inTown.length ? inTown.length : 0, scope: scope, layout: lay || null};
  const own = Number(ownRent) > 0 ? Number(ownRent) : null;
  const examples = base.slice().sort((a, b) => own ? Math.abs(a.rent - own) - Math.abs(b.rent - own) : b.date.localeCompare(a.date))
    .slice(0, 8).map(x => ({name: x.name, layout: x.layout, rent: x.rent, built: x.built, age: x.age, date: x.date, kind: lay && x.layout === lay ? '同じ間取り' : '類似間取り'}));
  return {town: town, city: t.city, scope: scope, layout: lay || null, similarLayouts: simLayouts, period: '直近12か月',
    count: base.length, same: statsOf_(g.same.map(x => x.rent)), similar: statsOf_(g.similar.map(x => x.rent)),
    all: statsOf_(base.map(x => x.rent)), examples: examples};
}

// 長期空室リスト（スクリプトプロパティ LIST_SHEET_ID）から、その部屋の間取り・賃料・住所・類似成約を読む。該当しなければ null
function vacancyListInfo_(prop, room) {
  const id = PropertiesService.getScriptProperties().getProperty('LIST_SHEET_ID');
  if (!id) return null;
  try {
    const sh = SpreadsheetApp.openById(id).getSheetByName('長期空室一覧');
    if (!sh) return null;
    const v = sh.getDataRange().getValues();
    const hi = v.findIndex(r => r[0] === 'No.');
    if (hi < 0) return null;
    const pk = normKey_(prop), rk = normKey_(room);
    for (let i = hi + 1; i < v.length; i++) {
      const r = v[i];
      if (normKey_(r[2]) === pk && normKey_(r[3]) === rk) {
        const rent = Number(String(r[10]).replace(/[^0-9]/g, ''));
        return {addr: String(r[8] || ''), layout: String(r[9] || ''), rent: rent ? rent / 10000 + '万円' : null,
          similar: [r[18], r[19], r[20]].map(x => String(x || '')).filter(Boolean)};
      }
    }
  } catch (e) {}
  return null;
}

function rentMan_(v) {
  const n = parseFloat(String(v || '').replace(/[^0-9.]/g, ''));
  return n > 0 ? (n > 1000 ? n / 10000 : n) : null;
}


/* ---------- 物件紹介LP作成の依頼（ボタン→待ち行列→Claudeが作成→URLを書き戻す） ---------- */
// 状態の正本＝物件タスク直下のサブタスク「物件紹介LP」の説明欄（プロパティには書かない）。待ち行列はスクリプトプロパティ LP_QUEUE。
// スクリプトプロパティ LP_WORKER_KEY：作成側（Claude）が待ち行列を読み書きするための鍵（必須）

const LP_TASK_NAME = '物件紹介LP';

function lpNotes_(state, extra) {
  return ['状態: ' + state, extra && extra.url ? 'URL: ' + extra.url : '', extra && extra.message ? 'メモ: ' + extra.message : '', '更新: ' + new Date().toISOString()].filter(Boolean).join('\n');
}

function lpFind_(task) {
  const subs = asanaGet_('/tasks/' + encodeURIComponent(task) + '/subtasks', {opt_fields: 'name,notes'}) || [];
  return subs.find(t => t.name === LP_TASK_NAME) || null;
}

function lpParse_(sub) {
  if (!sub) return {state: 'none'};
  const n = sub.notes || '';
  const state = (n.match(/状態:\s*(\S+)/) || [])[1] || '依頼中';
  return {state: state, url: (n.match(/URL:\s*(\S+)/) || [])[1] || null, message: (n.match(/メモ:\s*(.+)/) || [])[1] || null, subtask: sub.gid};
}

function lpQueueGet_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('LP_QUEUE') || '[]'); } catch (_) { return []; } }
function lpQueuePut_(q) { PropertiesService.getScriptProperties().setProperty('LP_QUEUE', JSON.stringify(q)); }

function lpStatus_(task) { return lpParse_(lpFind_(task)); }

function lpRequest_(body) {
  if (!passOk_('EDIT_PASSCODE', body.passcode)) throw new Error('合言葉が違います');
  const task = asanaGet_('/tasks/' + encodeURIComponent(body.task), {opt_fields: 'name,memberships.project.gid,custom_fields.gid,custom_fields.display_value'});
  assertInProject_(task);
  const cur = lpParse_(lpFind_(body.task));
  if (cur.state === '依頼中' || cur.state === '作成中' || cur.state === '完了') return cur;
  const f = {};
  (task.custom_fields || []).forEach(x => { f[x.gid] = x.display_value; });
  const prop = f[CFG.fields.p] || task.name || '', room = f[CFG.fields.r] || '';
  let sub = cur.subtask ? {gid: cur.subtask} : null;
  if (sub) asanaFetch_('put', '/tasks/' + sub.gid, null, {data: {notes: lpNotes_('依頼中')}});
  else sub = asanaPost_('/tasks/' + encodeURIComponent(body.task) + '/subtasks', {data: {name: LP_TASK_NAME, notes: lpNotes_('依頼中')}});
  const q = lpQueueGet_().filter(x => x.task !== body.task);
  q.push({task: body.task, subtask: sub.gid, property: prop, room: room, at: new Date().toISOString()});
  lpQueuePut_(q);
  return {state: '依頼中', subtask: sub.gid};
}

function lpWorkerOk_(key) {
  const expected = PropertiesService.getScriptProperties().getProperty('LP_WORKER_KEY');
  if (!expected || String(key || '') !== expected) throw new Error('鍵が違います');
}

function lpQueue_(key) { lpWorkerOk_(key); return {queue: lpQueueGet_()}; }

// 作成側が呼ぶ：state＝作成中／完了／失敗。完了・失敗は待ち行列から外す
function lpUpdate_(body) {
  lpWorkerOk_(body.key);
  if (['作成中', '完了', '失敗'].indexOf(body.state) < 0) throw new Error('状態が不正です');
  const item = lpQueueGet_().find(x => x.task === body.task);
  const subtask = (item && item.subtask) || (lpFind_(body.task) || {}).gid;
  if (!subtask) throw new Error('依頼が見つかりません');
  asanaFetch_('put', '/tasks/' + subtask, null, {data: {notes: lpNotes_(body.state, {url: body.url, message: body.message}), completed: body.state === '完了'}});
  if (body.state !== '作成中') lpQueuePut_(lpQueueGet_().filter(x => x.task !== body.task));
  return {ok: true};
}
