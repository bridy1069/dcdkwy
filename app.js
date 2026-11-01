/* ============================================================
   晓艳四级高频词 · 每日打卡
   纯前端单页应用，数据保存在 localStorage，无需联网
   ============================================================ */

/* ---------- 词库 ---------- */
/* WORDS_DATA 由 data 注入：[id, 单词, 音标, 词性, 释义, 页] */
const RAW = window.WORDS_DATA || [];
const WORDS = RAW.map(([id, w, ph, pos, cn, p]) => ({ id, w, ph, pos, cn, p }));
const WORD_MAP = new Map(WORDS.map(w => [w.id, w]));

/* ---------- 存储 ---------- */
const KEY = 'xy_vocab_v1';
const DEFAULT_STATE = {
  ver: 1,
  settings: {
    dailyGoal: 20,
    mode: 'mixed',        // mixed | recognize | spell
    dark: false,
    autoSpeak: true,
    reviewCap: 30,        // 每日复习上限
  },
  progress: {},           // id -> { s:状态 new/learn/master, ef:难度因子, ivl:间隔天, due:时间戳, n:复习次数, wrong:错误次数, right:正确次数, last:最后作答时间 }
  days: {},               // 'YYYY-MM-DD' -> { learned:[ids], reviewed:n, correct:n, total:n, done:true }
  stars: [],              // 收藏
  streak: 0,
  lastDay: '',
  totalLearned: 0,
};

let S = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const d = JSON.parse(raw);
    return Object.assign(structuredClone(DEFAULT_STATE), d, {
      settings: Object.assign({}, DEFAULT_STATE.settings, d.settings || {}),
    });
  } catch (e) {
    return structuredClone(DEFAULT_STATE);
  }
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('存储空间不足'); }
  }, 120);
}
function saveNow() {
  clearTimeout(saveTimer);
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
}

