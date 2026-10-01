// 現地確認の項目。gas/Code.gs の CFG.patrolFields と同じ内容に保つこと。
// ok＝チェックありの値、ng＝チェックなしの値（task があれば「巡回確認」の中に対応タスクを作る）、na＝「該当なし」を選べる項目
window.PATROL_ITEMS = [
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
];
// 鍵種別がこれらのときは電子キーではないため、電池確認を「該当なし」で初期表示する
window.NON_ELECTRONIC_KEYS = ['キーボックス'];
