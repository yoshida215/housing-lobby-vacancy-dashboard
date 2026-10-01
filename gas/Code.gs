/**
 * 空室業務ダッシュボード API（Google Apps Script）
 *
 * - 画面（GitHub Pages）からの読み取り・巡回登録を受け、Asanaへ中継する。
 * - Asanaトークンはスクリプトプロパティ ASANA_TOKEN にのみ保存する。画面側には渡さない。
 * - 巡回記録は【空室一覧】の該当タスクへ「【巡回記録】」コメントとして蓄積する。
 *
 * スクリプトプロパティ：
 *   ASANA_TOKEN     Asana個人アクセストークン（必須）
 *   EDIT_PASSCODE   巡回登録用の合言葉（必須）
 *   ADMIN_PASSCODE  管理戸数登録用の合言葉（必須）
 *   HISTORY_SHEET_ID 日次入居率を記録するスプレッドシートID（任意）
 *   ASSIGNEE_NAGASAKI 長崎北・長崎中央・セキスイ・古里のサブタスク担当者（Asanaのメールアドレス）
 *   ASSIGNEE_KENOU    諫早・大村のサブタスク担当者（Asanaのメールアドレス）
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
      case 'ping': return json_({ok: true, at: new Date().toISOString()});
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
      case 'checkPasscode': return json_({ok: passOk_('EDIT_PASSCODE', body.passcode)});
      default: return json_({error: '不明な操作です'});
    }
  } catch (err) {
    return json_({error: String(err.message || err)});
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
  const data = buildSnapshot_();
  cachePut_(cache, 'snapshot', JSON.stringify(data), CFG.cacheSeconds);
  data.patrolIndex = readPatrolIndex_();
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
  const plan = {parent: null, existingParent: null, create: [], complete: [], parentsToCheck: {}, openByKey: {}, lines: []};
  const subs = asanaList_('/tasks/' + r.task + '/subtasks', {opt_fields: 'name,notes,completed', limit: 100});
  const mine = subs.find(t => String(t.notes || '').indexOf('ID:' + r.clientId) >= 0);
  if (mine) plan.existingParent = mine.gid;
  else { plan.parent = CFG.patrolTaskName(r.date); plan.lines.push('サブタスク「' + plan.parent + '」を作成（巡回記録）'); }

  // 未完了の対応タスク（過去の巡回確認の中、および旧形式の直下サブタスク）
  const openTasks = {};
  subs.filter(t => /^巡回確認（/.test(t.name || '')).forEach(p => {
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
      if (open.length) { plan.openByKey[x.key] = open[0].gid; plan.lines.push('「' + x.task + '」は未完了のタスクがあるため作成しない（' + open[0].from + '）'); }
      else if (!mine) { plan.create.push({key: x.key, name: x.task}); plan.lines.push('　└ 「' + x.task + '」を作成'); }
    } else if (open.length) {
      open.forEach(t => { plan.complete.push(t.gid); if (t.parent) plan.parentsToCheck[t.parent] = true; });
      plan.lines.push('「' + x.task + '」を完了（' + open[0].from + '）');
    }
  });
  if ((r.photoCount || r.otherIssue) && !mine) {
    plan.create.push({key: 'other', name: CFG.otherTaskName});
    plan.lines.push('　└ 「' + CFG.otherTaskName + '」を作成（' + [r.otherIssue ? 'コメントあり' : '', r.photoCount ? '写真' + r.photoCount + '枚を添付' : ''].filter(Boolean).join('・') + '）');
  }
  return plan;
}

// 実行し、写真の添付先（項目キー→タスクGID、null→巡回確認）を返す
/* サブタスクの担当者と期日。地区・管理種別で振り分け、メールアドレスはスクリプトプロパティから読む */
function assignmentFor_(task) {
  const byId = {};
  (task.custom_fields || []).forEach(f => { byId[f.gid] = f.display_value; });
  const area = byId[CFG.fields.a] || '', kind = byId[CFG.fields.m] || '';
  // セキスイ・古里は地区より優先。諫早・大村以外（地区が空欄を含む）は長崎担当
  const kenou = (area === '諫早' || area === '大村') && kind !== 'セキスイ物件' && kind !== '古里物件';
  const key = kenou ? 'ASSIGNEE_KENOU' : 'ASSIGNEE_NAGASAKI';
  const email = PropertiesService.getScriptProperties().getProperty(key);
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
  if (plan.parent) {
    const parent = asanaPost_('/tasks/' + r.task + '/subtasks', subtaskData_(plan.parent, patrolText_(r), who));
    targets[''] = parent.gid;
    plan.create.forEach(c => {
      const x = CFG.patrolFields.find(f => f.key === c.key);
      const notes = x
        ? r.date + 'の巡回（担当：' + r.inspector + '）で「' + x.name + '：' + x.ng + '」を確認。\n対応後、次の巡回で「' + x.ok + '」を登録すると自動で完了になります。'
        : (r.otherIssue ? r.otherIssue + '\n\n' : '') + '―――\n' + r.date + 'の巡回（担当：' + r.inspector + '）で確認。' + (r.photoCount ? '写真' + r.photoCount + '枚を添付しています。' : '') + '\n対応後、このタスクを完了にしてください。';
      const t = asanaPost_('/tasks/' + parent.gid + '/subtasks', subtaskData_(c.name, notes, who));
      targets[c.key] = t.gid;
    });
    if (!plan.create.length) asanaFetch_('put', '/tasks/' + parent.gid, null, {data: {completed: true}}); // 要対応なし＝巡回確認は完了
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
    const dup = Boolean(plan.existingParent);
    const targets = applyFollowUps_(r, plan, task);
    let attached = 0;
    if (!dup) photos.forEach((p, i) => {
      const parent = targets.other || targets[''];
      if (!parent || !p || typeof p.data !== 'string' || p.data.length > 6000000) return;
      asanaUpload_(parent, p.data, r.date + '_other_' + (i + 1) + '.jpg'); // 日本語名は添付で文字化けするため英字
      attached++;
    });
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
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = UrlFetchApp.fetch('https://app.asana.com/api/1.0' + path + qs, opt);
    const code = res.getResponseCode();
    if (code === 429) { Utilities.sleep(1500 * (attempt + 1)); continue; }
    const body = JSON.parse(res.getContentText() || '{}');
    if (code >= 300) throw new Error('Asana ' + code + ': ' + ((body.errors && body.errors[0] && body.errors[0].message) || ''));
    return body;
  }
  throw new Error('Asanaが混み合っています。少し待って再度お試しください');
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
  return Boolean(expected) && String(value || '') === expected;
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