/* ---------- 工具 ---------- */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const DAY = 86400000;
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dayOf(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const rnd = n => Math.floor(Math.random() * n);
function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('on'), 1800);
}
function haptic(ms) {
  try { if (navigator.vibrate) navigator.vibrate(ms || 12); } catch (e) {}
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* 今日数据 */
function todayRec() {
  const k = today();
  if (!S.days[k]) S.days[k] = { learned: [], reviewed: 0, correct: 0, total: 0, done: false };
  return S.days[k];
}

/* ---------- 进度状态 ---------- */
function getProg(id) {
  if (!S.progress[id]) {
    S.progress[id] = { s: 'new', ef: 2.5, ivl: 0, due: 0, n: 0, wrong: 0, right: 0, last: 0 };
  }
  return S.progress[id];
}

/* SM-2 简化算法 */
function grade(id, quality) {
  // quality: 0=完全忘记 1=模糊 2=想起 3=秒答
  const p = getProg(id);
  p.n++;
  p.last = Date.now();
  if (quality >= 2) {
    p.right++;
    if (p.n === 1) p.ivl = 1;
    else if (p.n === 2) p.ivl = 3;
    else p.ivl = Math.round(p.ivl * p.ef);
    if (quality === 3) p.ivl = Math.round(p.ivl * 1.35);
    p.ivl = Math.min(p.ivl, 180);
    p.ef = Math.min(2.9, p.ef + (quality === 3 ? 0.08 : 0.02));
  } else {
    p.wrong++;
    p.ivl = quality === 0 ? 1 : 1;
    p.ef = Math.max(1.3, p.ef - 0.22);
    p.n = 0;
  }
  p.due = Date.now() + p.ivl * DAY;
  if (p.s === 'new') p.s = 'learn';
  if (p.ivl >= 7 && p.right >= 3) p.s = 'master';
  if (p.ivl === 1 && p.right < 2) p.s = 'learn';
  p.s = p.s === 'master' && p.ivl < 7 ? 'learn' : p.s;
  save();
  return p;
}
function markKnown(id) {
  // 标记已掌握（快速通道）
  const p = getProg(id);
  p.s = 'master'; p.n = Math.max(p.n, 3); p.ivl = Math.max(p.ivl, 14);
  p.due = Date.now() + p.ivl * DAY; p.right++;
  save();
}

/* ---------- 待复习 ---------- */
function dueWords(limit) {
  const now = Date.now();
  const list = [];
  for (const id in S.progress) {
    const p = S.progress[id];
    if (p.s !== 'new' && p.due <= now) list.push({ id: +id, p });
  }
  // 越早到期、错误越多越优先
  list.sort((a, b) => (a.p.due - b.p.due) || (b.p.wrong - a.p.wrong));
  const arr = list.map(x => x.id);
  return limit ? arr.slice(0, limit) : arr;
}

function newWords(limit) {
  const arr = [];
  for (const w of WORDS) {
    if (!S.progress[w.id]) arr.push(w.id);
    if (limit && arr.length >= limit) break;
  }
  return arr;
}

function learnedCount() {
  return Object.keys(S.progress).filter(k => S.progress[k].s !== 'new').length;
}
function masterCount() {
  return Object.keys(S.progress).filter(k => S.progress[k].s === 'master').length;
}

/* ---------- 连续打卡 ---------- */
function calcStreak() {
  let n = 0;
  const d = new Date();
  for (let i = 0; i < 400; i++) {
    const k = dayOf(d.getTime());
    const r = S.days[k];
    if (r && r.done) { n++; d.setDate(d.getDate() - 1); }
    else if (i === 0) { d.setDate(d.getDate() - 1); }  // 今天还没完成不算断
    else break;
  }
  return n;
}

/* ---------- 发音 ---------- */
let voiceReady = false;
function speak(text) {
  if (!S.settings.autoSpeak) return;
  if (!('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.88;
    const vs = speechSynthesis.getVoices();
    const v = vs.find(x => /en-US/.test(x.lang) && /female|Samantha|Zira|Google US/i.test(x.name))
      || vs.find(x => /^en/.test(x.lang));
    if (v) u.voice = v;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) {}
}
if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = () => { voiceReady = true; };
}

/* ---------- 记忆辅助 ---------- */

/* 词根：只在"词中/词尾"出现才有效，用作语义线索 */
const ROOTS = {
  spect: '看', spic: '看', vis: '看', vid: '看', aud: '听', dict: '说', loqu: '说',
  scrib: '写', script: '写', graph: '写/画', gram: '写', port: '携带/搬运', duc: '引导', duct: '引导',
  mit: '送/放', miss: '送/放', fer: '带来', ject: '投掷', tract: '拉/拖', press: '压',
  fac: '做', fact: '做', fect: '做', fic: '做', form: '形状', struct: '建造', pos: '放', pon: '放',
  sta: '站立', sist: '站立', sed: '坐', sid: '坐', cad: '落下', cas: '落下',
  grad: '走/步', gress: '走', ced: '走/让', ceed: '走', ven: '来', vent: '来', cur: '跑', curr: '跑',
  cap: '拿/头', capt: '拿', cept: '拿', cip: '拿', tain: '握持', ten: '握持', man: '手', ped: '脚', pod: '脚',
  cord: '心', psych: '心理', bio: '生命', geo: '地', aqua: '水', hydr: '水', therm: '热',
  phon: '声音', son: '声音', photo: '光', lum: '光', clar: '清楚', brev: '短',
  magn: '大', micro: '小', multi: '多', equ: '相等', fid: '信任', cred: '相信',
  sci: '知道', gnos: '知道', not: '标记/知道', memor: '记忆',
  path: '感受/疾病', sens: '感觉', sent: '感觉', mot: '移动', mob: '移动',
  flu: '流', ver: '真实', jur: '法律', leg: '法律/读', lect: '选择/读',
  liber: '自由', domin: '主宰', reg: '统治', polit: '政治', civ: '公民', popul: '人民',
  fin: '结束/界限', term: '界限', lim: '界限', mens: '测量', temp: '时间',
  chron: '时间', ann: '年', mort: '死', vit: '生命', gen: '产生', nat: '出生',
  cre: '增长', cres: '增长', aug: '增加', plen: '满', vac: '空', van: '空',
  soci: '社会', cult: '耕作/文化', norm: '标准', simil: '相似',
  val: '价值', pris: '抓', prehend: '抓', empt: '买', vend: '卖', merc: '交易',
  labor: '劳动', oper: '工作', ordin: '顺序', numer: '数字', nom: '名字/规则', nym: '名字',
  ident: '相同', fract: '打碎', rupt: '断裂', cis: '切', sect: '切',
  divid: '分', part: '部分', tort: '扭', vers: '转', vert: '转', volv: '卷',
  pel: '推', puls: '推', fend: '打击', pugn: '打',
};

/* 前缀：只在词首有效，表示方向/否定/程度 */
const PREFIX = {
  ab: '离开、脱离', ad: '朝向、加强', ante: '前', anti: '反对', auto: '自己',
  bene: '好', circum: '环绕', co: '共同', col: '共同', com: '共同', con: '共同、一起',
  contra: '相反', counter: '相反', de: '向下、去除', dis: '分开、否定', di: '分开',
  en: '使…', em: '使…', ex: '向外、出', extra: '以外', fore: '前、预先',
  hyper: '过度', hypo: '在…下、不足', im: '否定、向内', in: '否定、向内',
  inter: '之间', intra: '内部', mal: '坏', mis: '错误',
  mono: '单一', non: '否定', ob: '反对、朝向', out: '向外、超过', over: '过度、在上',
  per: '贯穿、彻底', peri: '周围', post: '之后', pre: '预先、在前', pro: '向前、支持',
  re: '再一次、回', retro: '向后', semi: '半', sub: '在下、次级',
  sur: '在上、超过', super: '在上、超过',
  trans: '穿过、转变', under: '不足、在下', up: '向上', with: '向后、相反',
  un: '否定', uni: '单一、一', bi: '二', tri: '三',
};

/* 这些"假前缀"常出现在以该字母开头的词根前，不能拆 */
const NO_SPLIT = ['att', 'app', 'acc', 'ass', 'all', 'ann', 'arr', 'aff', 'agg',
  'ill', 'imm', 'inn', 'irr', 'eff', 'ell', 'err', 'ess', 'opp', 'occ', 'off',
  'corr', 'coll', 'comm', 'conn', 'supp', 'suff', 'sugg', 'suc', 'susp', 'abil',
  'unif', 'unio', 'unit', 'rela', 'disc'];

/* 常见字母组合发音，帮记忆时找到"感觉" */
const SOUND = [
  [/tion$|sion$/, '-tion/-sion 读 /ʃn/，几乎都是名词：action、decision、conclusion'],
  [/^con|^com|^col|^cor/, 'con- 系列常读 /kən/，后面跟"一起/完全"的意思'],
  [/^ex/, 'ex- 读 /ɪks/ 或 /eks/，表示"向外、出来"'],
  [/^pre/, 'pre- 读 /prɪ/，表示"在前面、预先"'],
  [/^pro/, 'pro- 读 /prə/，表示"向前、支持"'],
  [/^re/, 're- 读 /rɪ/，表示"再一次、往回"'],
  [/^de/, 'de- 读 /dɪ/，表示"向下、去掉"'],
  [/ight$/, '-ight 读 /aɪt/：light、right、bright'],
  [/ought$|aught$/, '-ought/-aught 读 /ɔːt/：thought、caught'],
  [/^ph/, 'ph 读 /f/：phone、photo、phrase'],
  [/^kn/, 'kn 开头 k 不发音：know、knife、knee'],
  [/^wr/, 'wr 开头 w 不发音：write、wrong、wrap'],
  [/^psych/, 'psych- 读 /saɪk/，p 不发音'],
];

function soundHint(w) {
  for (const [re, tip] of SOUND) if (re.test(w.toLowerCase())) return tip;
  return null;
}

/* 生成记忆提示：只给可信的拆解，宁缺毋滥 */
function mnemoHTML(word) {
  const w = typeof word === 'string' ? { w: word, cn: '' } : word;
  const lw = w.w.toLowerCase();
  const blocks = [];

  const root = findRoot(lw);
  const pre = findPrefix(lw);

  if (root) {
    const idx = lw.lastIndexOf(root.k);
    const tail = lw.slice(idx + root.k.length);
    let s = `<b>${esc(root.k)}</b>（${root.m}）`;
    if (pre) s = `<b>${esc(pre.k)}-</b>（${pre.m}） + ` + s;
    if (tail) s += ` + <b>${esc(tail)}</b>`;
    blocks.push({
      h: '🔗 拆开看',
      b: `${s}<br><span style="color:var(--sub);font-size:12.5px">核心意思围绕"${root.m}"展开，理解了就不用死背字形</span>`
    });
  } else if (pre) {
    blocks.push({
      h: '🔗 前缀提示',
      b: `<b>${esc(pre.k)}-</b> 表示"<b>${pre.m}</b>"　→ 顺着这个方向去理解释义`
    });
  }

  const sh = soundHint(w.w);
  if (sh) {
    blocks.push({ h: '🗣 发音规律', b: sh });
  }

  // 一词多义时给记忆锚点
  const senses = w.cn.split('；').filter(Boolean);
  if (senses.length >= 3) {
    blocks.push({
      h: '🧠 多义词怎么记',
      b: `把它压成<b>一个画面</b>：先记住第 1 个意思"<b>${esc(senses[0])}</b>"，其他意思都是从这个意思延伸出去的。考场上只要能想起第一个，剩下的靠语境补。`
    });
  }

  if (!blocks.length) {
    blocks.push({
      h: '💡 这样记',
      b: `读 <b>${esc(w.w)}</b> 三遍，每读一遍在心里说一次"<b>${esc(senses[0])}</b>"。声音和意思一起进脑子，比盯着看有效得多。`
    });
  }

  return `<div class="mnemo">${blocks.slice(0, 2).map(x => `<div class="h">${x.h}</div><div class="body">${x.b}</div>`).join('')}</div>`;
}

function findRoot(lw) {
  let best = null;
  for (const k in ROOTS) {
    if (k.length < 3) continue;
    if (lw.length < k.length + 2) continue;
    const idx = lw.indexOf(k);
    if (idx < 0) continue;
    const tail = lw.length - (idx + k.length);
    // 词根必须在词首之外（有前缀）或词尾之外（有后缀）
    if (idx > 0 || tail >= 2) {
      if (!best || k.length > best.k.length) best = { k, m: ROOTS[k] };
    }
  }
  return best;
}

function findPrefix(lw) {
  if (NO_SPLIT.some(x => lw.startsWith(x))) return null;
  let best = null;
  for (const k in PREFIX) {
    if (k.length < 2) continue;
    if (lw.startsWith(k) && lw.length >= k.length + 3) {
      if (!best || k.length > best.k.length) best = { k, m: PREFIX[k] };
    }
  }
  return best;
}

/* ---------- 页面路由 ---------- */
let curPage = 'home';
const PAGE_TITLES = { home: '今日打卡', lib: '词库', stats: '学习统计', me: '我的' };
function go(page) {
  curPage = page;
  $$('.page').forEach(p => p.classList.toggle('on', p.dataset.page === page));
  $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === page));
  const tt = $('#topTitle');
  if (tt) tt.textContent = PAGE_TITLES[page] || '今日打卡';
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (page === 'home') renderHome();
  if (page === 'lib') renderLib();
  if (page === 'stats') renderStats();
  if (page === 'me') renderMe();
}

/* ---------- 首页 ---------- */
function renderHome() {
  const r = todayRec();
  const goal = S.settings.dailyGoal;
  const doneToday = r.learned.length;
  const pct = goal ? Math.min(100, Math.round(doneToday / goal * 100)) : 0;
  const due = dueWords().length;
  const streak = calcStreak();
  const hour = new Date().getHours();
  const greet = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';

  $('#homeGreet').textContent = greet + '，今天也要记住新词';
  const finished = goal > 0 && doneToday >= goal;
  $('#homeBig').textContent = finished ? '今日打卡完成 🎉' : `还差 ${Math.max(0, goal - doneToday)} 个完成今日打卡`;
  $('#homeSub').textContent = `今日新学 ${doneToday} / ${goal}　·　待复习 ${due} 个`;
  const bt = $('#startBtnText');
  if (bt) bt.textContent = finished
    ? (due > 0 ? `继续复习 ${due} 个到期词` : '再学一组新词')
    : '开始今日学习';

  // 环形
  const C = 2 * Math.PI * 40;
  $('#ringFg').setAttribute('stroke-dasharray', `${C * pct / 100} ${C}`);
  $('#ringPct').textContent = pct + '%';

  // 统计
  $('#stStreak').textContent = streak;
  $('#stLearned').textContent = learnedCount();
  $('#stMaster').textContent = masterCount();

  // 日历
  renderCalendar();
}

function renderCalendar() {
  const el = $('#cal');
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const first = new Date(y, m, 1);
  const startWd = (first.getDay() + 6) % 7; // 周一开头
  const daysInM = new Date(y, m + 1, 0).getDate();
  const tk = today();
  let html = ['一', '二', '三', '四', '五', '六', '日'].map(d => `<div class="wd">${d}</div>`).join('');
  for (let i = 0; i < startWd; i++) html += `<div class="d blank"></div>`;
  for (let d = 1; d <= daysInM; d++) {
    const k = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const rec = S.days[k];
    let cls = 'd';
    if (rec && rec.done) cls += ' done';
    else if (rec && (rec.learned.length || rec.reviewed)) cls += ' part';
    if (k === tk) cls += ' today';
    html += `<div class="${cls}">${d}</div>`;
  }
  el.innerHTML = html;

  // 本月统计
  let doneN = 0, learnN = 0;
  for (let d = 1; d <= daysInM; d++) {
    const k = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const rec = S.days[k];
    if (rec && rec.done) doneN++;
    if (rec) learnN += rec.learned.length;
  }
  const sub = $('#calSub');
  if (sub) sub.textContent = `本月打卡 ${doneN} 天 · 新学 ${learnN} 词`;
}

/* ---------- 学习会话 ---------- */
let session = null;

function startSession(kind) {
  const goal = S.settings.dailyGoal;
  const r = todayRec();
  let items = [];
  const due = dueWords(S.settings.reviewCap);
  const needNew = Math.max(0, goal - r.learned.length);

  if (kind === 'review') {
    if (!due.length) { toast('暂时没有到期需要复习的单词'); return; }
    items = due.map(id => ({ id, isNew: false }));
  } else if (kind === 'new') {
    const nw = newWords(needNew || goal);
    if (!nw.length) { toast('词库已全部学完，去复习巩固吧'); return; }
    items = nw.map(id => ({ id, isNew: true }));
  } else {
    // 打卡：先复习到期词，再学新词
    const rev = due.map(id => ({ id, isNew: false }));
    const nw = newWords(needNew || goal).map(id => ({ id, isNew: true }));
    // 交错排列，避免连续同类型
    items = interleave(rev, nw);
  }
  if (!items.length) { toast('没有可学习的内容，请检查设置'); return; }

  session = {
    kind,
    queue: items,
    idx: 0,
    results: [],
    revealed: false,
    answered: false,
    startedAt: Date.now(),
    total: items.length,
  };
  $('#study').classList.add('on');
  renderCard();
}

function interleave(a, b) {
  const out = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length) out.push(a[i++]);
    if (i < a.length && j < b.length && Math.random() < 0.5) out.push(a[i++]);
    if (j < b.length) out.push(b[j++]);
  }
  return out;
}

function curItem() { return session.queue[session.idx]; }

function renderCard() {
  if (!session) return;
  if (session.idx >= session.queue.length) return finishSession();
  session.busy = false;

  const it = curItem();
  const w = WORD_MAP.get(it.id);
  const mode = S.settings.mode;
  session.revealed = false;
  session.answered = false;

  // 进度条
  const pct = Math.round(session.idx / session.queue.length * 100);
  $('#sBar').style.width = pct + '%';
  $('#sCnt').textContent = `${session.idx + 1} / ${session.queue.length}`;

  const body = $('#sBody');
  const foot = $('#sFoot');

  // 决定题型
  let qtype = 'recall';
  if (mode === 'spell') qtype = 'spell';
  else if (mode === 'recognize') qtype = 'recognize';
  else {
    // 混合：新词先用回忆卡，复习时随机测
    qtype = it.isNew ? 'recall' : (Math.random() < 0.55 ? 'recognize' : 'spell');
  }
  // 长词用选择题更友好
  if (qtype === 'spell' && w.w.length > 14) qtype = 'recognize';

  if (qtype === 'recall') {
    body.innerHTML = recallHTML(w, it);
    foot.innerHTML = `<button class="btn primary block" id="revealBtn">显示释义（空格）</button>`;
    $('#revealBtn').onclick = () => revealRecall(w, it);
    // 自动朗读
    setTimeout(() => speak(w.w), 220);
  } else if (qtype === 'recognize') {
    body.innerHTML = recognizeHTML(w);
    foot.innerHTML = '';
    bindRecognize(w, it);
  } else {
    body.innerHTML = spellHTML(w);
    foot.innerHTML = `<button class="btn primary block" id="checkBtn">提交（回车）</button>`;
    bindSpell(w, it);
    setTimeout(() => { const i = $('#spellInput'); if (i) i.focus(); }, 180);
  }
}

function recallHTML(w, it) {
  const long = w.w.length > 12 ? 'long' : '';
  const tag = it.isNew ? '<span class="hs-tag">新词</span>' : '<span class="hs-tag" style="background:var(--warn-soft);color:var(--warn)">复习</span>';
  const p = S.progress[w.id];
  const lv = p && p.wrong > 0 ? `<span class="hs-tag pos">错 ${p.wrong} 次</span>` : '';
  return `
    <div class="word-card" id="wc">
      <div class="hs">${tag}${lv}</div>
      <div class="w serif-en ${long}" style="margin-top:14px">${esc(w.w)}</div>
      <div class="ph">${esc(w.ph)}</div>
      <div class="hs" style="margin-top:14px">
        <button class="hs-tag pos" id="speakBtn" style="border:1px solid var(--line)">🔊 听发音</button>
      </div>
      <div id="ansBox"></div>
    </div>
    <div class="tap-hint" id="tapHint">先在心里回想它的意思，再点下面的按钮</div>`;
}

function revealRecall(w, it) {
  if (session.revealed) return;
  session.revealed = true;
  const box = $('#ansBox');
  if (!box) return;
  box.innerHTML = `
    <div class="ans">
      <div class="posline">${esc(w.pos)}</div>
      <div class="cn">${esc(w.cn)}</div>
      ${mnemoHTML(w)}
    </div>`;
  const hint = $('#tapHint');
  if (hint) hint.style.display = 'none';

  const foot = $('#sFoot');
  const isNew = it.isNew;
  foot.innerHTML = `
    <div class="btnrow three" style="margin-bottom:8px">
      <button class="btn" data-q="0" style="color:var(--bad);border-color:var(--bad-soft);background:var(--bad-soft)">忘了<br><span style="font-size:10px;opacity:.7">1</span></button>
      <button class="btn" data-q="1" style="color:var(--warn);border-color:var(--warn-soft);background:var(--warn-soft)">模糊<br><span style="font-size:10px;opacity:.7">2</span></button>
      <button class="btn good" data-q="2">记得<br><span style="font-size:10px;opacity:.75">3</span></button>
    </div>
    <button class="btn block ghost" id="nextBtn" style="height:40px;font-size:13px;color:var(--sub)">认识，直接下一个 ›</button>`;
  $$('#sFoot [data-q]').forEach(b => {
    b.onclick = () => answerRecall(+b.dataset.q);
  });
  $('#nextBtn').onclick = () => answerRecall(3);
}

function answerRecall(q) {
  if (!session || !session.revealed || session.busy) return;
  session.busy = true;
  haptic(q >= 2 ? 10 : 22);
  const it = curItem();
  const w = WORD_MAP.get(it.id);
  if (q >= 2 && it.isNew) {
    // 新词首次认识
    const p = getProg(w.id);
    p.s = 'learn'; p.due = Date.now() + DAY; p.ivl = 1; p.n = 1; p.right++;
    p.last = Date.now();
    p.wrong = p.wrong || 0;
    if (!todayRec().learned.includes(w.id)) todayRec().learned.push(w.id);
  } else if (q >= 2) {
    grade(w.id, 2);
  } else {
    grade(w.id, q);
  }
  recordResult(w, q, it.isNew);
  // 没记住的延后 4 个词再出现一次，避免原地循环
  if (q < 2) requeueLater(it.id);
  nextCard();
}

/* 把词插回队列：往后推 4 个位置，保证这一轮内还会再见一次 */
function requeueLater(id) {
  if (!session) return;
  // 同一个词在同一场次最多重复 3 次，避免一直答错导致学不完
  session.retry = session.retry || {};
  session.retry[id] = (session.retry[id] || 0) + 1;
  if (session.retry[id] > 3) return;
  const at = Math.min(session.queue.length, session.idx + 1 + 4);
  session.queue.splice(at, 0, { id, isNew: false });
}

function recordResult(w, q, isNew) {
  const r = todayRec();
  r.total = (r.total || 0) + 1;
  if (q >= 2) r.correct = (r.correct || 0) + 1;
  session.results.push({ id: w.id, q, isNew: !!isNew });
  save();
}

function nextCard() {
  session.idx++;
  renderCard();
}

/* --- 选择题 --- */
function recognizeHTML(w) {
  const opts = buildChoices(w);
  return `
    <div class="word-card" id="wc" style="text-align:left;padding:26px 22px">
      <div style="text-align:center">
        <div class="w serif-en ${w.w.length > 12 ? 'long' : ''}">${esc(w.w)}</div>
        <div class="ph">${esc(w.ph)}</div>
        <button class="hs-tag pos" id="speakBtn" style="margin-top:10px;border:1px solid var(--line)">🔊 听发音</button>
      </div>
      <div class="choices" id="choices">
        ${opts.map((o, i) => `<button class="choice" data-i="${i}" data-ok="${o.ok ? 1 : 0}"><span class="k">${'ABCD'[i]}</span><span>${esc(o.text)}</span></button>`).join('')}
      </div>
      <div id="ansBox"></div>
    </div>
    <div class="tap-hint">选出正确的中文释义</div>`;
}

function buildChoices(w) {
  const correct = w.cn;
  const pool = WORDS.filter(x => x.id !== w.id && x.cn !== correct && Math.abs(x.w.length - w.w.length) < 8);
  const picks = shuffle(pool).slice(0, 11);
  // 同词性的优先干扰
  const samePos = picks.filter(x => x.pos.split(',')[0].trim() === w.pos.split(',')[0].trim());
  const others = picks.filter(x => !samePos.includes(x));
  const distract = [...samePos.slice(0, 2), ...others].slice(0, 3);
  const opts = shuffle([{ text: correct, ok: true }, ...distract.map(d => ({ text: d.cn, ok: false }))]);
  return opts;
}

function bindRecognize(w, it) {
  const sp = $('#speakBtn');
  if (sp) sp.onclick = () => { const a = S.settings.autoSpeak; S.settings.autoSpeak = true; speak(w.w); S.settings.autoSpeak = a; };
  let done = false;
  $$('#choices .choice').forEach(b => {
    b.onclick = () => {
      if (done) return;
      done = true;
      const ok = b.dataset.ok === '1';
      if (ok) {
        b.classList.add('right');
        if (it.isNew) {
          const p = getProg(w.id);
          p.s = 'learn'; p.due = Date.now() + DAY; p.ivl = 1; p.n = 1; p.right++; p.last = Date.now();
          if (!todayRec().learned.includes(w.id)) todayRec().learned.push(w.id);
        } else grade(w.id, 2);
        recordResult(w, 2, it.isNew);
        setTimeout(() => nextCard(), 620);
      } else {
        b.classList.add('wrong');
        $$('#choices .choice').forEach(x => { if (x.dataset.ok === '1') x.classList.add('right'); });
        if (it.isNew) {
          const p = getProg(w.id);
          // 先见第一面：进入学习中，但不计入"今日已学"，要看它第二次是否还记得
          p.s = 'learn'; p.wrong++; p.due = Date.now() + DAY; p.ivl = 1; p.last = Date.now();
          if (!todayRec().learned.includes(w.id)) todayRec().learned.push(w.id);
        } else grade(w.id, 0);
        recordResult(w, 0, it.isNew);
        requeueLater(w.id);
        $('#ansBox').innerHTML = `<div class="mnemo"><div class="h">正确释义</div><div class="body"><b>${esc(w.cn)}</b>　<span style="color:var(--sub);font-size:12px">这个词稍后会再出现一次</span></div></div>`;
        setTimeout(() => nextCard(), 1500);
      }
    };
  });
}

/* --- 拼写 --- */
function spellHTML(w) {
  const cn = w.cn;
  const firstName = cn.split('；')[0];
  const hint = w.w.length > 7 ? maskWord(w.w) : '';
  return `
    <div class="word-card" id="wc" style="text-align:left;padding:26px 22px">
      <div style="text-align:center">
        <div style="font-size:12px;font-weight:800;color:var(--sub);letter-spacing:1px">看中文，拼出单词</div>
        <div style="font-size:22px;font-weight:800;margin-top:12px;line-height:1.5">${esc(firstName)}</div>
        <div style="font-size:13px;color:var(--sub);margin-top:6px">${esc(w.pos)}</div>
      </div>
      <div class="spell"><input id="spellInput" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="输入英文单词"></div>
      <div class="slots" id="slots">${hint ? hint.split('').map(c => `<span class="${c === '_' ? '' : 'show'}">${c === '_' ? '' : c}</span>`).join('') : ''}</div>
      <div id="ansBox"></div>
    </div>
    <div class="tap-hint">拼不出来？点"看答案"也算学习</div>`;
}

function maskWord(w) {
  // 显示首字母 + 末字母，中间下划线
  return w.split('').map((c, i) => {
    if (!/[a-zA-Z]/.test(c)) return c;
    if (i === 0 || i === w.length - 1) return c;
    return '_';
  }).join('');
}

function bindSpell(w, it) {
  const input = $('#spellInput');
  const check = () => {
    if (!session.answered) return;
    const val = (input.value || '').trim().toLowerCase();
    if (!val) return;
    session.answered = false;
    const ok = val === w.w.toLowerCase();
    if (ok) {
      input.style.borderColor = 'var(--good)';
      input.style.color = 'var(--good)';
      if (it.isNew) {
        const p = getProg(w.id);
        p.s = 'learn'; p.due = Date.now() + DAY; p.ivl = 1; p.n = 1; p.right++; p.last = Date.now();
        if (!todayRec().learned.includes(w.id)) todayRec().learned.push(w.id);
      } else grade(w.id, 3);
      recordResult(w, 3, it.isNew);
      $('#sFoot').innerHTML = `<button class="btn good block">拼对了 ✓</button>`;
      setTimeout(() => nextCard(), 520);
    } else {
      input.style.borderColor = 'var(--bad)';
      input.style.color = 'var(--bad)';
      const p = getProg(w.id);
      if (it.isNew) {
        p.s = 'learn'; p.wrong++; p.due = Date.now() + DAY; p.ivl = 1; p.last = Date.now();
        if (!todayRec().learned.includes(w.id)) todayRec().learned.push(w.id);
      } else grade(w.id, 0);
      recordResult(w, 0, it.isNew);
      requeueLater(w.id);
      $('#ansBox').innerHTML = `<div class="mnemo"><div class="h">正确拼写</div><div class="body" style="border-color:var(--bad)"><b style="color:var(--bad);font-size:20px">${esc(w.w)}</b>　<span style="font-size:12px;color:var(--sub)">${esc(w.ph)}</span><br><span style="font-size:13px">${esc(w.cn)}</span></div></div>`;
      $('#sFoot').innerHTML = `<button class="btn block" id="continueBtn" style="background:var(--bad-soft);color:var(--bad);border-color:transparent">记住了，继续（回车）</button>`;
      $('#continueBtn').onclick = () => nextCard();
      speak(w.w);
      setTimeout(() => { const b = $('#continueBtn'); }, 100);
    }
  };
  session.answered = true;
  const btn = $('#checkBtn');
  if (btn) btn.onclick = check;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if ($('#continueBtn')) $('#continueBtn').click();
      else check();
    }
  });
  input.addEventListener('input', () => {
    input.style.borderColor = 'var(--line)';
    input.style.color = 'var(--text)';
  });
}

/* --- 会话结束 --- */
function finishSession() {
  const res = session.results;
  const total = res.length;
  const right = res.filter(r => r.q >= 2).length;
  const acc = total ? Math.round(right / total * 100) : 0;
  const avg = total ? res.reduce((s, r) => s + (r.q >= 2 ? (r.q === 3 ? 100 : 80) : r.q === 1 ? 50 : 15), 0) / total : 0;

  const r = todayRec();
  r.done = r.learned.length >= S.settings.dailyGoal;
  r.reviewed += res.filter(x => !x.isNew).length;
  saveNow();

  const worth = res.filter(x => x.q < 2 || x.isNew);
  const C = 2 * Math.PI * 66;
  const pctVal = Math.min(100, Math.round(avg));

  $('#sBody').innerHTML = '';
  $('#sFoot').innerHTML = '';
  $('#study').classList.remove('on');
  showDone({ total, right, acc, pct: acc, results: res, kind: session.kind });
  session = null;
}

function showDone(d) {
  const el = $('#done');
  const C = 2 * Math.PI * 66;
  const r = todayRec();
  const goal = S.settings.dailyGoal;
  const newlyDone = r.done;

  const wrongList = d.results.filter(x => x.q < 2);
  const newList = d.results.filter(x => x.isNew && x.q >= 2);

  el.innerHTML = `
    <div class="done-inner">
      <div class="done-ring">
        <svg width="150" height="150" viewBox="0 0 150 150">
          <circle cx="75" cy="75" r="66" fill="none" stroke="var(--card2)" stroke-width="12"/>
          <circle cx="75" cy="75" r="66" fill="none" stroke="url(#gd)" stroke-width="12" stroke-linecap="round"
            stroke-dasharray="${C * d.pct / 100} ${C}"/>
          <defs><linearGradient id="gd" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="var(--brand)"/><stop offset="100%" stop-color="var(--brand2)"/>
          </linearGradient></defs>
        </svg>
        <div class="c"><b>${d.acc}%</b><s>正确率</s></div>
      </div>
      <div style="font-size:22px;font-weight:800;letter-spacing:-.3px">${
        d.acc >= 90 ? '太稳了，状态极佳' : d.acc >= 70 ? '不错，继续保持' : '有难度，明天再来一遍'
      }</div>
      <div style="color:var(--sub);font-size:14px;margin-top:6px">
        正确 ${d.right} / ${d.total}　·　正确率 ${d.acc}%
      </div>
      ${newlyDone ? `<div class="tipbox" style="justify-content:center;background:var(--good-soft);color:var(--good);margin-top:16px;font-weight:700">✓ 今日打卡完成，连续 ${calcStreak()} 天</div>` : `<div class="tipbox" style="margin-top:16px"><span class="e">🎯</span><span>今日已学 ${r.learned.length}/${goal}，再来 ${Math.max(0, goal - r.learned.length)} 个就打卡成功了</span></div>`}

      ${wrongList.length ? `
      <div class="done-list">
        <div class="sec-title" style="margin-left:2px">这次没记住的（${wrongList.length}）· 已加入复习</div>
        ${wrongList.map(x => {
          const w = WORD_MAP.get(x.id);
          return `<div class="mini-word"><span class="w">${esc(w.w)}</span><span class="c">${esc(w.cn)}</span><span class="b bad">复习</span></div>`;
        }).join('')}
      </div>` : ''}

      ${newList.length ? `
      <div class="done-list">
        <div class="sec-title" style="margin-left:2px">新学的（${newList.length}）</div>
        ${newList.slice(0, 12).map(x => {
          const w = WORD_MAP.get(x.id);
          return `<div class="mini-word"><span class="w">${esc(w.w)}</span><span class="c">${esc(w.cn)}</span></div>`;
        }).join('')}
        ${newList.length > 12 ? `<div style="text-align:center;color:var(--sub);font-size:12px;padding:6px">… 还有 ${newList.length - 12} 个</div>` : ''}
      </div>` : ''}

      <div style="margin-top:24px;display:grid;gap:10px">
        ${wrongList.length ? `<button class="btn primary block" id="againBtn">马上再练一遍错的（${wrongList.length}）</button>` : ''}
        <button class="btn block ghost" id="closeDone" style="border:1px solid var(--line)">回到首页</button>
      </div>
    </div>`;

  el.classList.add('on');
  if (wrongList.length) {
    $('#againBtn').onclick = () => {
      el.classList.remove('on');
      session = {
        kind: 'review',
        queue: shuffle(wrongList.map(x => ({ id: x.id, isNew: false }))),
        idx: 0, results: [], total: wrongList.length, startedAt: Date.now(),
      };
      $('#study').classList.add('on');
      renderCard();
    };
  }
  $('#closeDone').onclick = () => {
    el.classList.remove('on');
    go('home');
  };
}

function closeStudy() {
  if (session && session.idx > 0) {
    if (!confirm('退出这次学习？已学的进度会保存。')) return;
  }
  session = null;
  $('#study').classList.remove('on');
  go('home');
}

/* ---------- 统计页 ---------- */
function renderStats() {
  const total = WORDS.length;
  const learned = learnedCount();
  const master = masterCount();
  const due = dueWords().length;
  const wrongList = Object.entries(S.progress)
    .filter(([id, p]) => p.wrong > 0)
    .sort((a, b) => b[1].wrong - a[1].wrong)
    .slice(0, 30);

  // 近 7 天
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY);
    const k = dayOf(d.getTime());
    const rec = S.days[k];
    days.push({
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      n: rec ? rec.learned.length + Math.min(rec.reviewed, 99) : 0,
      learned: rec ? rec.learned.length : 0,
    });
  }
  const maxN = Math.max(10, ...days.map(d => d.n));

  const totalDays = Object.values(S.days).filter(d => d.done).length;
  const sumLearn = Object.values(S.days).reduce((s, d) => s + d.learned.length, 0);
  const sumReview = Object.values(S.days).reduce((s, d) => s + (d.reviewed || 0), 0);
  const accAll = (() => {
    let t = 0, c = 0;
    Object.values(S.days).forEach(d => { t += d.total || 0; c += d.correct || 0; });
    return t ? Math.round(c / t * 100) : 0;
  })();

  $('#statsBody').innerHTML = `
    <div class="stats">
      <div class="stat"><div class="n">${totalDays}</div><div class="t">打卡天数</div></div>
      <div class="stat"><div class="n">${sumLearn}</div><div class="t">累计新学</div></div>
      <div class="stat"><div class="n">${accAll}%</div><div class="t">平均正确率</div></div>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <div style="font-weight:800">最近 7 天</div>
        <div style="font-size:12px;color:var(--sub)">每天接触的单词数</div>
      </div>
      <div style="display:flex;align-items:flex-end;gap:8px;height:120px;margin-top:16px;border-bottom:1px solid var(--line);padding-bottom:2px">
        ${days.map(d => `
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;height:100%;justify-content:flex-end">
            <div style="font-size:11px;font-weight:800;color:${d.n ? 'var(--brand)' : 'transparent'}">${d.n || 0}</div>
            <div style="width:100%;max-width:30px;height:${d.n ? Math.max(10, d.n / maxN * 88) : 3}px;border-radius:7px 7px 2px 2px;background:linear-gradient(180deg,var(--brand),var(--brand2));opacity:${d.n ? 1 : .18}"></div>
          </div>`).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:6px">
        ${days.map(d => `<div style="flex:1;text-align:center;font-size:10px;color:${d.label === (new Date().getMonth() + 1) + '/' + new Date().getDate() ? 'var(--brand);font-weight:800' : 'var(--sub)'}">${d.label}</div>`).join('')}
      </div>
    </div>

    <div class="card">
      <div style="font-weight:800;margin-bottom:14px">词库进度</div>
      ${progressRow('已掌握', master, total, 'var(--good)')}
      ${progressRow('学习中', learned - master, total, 'var(--warn)')}
      ${progressRow('未学习', total - learned, total, 'var(--line)')}
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:6px;font-size:12px;color:var(--sub)">
        <span>总词数 <b style="color:var(--text)">${total}</b></span>
        <span>今日待复习 <b style="color:var(--brand)">${due}</b></span>
        <span>累计复习 <b style="color:var(--text)">${sumReview}</b></span>
      </div>
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="font-weight:800">错词本</div>
        <div style="font-size:12px;color:var(--sub)">${wrongList.length} 个</div>
      </div>
      <div style="color:var(--sub);font-size:12.5px;margin-top:6px;line-height:1.6">答错或标记"忘了"的词会自动进入这里，并按记忆曲线安排复习。</div>
      <div style="margin-top:14px">
        ${wrongList.length ? wrongList.slice(0, 12).map(([id, p]) => {
          const w = WORD_MAP.get(+id);
          return `<div class="mini-word" data-wid="${id}" style="cursor:pointer">
            <span class="w">${esc(w.w)}</span>
            <span class="c">${esc(w.cn)}</span>
            <span class="b bad">错${p.wrong}</span>
          </div>`;
        }).join('') : `<div class="empty" style="padding:20px"><div class="big">🌱</div>还没有错词，继续保持</div>`}
      </div>
      ${wrongList.length ? `<button class="btn block" id="drillWrong" style="margin-top:8px">专项攻克这些错词</button>` : ''}
    </div>`;

  if (wrongList.length) {
    $('#drillWrong').onclick = () => {
      session = {
        kind: 'review',
        queue: shuffle(wrongList.map(([id]) => ({ id: +id, isNew: false }))),
        idx: 0, results: [], total: wrongList.length, startedAt: Date.now(),
      };
      $('#study').classList.add('on');
      renderCard();
    };
    $$('#statsBody .mini-word[data-wid]').forEach(el => {
      el.onclick = () => openWordDetail(+el.dataset.wid);
    });
  }
}

function progressRow(label, n, total, color) {
  const pct = total ? (n / total * 100) : 0;
  return `<div style="margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px">
      <span style="font-weight:600">${label}</span><span style="color:var(--sub);font-weight:700">${n}</span>
    </div>
    <div class="goalbar" style="margin-top:0"><i style="width:${pct}%;background:${color}"></i></div>
  </div>`;
}

/* ---------- 词库页 ---------- */
let libFilter = 'all';
let libQuery = '';
let libLimit = 60;

function renderLib() {
  let list = WORDS;
  if (libFilter === 'new') list = list.filter(w => !S.progress[w.id] || S.progress[w.id].s === 'new');
  else if (libFilter === 'learn') list = list.filter(w => S.progress[w.id] && S.progress[w.id].s === 'learn');
  else if (libFilter === 'master') list = list.filter(w => S.progress[w.id] && S.progress[w.id].s === 'master');
  else if (libFilter === 'wrong') list = list.filter(w => S.progress[w.id] && S.progress[w.id].wrong > 0);
  else if (libFilter === 'star') list = list.filter(w => S.stars.includes(w.id));

  if (libQuery.trim()) {
    const q = libQuery.trim().toLowerCase();
    list = list.filter(w => w.w.toLowerCase().includes(q) || w.cn.includes(q));
  }

  const shown = list.slice(0, libLimit);
  $('#libCount').textContent = `${list.length} 个词`;
  $('#libBody').innerHTML = shown.length ? shown.map(w => {
    const p = S.progress[w.id];
    const st = !p || p.s === 'new' ? 'new' : p.s;
    const star = S.stars.includes(w.id);
    return `<div class="wrow" data-wid="${w.id}">
      <div class="lv ${st}"></div>
      <div style="flex:1;min-width:0">
        <div class="b1 serif-en">${esc(w.w)} <span style="font-weight:400;color:var(--sub);font-size:12px">${esc(w.ph)}</span></div>
        <div class="b2">${esc(w.cn)}</div>
      </div>
      <button class="star ${star ? 'on' : ''}" data-star="${w.id}">${star ? '★' : '☆'}</button>
    </div>`;
  }).join('') : `<div class="empty"><div class="big">🔍</div>没有找到符合条件的单词</div>`;

  if (list.length > shown.length) {
    $('#libBody').innerHTML += `<button class="btn block ghost" id="moreBtn" style="border:1px solid var(--line)">加载更多（还有 ${list.length - shown.length} 个）</button>`;
    $('#moreBtn').onclick = () => { libLimit += 80; renderLib(); };
  }

  $$('#libBody .wrow').forEach(el => {
    el.onclick = e => {
      if (e.target.dataset.star) return;
      openWordDetail(+el.dataset.wid);
    };
  });
  $$('#libBody [data-star]').forEach(b => {
    b.onclick = e => {
      e.stopPropagation();
      const id = +b.dataset.star;
      const i = S.stars.indexOf(id);
      if (i >= 0) S.stars.splice(i, 1); else S.stars.push(id);
      saveNow(); renderLib();
    };
  });
}

/* ---------- 单词详情 ---------- */
function openWordDetail(id) {
  const w = WORD_MAP.get(id);
  const p = S.progress[id];
  const star = S.stars.includes(id);
  $('#done').innerHTML = `
    <div class="done-inner" style="text-align:left;padding-top:24px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
        <button class="icon-btn" id="dBack">‹</button>
        <button class="icon-btn" id="dStar" style="color:${star ? 'var(--warn)' : 'var(--sub)'}">${star ? '★' : '☆'}</button>
      </div>
      <div class="card" style="text-align:center;padding:30px 20px">
        <div class="w serif-en ${w.w.length > 12 ? 'long' : ''}" style="font-size:34px;font-weight:800">${esc(w.w)}</div>
        <div class="ph" style="margin-top:8px;color:var(--sub);font-size:14px">${esc(w.ph)}</div>
        <button class="btn" id="dSpeak" style="margin-top:14px;height:40px;font-size:13px;background:var(--brand-soft);color:var(--brand);border:0">🔊 朗读</button>
        <div style="margin-top:18px;padding-top:16px;border-top:1px dashed var(--line);text-align:left">
          <div style="font-size:12px;color:var(--sub);font-weight:700;margin-bottom:5px">${esc(w.pos)}</div>
          <div style="font-size:17px;font-weight:700;line-height:1.65">${esc(w.cn)}</div>
          ${mnemoHTML(w)}
        </div>
      </div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px">
          <span style="font-weight:700">记忆强度</span>
          <span style="color:var(--sub)">${p ? (p.s === 'master' ? '已掌握' : '学习中') : '未学习'}</span>
        </div>
        ${p ? `<div style="font-size:12.5px;color:var(--sub);line-height:1.9">
          · 复习间隔：${p.ivl || 0} 天<br>
          · 下次复习：${p.due ? (p.due <= Date.now() ? '现在' : new Date(p.due).toLocaleDateString('zh-CN')) : '—'}<br>
          · 答对 ${p.right} 次 / 答错 ${p.wrong} 次<br>
          · 出自原书第 ${w.p - 1} 页
        </div>` : `<div style="font-size:12.5px;color:var(--sub)">还没学过这个词，出自原书第 ${w.p - 1} 页</div>`}
      </div>
      <div class="btnrow">
        <button class="btn" id="dKnow" style="color:var(--good);background:var(--good-soft);border-color:transparent">标记已掌握</button>
        <button class="btn" id="dAgain" style="color:var(--warn);background:var(--warn-soft);border-color:transparent">加入复习</button>
      </div>
    </div>`;
  $('#done').classList.add('on');
  $('#dBack').onclick = () => { $('#done').classList.remove('on'); };
  $('#dSpeak').onclick = () => { const a = S.settings.autoSpeak; S.settings.autoSpeak = true; speak(w.w); S.settings.autoSpeak = a; };
  $('#dStar').onclick = () => {
    const i = S.stars.indexOf(id);
    if (i >= 0) S.stars.splice(i, 1); else S.stars.push(id);
    saveNow(); openWordDetail(id);
  };
  $('#dKnow').onclick = () => { markKnown(id); toast('已标记为掌握'); $('#done').classList.remove('on'); if (curPage === 'lib') renderLib(); };
  $('#dAgain').onclick = () => {
    const p2 = getProg(id); p2.due = Date.now(); p2.s = p2.s === 'new' ? 'learn' : p2.s; saveNow();
    toast('已加入复习队列'); $('#done').classList.remove('on');
  };
}

/* ---------- 我的/设置 ---------- */
const ICON = {
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 20h16"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg>',
};

function renderMe() {
  const st = S.settings;
  $('#meBody').innerHTML = `
    <div class="card">
      <div class="setting-row">
        <div class="t"><div class="t1">每日新词量</div><div class="t2">每天要学多少个新词</div></div>
        <div class="stepper">
          <button data-step="-5">−</button><div class="v" id="goalV">${st.dailyGoal}</div><button data-step="5">+</button>
        </div>
      </div>
      <div class="setting-row">
        <div class="t"><div class="t1">学习方式</div><div class="t2">${st.mode === 'mixed' ? '回忆卡 + 选择题 + 拼写，自动混合' : st.mode === 'recognize' ? '只做选择题，轻松快速' : '主要用拼写，记得更牢'}</div></div>
        <div class="seg">
          <button data-mode="mixed" class="${st.mode === 'mixed' ? 'on' : ''}">混合</button>
          <button data-mode="recognize" class="${st.mode === 'recognize' ? 'on' : ''}">选择</button>
          <button data-mode="spell" class="${st.mode === 'spell' ? 'on' : ''}">拼写</button>
        </div>
      </div>
      <div class="setting-row">
        <div class="t"><div class="t1">自动发音</div><div class="t2">显示单词时朗读（需系统语音）</div></div>
        <div class="switch ${st.autoSpeak ? 'on' : ''}" data-sw="speak"></div>
      </div>
      <div class="setting-row">
        <div class="t"><div class="t1">深色模式</div><div class="t2">晚上背单词不刺眼</div></div>
        <div class="switch ${st.dark ? 'on' : ''}" data-sw="dark"></div>
      </div>
      <div class="setting-row">
        <div class="t"><div class="t1">每日复习上限</div><div class="t2">到期复习词最多推送 ${st.reviewCap} 个</div></div>
        <div class="stepper">
          <button data-stepr="-10">−</button><div class="v" id="capV">${st.reviewCap}</div><button data-stepr="10">+</button>
        </div>
      </div>
    </div>

    <div class="sec-title">数据</div>
    <div class="card tight">
      <div class="item" id="exportBtn"><div class="ic">${ICON.down}</div><div class="txt"><div class="t1">导出学习记录</div><div class="t2">备份成 JSON 文件，换设备可导入</div></div><div class="go">›</div></div>
      <div class="item" id="importBtn"><div class="ic">${ICON.up}</div><div class="txt"><div class="t1">导入学习记录</div><div class="t2">从备份文件恢复进度</div></div><div class="go">›</div></div>
      <input type="file" id="fileInput" accept=".json" style="display:none">
      <div class="item" id="resetBtn"><div class="ic" style="background:var(--bad-soft);color:var(--bad)">${ICON.trash}</div><div class="txt"><div class="t1" style="color:var(--bad)">清空所有进度</div><div class="t2">不可恢复，请先导出备份</div></div><div class="go">›</div></div>
    </div>

    <div class="sec-title">关于</div>
    <div class="card">
      <div style="font-weight:800;font-size:15px">晓艳四级高频词 · 每日打卡</div>
      <div style="font-size:12.5px;color:var(--sub);line-height:1.8;margin-top:8px">
        词库整理自《晓艳带你学英语·四级高频单词》，共 ${WORDS.length} 个高频词，按原书单元顺序排列。<br>
        复习节奏采用间隔重复算法（SM-2 简化版）：答错的词会更快回到你面前，答对的词间隔逐渐拉长，把时间花在真正不熟的词上。<br>
        所有数据只保存在本机浏览器，不会上传。
      </div>
    </div>
    <div style="text-align:center;color:var(--sub);font-size:11.5px;padding:14px 0 4px">建议每天固定一个时间打开，坚持比时长更重要</div>
  `;

  $$('#meBody [data-step]').forEach(b => {
    b.onclick = () => {
      let v = st.dailyGoal + (+b.dataset.step);
      v = Math.max(5, Math.min(200, v));
      st.dailyGoal = v; $('#goalV').textContent = v; saveNow(); renderHome();
    };
  });
  $$('#meBody [data-stepr]').forEach(b => {
    b.onclick = () => {
      let v = st.reviewCap + (+b.dataset.stepr);
      v = Math.max(10, Math.min(200, v));
      st.reviewCap = v; $('#capV').textContent = v; saveNow();
    };
  });
  $$('#meBody [data-mode]').forEach(b => {
    b.onclick = () => { st.mode = b.dataset.mode; saveNow(); renderMe(); };
  });
  $$('#meBody [data-sw]').forEach(b => {
    b.onclick = () => {
      const k = b.dataset.sw;
      if (k === 'speak') { st.autoSpeak = !st.autoSpeak; b.classList.toggle('on', st.autoSpeak); }
      if (k === 'dark') { st.dark = !st.dark; b.classList.toggle('on', st.dark); applyTheme(); }
      saveNow();
    };
  });
  $('#exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `背单词记录_${today()}.json`;
    a.click();
    toast('已导出');
  };
  $('#importBtn').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(rd.result);
        if (!d.progress || !d.days) throw 0;
        S = Object.assign(structuredClone(DEFAULT_STATE), d, {
          settings: Object.assign({}, DEFAULT_STATE.settings, d.settings || {}),
        });
        saveNow(); applyTheme(); toast('导入成功'); go('home');
      } catch (err) { toast('文件格式不正确'); }
    };
    rd.readAsText(f);
  };
  $('#resetBtn').onclick = () => {
    if (!confirm('确定清空所有学习进度？此操作不可恢复。\n建议先导出备份。')) return;
    if (!confirm('再确认一次：清空后所有打卡记录和记忆曲线都会丢失。')) return;
    S = structuredClone(DEFAULT_STATE);
    saveNow(); applyTheme(); toast('已清空'); go('home');
  };
}

/* ---------- 主题 ---------- */
function applyTheme() {
  document.documentElement.dataset.theme = S.settings.dark ? 'dark' : 'light';
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.content = S.settings.dark ? '#0f1420' : '#f4f6fb';
}

/* ---------- 初始化 ---------- */
function init() {
  applyTheme();
  // 事件
  $$('.tab').forEach(t => t.onclick = () => go(t.dataset.tab));
  $('#startBtn').onclick = () => startSession('daily');
  $('#reviewBtn').onclick = () => startSession('review');
  $('#newBtn').onclick = () => startSession('new');
  $('#sClose').onclick = closeStudy;
  $('#sSpeak').onclick = () => { if (session) { const w = WORD_MAP.get(curItem().id); const a = S.settings.autoSpeak; S.settings.autoSpeak = true; speak(w.w); S.settings.autoSpeak = a; } };

  $$('#libFilter button').forEach(b => {
    b.onclick = () => {
      libFilter = b.dataset.f; libLimit = 60;
      $$('#libFilter button').forEach(x => x.classList.toggle('on', x === b));
      renderLib();
    };
  });
  const si = $('#libSearch');
  si.addEventListener('input', () => { libQuery = si.value; libLimit = 60; renderLib(); });

  // 键盘
  document.addEventListener('keydown', e => {
    if (!$('#study').classList.contains('on')) return;
    if (e.target.tagName === 'INPUT') return;
    if (!session) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!session.revealed) { const b = $('#revealBtn'); if (b) b.click(); }
      else { const b = $('#sFoot [data-q="2"]'); if (b) b.click(); }
    }
    if (['1', '2', '3'].includes(e.key) && session.revealed) {
      const b = $(`#sFoot [data-q="${+e.key - 1}"]`);
      if (b) b.click();
    }
  });

  // 事件委托：练习中的选择、朗读
  document.addEventListener('click', e => {
    if (e.target.id === 'speakBtn') {
      const it = session && curItem();
      if (it) { const w = WORD_MAP.get(it.id); const a = S.settings.autoSpeak; S.settings.autoSpeak = true; speak(w.w); S.settings.autoSpeak = a; }
    }
  });

  go('home');
  // 每日首次打开提示
  const t = today();
  if (S.lastDay !== t) { S.lastDay = t; saveNow(); }
}

document.addEventListener('DOMContentLoaded', init);
