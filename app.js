/**
 * 트래블로그 환율·정산 PWA UI. 빌드 없이 브라우저 ES module 로 바로 실행.
 * 상태는 store.js(localStorage), 계산은 calc.js, 환율 로딩은 rates.js.
 */
import { CURRENCIES, currencyInfo, findCurrency, searchCurrencies, countryOf } from './currencies.js';
import { loadHistory, hasHistory, sliceYears, summarize, chartModel, ECB_CODES, PEGS } from './history.js';
import { krwPerUnit, settle, fmt, refundLoss, RateMissingError, payMethod, cashBalances, groupByDay, localDay, withDay, duplicateGroups, defaultEntryPay } from './calc.js';
import { loadState, saveState, exportJson, importJson, defaultState } from './store.js';
import { loadRates, hoursOld, sourceLabel } from './rates.js';
import { parseLedger, decodeImport, encodeImport } from './importer.js';
import { metaOf, buildPush, applyRemote, callSync, newRoomCode, normalizeCode } from './sync.js';

const logger = {
  /** @param {...unknown} a */ info: (...a) => console.info('[travlog]', ...a),
  /** @param {...unknown} a */ warn: (...a) => console.warn('[travlog]', ...a),
  /** @param {...unknown} a */ error: (...a) => console.error('[travlog]', ...a),
};

const BUILD = '__BUILD__';
const state = loadState();
/** @type {object|null} */
let rates = state.ratesCache || null;
/** @type {string[]} */
let rateLog = [];
let lastRefreshAt = 0;
let refreshing = false;
const STARTED_AT = Date.now();
// 저장본에 9.2 고정값이 방금 들어갔으면 예전 MAD 항목도 그 값으로 다시 계산(환율 캐시가 없으면 다음 실행에서)
if (!state.migrated.mad92Items) {
  let n = 0;
  for (const c of Object.keys(state.manual.usdCross)) n += resnapshotItems(c);
  if (rates) { state.migrated.mad92Items = true; saveState(state); }
  if (n) console.info('[travlog] 고정 교차환율로 내역', n, '건 다시 계산');
}
/**
 * 환율 탭 기본 통화: 지금 여행의 통화(중국 여행이면 CNY). 원화 여행이거나 모르는 코드면 마지막에 고른 칩.
 * @returns {string}
 */
function tripFxCode() {
  const c = activeTrip()?.code;
  return c && c !== 'KRW' && findCurrency(c) === c ? c : (state.ui.code || 'MAD');
}

/**
 * 여행 통화가 바뀌었을 때(동기화·설정) 아직 아무것도 안 친 입력칸만 새 통화로 따라가게.
 * @param {string} prev 바뀌기 전 여행 통화
 */
function followTripCurrency(prev) {
  const now = activeTrip().code;
  if (now === prev) return;
  if (!fx.input && !fx.terms.length && fx.code === prev) fx.code = tripFxCode();
  if (!editingId && !draft.amount && !draft.desc && (draft.code === prev || !draft.code)) draft.code = now;
}

// terms: '+' 로 확정한 금액들. 변환은 항상 terms 합 + 지금 입력 중인 값(total) 기준
// 새로고침하면 여행 통화부터(Chan 2026-10-03: 중국 여행 중 USD 로 뜨던 문제)
// prev: 전에 보던 통화들(오래된 것 → 최근). 보던 통화를 버튼에서 빼면 여기서 돌아갈 곳을 찾음
const fx = { input: '', code: tripFxCode(), terms: /** @type {number[]} */ ([]), prev: /** @type {string[]} */ ([]) };

/**
 * 환율 탭 통화 바꾸기. 통화가 바뀌면 입력값은 0부터(49 MAD 를 보다가 USD 를 누르면 49 USD 가 남지 않게).
 * @param {string} c 새 통화
 */
function setFxCode(c) {
  if (fx.code !== c) {
    fx.input = ''; fx.terms = [];
    fx.prev = [...fx.prev.filter((x) => x !== fx.code && x !== c), fx.code].slice(-10);
  }
  fx.code = c; state.ui.code = c;
}

/** @returns {string[]} 환율 탭 버튼 줄에 늘 있는 통화: 지금 여행 통화 + 내 통화 */
function fxChipCodes() {
  return [activeTrip().code, ...state.favorites].filter((c, i, a) => c && a.indexOf(c) === i);
}

/**
 * 보던 통화를 버튼에서 뺐을 때 돌아갈 통화. 바로 전에 보던 것 중 버튼에 남은 것 → 여행 통화 → 첫 버튼.
 * @param {string} removed 뺀 통화
 * @returns {string}
 */
function fallbackFxCode(removed) {
  const shown = fxChipCodes().filter((c) => c !== removed);
  for (let i = fx.prev.length - 1; i >= 0; i -= 1) if (shown.includes(fx.prev[i])) return fx.prev[i];
  const trip = tripFxCode();
  if (shown.includes(trip)) return trip;
  return shown.find((c) => c !== 'KRW') || shown[0] || 'USD';
}

/** @returns {number} 키패드 총합 */
function fxTotal() { return fx.terms.reduce((a, b) => a + b, 0) + parseAmount(fx.input); }
/** @type {any} */
let installEvt = null;
/** @type {string|null} */
let editingId = null;
// date: '' 이면 오늘(저장 시각). 'YYYY-MM-DD' 면 그 날짜로
let draft = { payer: state.people[0], desc: '', amount: '', code: '', forWho: '', pay: '', date: '' };
/** @type {{text:string, items:any[], skipped:string[], warnings:string[]}|null} */
let pasteBox = null;
/** 중복 확인 창: null 이면 닫힘. keep = 남길 항목 id */
let dedupe = null;

const view = /** @type {HTMLElement} */ (document.getElementById('view'));
const tabs = /** @type {HTMLElement} */ (document.getElementById('tabs'));
const titleEl = /** @type {HTMLElement} */ (document.getElementById('title'));
const badgeEl = /** @type {HTMLElement} */ (document.getElementById('rate-badge'));
const toastEl = /** @type {HTMLElement} */ (document.getElementById('toast'));
const sheetEl = /** @type {HTMLElement} */ (document.getElementById('sheet'));
/**
 * 아래에서 올라오는 창. 통화 찾기·편집 또는 원화 대비 차트.
 * @type {null | {type:'cur', q:string} | {type:'chart', code:string, years:number, status:'loading'|'ok'|'none'|'error', points:Array<[string, number]>|null, fromCache:boolean, peg:[string, number]|null, error:string, idx:number}}
 */
let sheet = null;

/**
 * 트래블로그 앱 값이 아직 유효한지. 입력한 날보다 새 고시일이 나오면 만료(그날 환율은 새 고시를 따름).
 * @returns {boolean}
 */
function travlogActive() {
  const t = state.travlog;
  if (!t || !t.at || !Object.keys(t.rates || {}).length) return false;
  const newer = rates?.baseDate && rates.baseDate > t.at;
  const tooOld = Date.now() - Date.parse(t.at) > 7 * 86400e3;
  return !newer && !tooOld;
}

/** @returns {string} YYYY-MM-DD (폰 시간 기준) */
function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** @returns {{rates:object|null, manual:object}} */
function ctx() {
  return { rates, manual: { ...state.manual, travlog: travlogActive() ? state.travlog.rates : {} } };
}
let lastMetaSig = JSON.stringify(metaOf(state));
function persist() {
  const sig = JSON.stringify(metaOf(state));
  if (sig !== lastMetaSig) { state.sync.metaRev = Date.now(); lastMetaSig = sig; }
  if (!saveState(state)) logger.warn('localStorage 저장 실패');
  if (state.sync.code) scheduleSync();
}

/**
 * 항목을 고쳤을 때 호출: 수정 시각(rev)과 아직 안 올라감(dirty) 표시.
 * @param {object} it
 */
function touch(it) { it.rev = Date.now(); it.dirty = true; }

/**
 * 항목을 지울 때: 목록에서 빼고 삭제 기록을 남김(상대 폰에도 지워지게).
 * @param {object} trip
 * @param {(it:object) => boolean} pred 지울 조건
 * @returns {number}
 */
function removeItems(trip, pred) {
  const now = Date.now();
  const gone = trip.items.filter(pred);
  trip.items = trip.items.filter((it) => !pred(it));
  if (state.sync.code) for (const it of gone) state.tombstones.push({ id: it.id, rev: now });
  if (state.tombstones.length > 2000) state.tombstones = state.tombstones.slice(-2000);
  return gone.length;
}

/* ───────────── 동기화 ───────────── */
let syncTimer = 0;
let syncRunning = false;
let syncAgain = false;
let syncError = '';

/** 저장 뒤 2초 안에 몰아서 한 번 */
function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => { syncNow().catch(() => {}); }, 2000);
}

/**
 * 서버와 한 번 맞춤. 올릴 것(dirty·삭제)을 보내고 방 전체를 받아 합침.
 * @param {{all?:boolean, quiet?:boolean}} [opts] all: 전부 올림(방 만들 때)
 * @returns {Promise<boolean>} 성공 여부
 */
async function syncNow(opts = {}) {
  const code = state.sync.code;
  if (!code) return false;
  if (syncRunning) { syncAgain = true; return false; }
  syncRunning = true;
  try {
    const push = buildPush(state, { all: !!opts.all });
    const remote = await callSync({ code, meta: push.meta, meta_rev: push.meta_rev, items: push.items });
    const prevTripCode = activeTrip().code;
    // 보낸 항목은 서버가 같은 rev 로 돌려주면 dirty 가 풀림. 삭제 기록은 서버에 들어갔으니 비움
    const r = applyRemote(state, remote);
    if (r.metaApplied) followTripCurrency(prevTripCode);
    const sentIds = new Set(push.items.filter((i) => i.deleted).map((i) => i.id));
    state.tombstones = state.tombstones.filter((tb) => !sentIds.has(tb.id));
    state.sync.lastAt = Date.now();
    if (remote.meta_rev >= (state.sync.metaRev || 0)) state.sync.metaRev = remote.meta_rev;
    lastMetaSig = JSON.stringify(metaOf(state));
    syncError = '';
    saveState(state);
    if (r.added || r.updated || r.removed || r.metaApplied) {
      render();
      if (!opts.quiet && (r.added || r.removed)) toast(`동기화: ${r.added ? `+${r.added}건 ` : ''}${r.removed ? `−${r.removed}건` : ''}`.trim());
    } else if (state.ui.tab === 'settings') render();
    return true;
  } catch (e) {
    syncError = e && e.name === 'AbortError' ? '시간 초과' : (e?.message || String(e));
    logger.warn('동기화 실패', syncError);
    if (state.ui.tab === 'settings') render();
    return false;
  } finally {
    syncRunning = false;
    if (syncAgain) { syncAgain = false; scheduleSync(); }
  }
}

/**
 * 방 만들기: 코드 생성, 이 폰 내용 전부 올림.
 * @returns {Promise<void>}
 */
async function createRoom() {
  const code = newRoomCode();
  try {
    const push = buildPush(state, { all: true });
    const remote = await callSync({ code, meta: push.meta, meta_rev: push.meta_rev || Date.now(), items: push.items, create: true });
    state.sync = { code, lastAt: Date.now(), metaRev: remote.meta_rev };
    applyRemote(state, remote);
    lastMetaSig = JSON.stringify(metaOf(state));
    syncError = '';
    saveState(state); render();
    toast(`방 ${code} 만듦. 서정이 폰 설정에 이 코드를 넣으면 같이 씀`);
  } catch (e) { toast(`방 만들기 실패: ${e.message}`); }
}

/**
 * 방 코드로 연결. 방에 내용이 있고 이 폰에도 내역이 있으면 물어봄(방 내용으로 맞추기 / 합치기).
 * @param {string} raw
 * @param {{replace?:boolean|null}} [opts] replace 를 주면 묻지 않음
 * @returns {Promise<boolean>}
 */
async function joinRoom(raw, opts = {}) {
  const code = normalizeCode(raw);
  if (!code) { toast('방 코드는 영문·숫자 6자'); return false; }
  let remote;
  try { remote = await callSync({ code, items: [] }); } catch (e) { toast(e.message); return false; }
  const remoteLive = (remote.items || []).filter((i) => !i.deleted).length;
  const localN = state.trips.reduce((n, t) => n + t.items.length, 0);
  let replace = opts.replace ?? null;
  if (replace === null && remoteLive && localN) {
    replace = window.confirm(`방 ${code} 에 ${remoteLive}건이 있음. 이 폰의 ${localN}건을 버리고 방 내용으로 맞출까?\n(취소 = 둘 다 합침. 같은 내역이 두 번 들어갈 수 있음)`);
  }
  if (replace) {
    for (const t of state.trips) t.items = [];
    state.tombstones = [];
    state.sync = { code, lastAt: 0, metaRev: 0 };
    if (remote.meta && Array.isArray(remote.meta.trips)) {
      // 방의 여행 목록으로 맞춤(비어 있는 로컬 여행은 버림)
      state.trips = remote.meta.trips.map((rt) => ({ id: rt.id, name: rt.name, code: rt.code, items: [] }));
      if (!state.trips.length) state.trips = defaultState().trips;
    }
  } else {
    state.sync = { code, lastAt: 0, metaRev: state.sync.metaRev || 0 };
    for (const t of state.trips) for (const it of t.items) touch(it);
  }
  applyRemote(state, remote);
  if (!state.trips.some((t) => t.id === state.activeTrip)) state.activeTrip = state.trips[0].id;
  draft.code = activeTrip().code;
  fx.code = tripFxCode(); fx.input = ''; fx.terms = [];
  lastMetaSig = JSON.stringify(metaOf(state));
  state.sync.lastAt = Date.now();
  saveState(state);
  state.ui.tab = 'settle';
  render();
  toast(`방 ${code} 연결됨`);
  if (!replace) scheduleSync();
  return true;
}

/** @returns {number} 아직 안 올라간 항목 수 */
function dirtyCount() {
  let n = state.tombstones.length;
  for (const t of state.trips) for (const it of t.items) if (it.dirty) n += 1;
  return n;
}

/**
 * HTML 이스케이프.
 * @param {unknown} s
 * @returns {string}
 */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer = 0;
/** @param {string} msg */
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 2200);
}

/** @returns {object} */
function activeTrip() {
  return state.trips.find((t) => t.id === state.activeTrip) || state.trips[0];
}

/**
 * "1,234.5" → 1234.5. 비면 0.
 * @param {string} s
 * @returns {number}
 */
function parseAmount(s) {
  const n = parseFloat(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * 키패드 입력 문자열을 쉼표 넣어 표시.
 * @param {string} s
 * @returns {string}
 */
function displayInput(s) {
  if (!s) return '0';
  const [i, d] = s.split('.');
  const ip = (i || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return d !== undefined ? `${ip}.${d}` : ip;
}

/**
 * 국기 + 나라 이름. 표에 없는 통화는 빈 문자열.
 * @param {string} code
 * @returns {string} 예: "🇲🇽 멕시코"
 */
function countryLabel(code) {
  const ct = countryOf(code);
  return ct ? `${ct.flag} ${ct.name}` : '';
}

/**
 * 이름 앞에 붙일 국기. 표에 없는 통화는 빈 문자열.
 * @param {string} code
 * @returns {string} 예: "🇲🇽 "
 */
function flagPrefix(code) {
  const f = countryOf(code)?.flag;
  return f ? `${f} ` : '';
}

/**
 * @param {string} code
 * @returns {number|null} USD 1 달러당 현지 통화(교차)
 */
function crossOf(code) {
  const m = state.manual.usdCross?.[code];
  if (Number.isFinite(m) && m > 0) return m;
  const r = rates?.usdCross?.[code];
  return Number.isFinite(r) && r > 0 ? r : null;
}

/**
 * @param {string|null|undefined} iso
 * @returns {string}
 */
function shortTime(iso) {
  const t = iso ? new Date(iso) : null;
  if (!t || Number.isNaN(t.getTime())) return '시각 없음';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
}

/**
 * 통화 select 옵션 HTML(즐겨찾기 먼저, 나머지 이름순).
 * @param {string} selected
 * @returns {string}
 */
function currencyOptions(selected) {
  const fav = state.favorites.filter((c) => currencyInfo(c));
  const rest = CURRENCIES.filter((c) => !fav.includes(c.code)).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const opt = (code) => {
    const i = currencyInfo(code);
    return `<option value="${esc(code)}" ${code === selected ? 'selected' : ''}>${esc(i.name)} (${esc(code)})</option>`;
  };
  return `<optgroup label="즐겨찾기">${fav.map(opt).join('')}</optgroup><optgroup label="전체">${rest.map((c) => opt(c.code)).join('')}</optgroup>`;
}

/** @returns {string} 출처·고시일·신선도 HTML. 예: "하나은행 09-23 고시 🟢" */
function badgeHtml() {
  if (!rates) return '<span class="warn">환율 없음 🔴</span>';
  const stale = hoursOld(rates) > (state.settings.staleHours || 24);
  const when = rates.baseDate ? `${esc(rates.baseDate.slice(5))} 고시` : esc(shortTime(rates.asof));
  return `${esc(sourceLabel(rates.source))} ${when} ${stale ? '<span class="warn">🟡</span>' : '<span class="ok">🟢</span>'}`;
}

function renderBadge() { badgeEl.innerHTML = badgeHtml(); }

function render() {
  const tab = state.ui.tab;
  for (const b of tabs.querySelectorAll('button')) b.classList.toggle('on', b.dataset.tab === tab);
  document.body.classList.toggle('fx', tab === 'fx');
  renderBadge();
  if (tab === 'settle') { titleEl.textContent = `정산 · ${activeTrip().name}`; view.innerHTML = renderSettle(); }
  else if (tab === 'settings') { titleEl.textContent = '설정'; view.innerHTML = renderSettings(); }
  else { titleEl.textContent = '환율'; view.innerHTML = renderFx(); }
}

/* ───────────── 환율 탭 ───────────── */

/**
 * 입력 통화 하나 → 원화·달러·캐달 + 여행지 통화(입력과 다를 때). 트래블로그 미지원 통화는 USD 지갑 경유를 같이 보여 줌.
 * @param {string} code 입력 통화
 * @returns {string[]}
 */
function targetsFor(code) {
  const trip = activeTrip().code;
  return ['KRW', 'USD', 'CAD', trip].filter((c, i, arr) => c !== code && arr.indexOf(c) === i);
}

/** @returns {string} */
function renderFx() {
  // 버튼 줄에 없는 통화는 화면에 두지 않음(Chan 2026-10-21: 뺀 중국 돈이 위에 계속 남아 있었음).
  // 찾기 창 ✕ 빼기, 설정 즐겨찾기 해제, 예전 버전에서 남은 상태 어디서 왔든 여기서 정리
  if (!fxChipCodes().includes(fx.code)) setFxCode(fallbackFxCode(fx.code));
  const code = fx.code;
  const info = currencyInfo(code);
  const amt = fxTotal();
  const favs = fxChipCodes();
  // 통화 코드 아래 국기·나라 이름(Chan 2026-10-21: "MXN" 만으론 어느 나라인지 바로 안 보임)
  const chips = favs.map((c) => `<button class="chip cur ${c === code ? 'on' : ''}" data-action="fx-code" data-code="${esc(c)}"><span class="cc">${esc(c)}</span>${countryLabel(c) ? `<span class="cn">${esc(countryLabel(c))}</span>` : ''}</button>`).join('')
    + '<button class="chip more" data-action="fx-more">+ 통화</button>';
  const unsupported = (c) => c !== 'KRW' && currencyInfo(c).travlog === 'none';

  let cards = '';
  let lines = [];
  let err = '';
  try {
    const src = krwPerUnit(code, ctx());
    const krw = amt * src.rate;
    const usd = krwPerUnit('USD', ctx());
    cards = targetsFor(code).map((t) => {
      const ti = currencyInfo(t);
      const r = krwPerUnit(t, ctx());
      const v = krw / r.rate;
      let lbl = t === 'KRW' ? '원화' : t === 'USD' ? '달러' : t === 'CAD' ? '캐달' : ti.name;
      if (t === 'USD' && unsupported(code)) lbl = 'USD 지갑에서 빠짐';
      if (unsupported(t)) lbl += ' · USD 지갑 결제';
      const unit = t === 'KRW' ? '원' : t === 'CAD' ? '캐달' : t;
      return `<div class="res"><div class="lbl">${esc(lbl)}</div><div class="v">${fmt(v, t === 'KRW' ? 0 : ti.dec)} <small>${esc(unit)}</small></div></div>`;
    }).join('');

    // 1 단위당 원화. 예: "1 MAD = 147.42원", "100 JPY = 912.30원"
    const per = (c) => { const r = krwPerUnit(c, ctx()); const u = r.unit > 1 ? r.unit : 1; return `${u} ${c} = ${fmt(r.rate * u, r.rate * u < 10 ? 3 : 2)}원`; };
    const crossLabel = (c) => (state.manual.usdCross?.[c] > 0 ? '고정' : '자동');
    const usdAmt = krw / usd.rate;
    const tvUsd = krwPerUnit('USD', ctx()).source === 'travlog';
    if (code !== 'KRW') lines.push(`<b>${esc(per(code))}</b> · ${src.source === 'travlog' || (src.source === 'manual-cross' && tvUsd) ? `<span class="ok">트래블로그 앱 값 (${esc((state.travlog.at || '').slice(5))} 입력)</span>` : badgeHtml()}`);
    if (unsupported(code)) {
      // 미지원 통화는 USD 지갑에서 빠짐: 교차 → USD 금액 → 원화, 단계마다 한 줄
      lines.push(`${fmt(crossOf(code) || 0, 2)} ${esc(code)} = USD 1 (${crossLabel(code)}) · USD 지갑에서 결제`);
      lines.push(`${fmt(amt, info.dec)} ${esc(code)} = ${fmt(usdAmt, 2)} USD`);
      lines.push(`${fmt(usdAmt, 2)} USD × ${fmt(usd.rate, 2)}원 = ${fmt(krw)}원`);
    }
    for (const t of targetsFor(code)) {
      if (unsupported(t)) {
        lines.push(`${esc(t)} 는 USD 지갑 결제: ${fmt(usdAmt, 2)} USD × ${fmt(crossOf(t) || 0, 2)} (${crossLabel(t)}) = ${fmt(krw / krwPerUnit(t, ctx()).rate, currencyInfo(t).dec)} ${esc(t)}`);
      }
    }
    const base = [code !== 'USD' ? per('USD') : '', code !== 'CAD' ? per('CAD') : ''].filter(Boolean);
    if (base.length) lines.push(`${esc(base.join(' · '))} · ${esc(sourceLabel(krwPerUnit('USD', ctx()).source))}`);
  } catch (e) {
    if (e instanceof RateMissingError) {
      err = `${esc(e.code)} 환율이 없음. 설정 → 수동 환율에 "USD 1달러 = 몇 ${esc(e.code)}" 를 넣어 줘.`;
      cards = targetsFor(code).map((t) => `<div class="res"><div class="lbl">${esc(t)}</div><div class="v">—</div></div>`).join('');
    } else throw e;
  }
  // 전화기 배열: 1·2·3 이 맨 위
  // 4열: 1 2 3 ⌫ / 4 5 6 + / 7 8 9 + / . 0 0 +  (+ 는 세 줄, 0 은 두 칸)
  const keys = ['1', '2', '3', 'back', '4', '5', '6', 'plus', '7', '8', '9', '.', '0'];
  const keypad = keys.map((k) => {
    if (k === 'back') return '<button class="key fn" data-action="fx-key" data-key="back" aria-label="지우기">⌫</button>';
    if (k === 'plus') return '<button class="key plus" data-action="fx-key" data-key="+" aria-label="더하기">+</button>';
    return `<button class="key${k === '0' ? ' zero' : ''}" data-action="fx-key" data-key="${k}">${k}</button>`;
  }).join('');
  const expr = fx.terms.length ? `<div class="expr">${esc([...fx.terms.map((t) => fmt(t, Number.isInteger(t) ? 0 : 2)), displayInput(fx.input)].join(' + '))} =</div>` : '';
  const big = fx.terms.length ? fmt(amt, Number.isInteger(amt) ? 0 : 2) : displayInput(fx.input);
  return `
  <section class="card">
    <div class="chips">${chips}</div>
    <div class="muted">${esc(info.name)} 입력${code !== 'KRW' ? '<button class="mini" data-action="chart-open">📈 차트</button>' : ''}</div>
    ${expr}
    <div class="amount"><span class="num">${big}</span><span class="unit">${esc(code === 'KRW' ? '원' : code)}</span></div>
    <div class="results">${cards}</div>
    ${err ? `<div class="err">${err}</div>` : `<div class="rateline">${lines.join('<br>')}</div>`}
    <div class="keypad">${keypad}</div>
    <div class="actions">
      <button class="btn clear" data-action="fx-clear">✕ 지우기</button>
      <button class="btn primary" data-action="fx-add">정산에 추가</button>
    </div>
  </section>`;
}

/* ───────────── 정산 탭 ───────────── */

/**
 * 정산 내역에 보여 줄 낸 금액. ceilDisplay 통화(MAD)는 소수점 올림 정수(97.6 → 98). 표시 전용, 계산은 원래 값.
 * @param {number} amount
 * @param {string} code
 * @returns {string}
 */
function ledgerAmount(amount, code) {
  const i = currencyInfo(code);
  if (i.ceilDisplay) return fmt(Math.ceil(amount - 1e-9));
  return fmt(amount, i.dec);
}

/**
 * 하루 합계 표시: 정수면 소수점 없이, 아니면 두 자리. MAD 처럼 올림 표시 통화는 올림.
 * @param {number} amount
 * @param {string} code
 * @returns {string}
 */
function dayAmount(amount, code) {
  if (currencyInfo(code).ceilDisplay) return fmt(Math.ceil(amount - 1e-9));
  const r = Math.round(amount * 100) / 100;
  return fmt(r, Number.isInteger(r) ? 0 : 2);
}

/**
 * 항목의 현재 CAD 환산(스냅샷 원화 ÷ 현재 CAD).
 * @param {number} krw
 * @returns {string}
 */
function cadOf(krw) {
  try { return fmt(krw / krwPerUnit('CAD', ctx()).rate, 1); } catch { return '—'; }
}

/**
 * 노션 메모 붙여넣기 상자. 파싱 결과를 미리 보여 주고 확인 뒤 추가.
 * @returns {string}
 */
function renderPasteBox() {
  if (!pasteBox) return '';
  const trip = activeTrip();
  const preview = pasteBox.items.length
    ? `<div class="items">${pasteBox.items.map((it) => `<div class="item"><span class="who">${esc(it.payer)}</span><div class="mid"><div class="desc">${esc(it.desc)}</div>${it.note ? `<div class="sub">${esc(it.note)}</div>` : ''}</div><div class="amt"><b>${fmt(it.amount, currencyInfo(it.code).dec)} ${esc(it.code)}</b></div></div>`).join('')}</div>`
    : '';
  const skipped = pasteBox.skipped.length ? `<p class="hint">항목으로 안 읽힌 줄 ${pasteBox.skipped.length}개: ${esc(pasteBox.skipped.slice(0, 3).join(' / '))}${pasteBox.skipped.length > 3 ? ' …' : ''}</p>` : '';
  const warns = pasteBox.warnings.length ? `<p class="hint warn">${esc(pasteBox.warnings.join(' / '))}</p>` : '';
  return `
  <section class="card"><h2>노션 메모 붙여넣기 → ${esc(trip.name)}</h2>
    <textarea id="paste-text" rows="6" style="width:100%;border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--card);color:var(--text)" placeholder="ㅈ빵 + 망고주스 = 5 + 22 = 27
ㅅ마트 97.6
ㅈ사하라 투어 191 달러">${esc(pasteBox.text)}</textarea>
    <p class="hint">줄 맨 앞 초성(${state.people.map((p, i) => `${esc(state.initials[i] || chosungOf(p))}=${esc(p)}`).join(', ')})이 낸 사람. 단위 없으면 ${esc(trip.code)}. 원·달러·유로 단위는 그대로 읽음.</p>
    <div class="actions"><button class="btn" data-action="paste-preview">읽어 보기</button><button class="btn primary" data-action="paste-add" ${pasteBox.items.length ? '' : 'disabled'}>${pasteBox.items.length}건 추가</button><button class="btn sm" data-action="paste-close">닫기</button></div>
    ${preview}${skipped}${warns}
  </section>`;
}

/**
 * @param {string} name
 * @returns {string}
 */
function chosungOf(name) {
  const code = name.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return name[0];
  return ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'][Math.floor(code / 588)];
}

/**
 * 항목 여러 개를 현재 환율 스냅샷과 함께 여행에 추가. 환율 없는 통화는 건너뛰고 개수를 돌려줌.
 * @param {object} trip
 * @param {Array<{payer:string, desc:string, amount:number, code:string, forWho?:string, note?:string}>} list
 * @returns {{added:number, failed:string[]}}
 */
function addItems(trip, list) {
  let added = 0;
  const failed = [];
  for (const it of list) {
    let r;
    try { r = krwPerUnit(it.code, ctx()); } catch (e) {
      if (e instanceof RateMissingError) { failed.push(`${it.desc} (${it.code})`); continue; }
      throw e;
    }
    if (!state.people.includes(it.payer)) { failed.push(`${it.desc} (낸 사람 ${it.payer})`); continue; }
    trip.items.push({
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${added}`,
      ts: Date.now() + added, payer: it.payer, desc: it.desc, amount: it.amount, code: it.code,
      krw: Math.round(it.amount * r.rate), rate: r.rate, source: r.source, rev: Date.now() + added, dirty: true,
      ...(it.forWho ? { forWho: it.forWho } : {}), ...(it.note ? { note: it.note } : {}), pay: it.pay || defaultEntryPay(trip),
    });
    added += 1;
  }
  return { added, failed };
}

/**
 * 수동 환율이 바뀌면 그 통화 내역의 원화 스냅샷을 지금 환율로 다시 찍는다("USD 1 = 9.2 MAD 고정" 이 옛 항목에도 적용되게).
 * 사용자가 직접 원화값을 고친 항목은 없으므로 통화가 같으면 전부 대상.
 * @param {string} code
 * @returns {number} 다시 계산한 항목 수
 */
function resnapshotItems(code) {
  let r;
  try { r = krwPerUnit(code, ctx()); } catch (e) {
    if (e instanceof RateMissingError) return 0;
    throw e;
  }
  let n = 0;
  for (const t of state.trips) {
    for (const it of t.items) {
      if (it.code !== code) continue;
      const krw = Math.round(it.amount * r.rate);
      if (krw === it.krw && it.source === r.source) continue;
      Object.assign(it, { krw, rate: r.rate, source: r.source });
      touch(it);
      n += 1;
    }
  }
  return n;
}

/**
 * 주소의 #import=… 를 읽어 항목을 넣는다. 이름·여행·수동 환율도 같이 온다.
 * @returns {Promise<void>}
 */
async function applyHashImport() {
  const m = /^#import=([A-Za-z0-9_-]+)$/.exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  await importFromText(m[1]);
}

/**
 * 공유 링크(전체 URL 또는 #import= 뒤의 payload 문자열)를 읽어 정산에 넣는다. 설정의 붙여넣기 칸과 주소 해시 둘 다 여기로.
 * @param {string} text
 * @returns {Promise<boolean>} 넣었으면 true
 */
async function importFromText(text) {
  const raw = String(text || '').trim();
  const m = /#import=([A-Za-z0-9_-]+)/.exec(raw);
  const enc = m ? m[1] : raw;
  if (!/^[A-Za-z0-9_-]{8,}$/.test(enc)) { toast('공유 링크가 아님'); return false; }
  let p;
  try { p = decodeImport(enc); } catch (e) { toast(`가져오기 링크 오류: ${e.message}`); return false; }
  // 방 코드가 든 링크: 항목을 복사하지 않고 그 방에 연결(둘이 같은 내용을 계속 같이 봄)
  if (p.room && normalizeCode(p.room)) {
    if (state.sync.code === normalizeCode(p.room)) { toast('이미 이 방에 연결돼 있음'); return false; }
    if (!window.confirm(`방 ${normalizeCode(p.room)} 에 연결해서 같이 쓸까? 이 폰의 내역은 방 내용으로 맞춰짐.`)) return false;
    return joinRoom(p.room, { replace: true });
  }
  const tripName = p.trip?.name || '여행';
  const hasAny = state.trips.some((t) => t.items.length > 0);
  // 같은 링크를 두 번 누르면 항목이 두 벌 들어감. 내역이 있을 때는 한 번 가져온 링크를 막음
  const key = `${enc.length}:${enc.slice(0, 32)}:${enc.slice(-32)}`;
  if (state.imports.includes(key) && hasAny) { toast('이미 가져온 링크라 건너뜀. 다시 넣으려면 내역을 먼저 지울 것'); return false; }
  const items = Array.isArray(p.items) ? p.items : [];
  if (!window.confirm(`${items.length}건을 '${tripName}' 정산에 추가할까?`)) return false;
  state.imports = [...state.imports.filter((k) => k !== key), key].slice(-20);
  if (Array.isArray(p.people) && p.people.length === state.people.length && !hasAny) {
    state.people = [...p.people];
    draft.payer = state.people[0];
  }
  for (const [kind, map] of Object.entries(p.manual || {})) {
    if (!state.manual[kind]) continue;
    for (const [code, v] of Object.entries(map)) if (!(state.manual[kind][code] > 0) && v > 0) state.manual[kind][code] = v;
  }
  // 트래블로그 앱 환율: 내 폰에 없을 때만
  if (p.travlog?.rates && p.travlog.at && !Object.keys(state.travlog.rates).length) state.travlog = { rates: { ...p.travlog.rates }, at: p.travlog.at };
  let trip = state.trips.find((t) => t.name === tripName);
  if (!trip) {
    // 비어 있는 기본 여행('여행 1')이 있으면 새로 만들지 않고 그 자리를 씀
    const empty = state.trips.find((t) => t.items.length === 0 && /^여행 \d+$/.test(t.name));
    if (empty) { empty.name = tripName; empty.code = p.trip?.code || empty.code; trip = empty; }
    else { newTrip(tripName, p.trip?.code || 'USD'); trip = activeTrip(); }
  }
  state.activeTrip = trip.id;
  draft.code = trip.code;
  // 현금 지갑: 같은 사람·통화 지갑이 아직 없을 때만
  for (const c of Array.isArray(p.cash) ? p.cash : []) {
    const person = state.people[c.p] ?? String(c.p);
    if (!(c.a > 0) || state.cash.some((x) => x.person === person && x.code === c.c)) continue;
    state.cash.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, person, code: c.c, amount: c.a, ts: Date.now(), note: c.n || '' });
  }
  if (!rates) { await refreshRates({ silent: true }).catch(() => {}); }
  const list = items.map((it) => ({
    payer: state.people[it.p] ?? String(it.p), desc: it.d, amount: it.a, code: it.c,
    ...(it.f !== undefined && it.f !== null ? { forWho: state.people[it.f] } : {}), ...(it.n ? { note: it.n } : {}), ...(it.k === 'card' || it.k === 'cash' ? { pay: it.k } : {}),
  }));
  const { added, failed } = addItems(trip, list);
  persist();
  state.ui.tab = 'settle';
  render();
  toast(`${added}건 추가${failed.length ? ` · ${failed.length}건 실패(환율 없음)` : ''}`);
  if (failed.length) logger.warn('가져오기 실패', failed);
  return true;
}

/**
 * 지금 여행의 정산 전체(사람·항목·수동 환율·현금 지갑·트래블로그 환율)를 담은 공유 링크. 다른 폰에서 열거나 붙여넣으면 그대로 들어감.
 * @returns {string}
 */
function buildShareLink() {
  const trip = activeTrip();
  const pi = (name) => Math.max(0, state.people.indexOf(name));
  const payload = {
    v: 1, trip: { name: trip.name, code: trip.code }, people: [...state.people],
    ...(state.sync.code ? { room: state.sync.code } : {}),
    manual: { usdCross: { ...state.manual.usdCross } },
    ...(travlogActive() ? { travlog: { rates: { ...state.travlog.rates }, at: state.travlog.at } } : {}),
    cash: state.cash.map((c) => ({ p: pi(c.person), c: c.code, a: c.amount, ...(c.note ? { n: c.note } : {}) })),
    items: [...trip.items].sort((a, b) => a.ts - b.ts).map((it) => ({
      p: pi(it.payer), d: it.desc || '', a: it.amount, c: it.code,
      ...(it.forWho ? { f: pi(it.forWho) } : {}), ...(it.note ? { n: it.note } : {}), ...(it.pay ? { k: it.pay } : {}),
    })),
  };
  return `${location.origin}${location.pathname}#import=${encodeImport(payload)}`;
}

/** @returns {string} */
function renderSettle() {
  const trip = activeTrip();
  if (!draft.code) draft.code = trip.code || 'MAD';
  const items = [...trip.items].sort((a, b) => b.ts - a.ts);
  const tripSel = `<select data-action="trip-select">${state.trips.map((t) => `<option value="${esc(t.id)}" ${t.id === trip.id ? 'selected' : ''}>${esc(flagPrefix(t.code) + t.name)}</option>`).join('')}</select>`;
  const payerBtns = state.people.map((p) => `<button class="${draft.payer === p ? 'on' : ''}" data-action="draft-payer" data-payer="${esc(p)}">${esc(p)}</button>`).join('');
  // 새 항목은 현금이 기본, 수정 중인 항목은 지금 잡혀 있는 결제를 보여 줌
  const shownPay = draft.pay || (editingId ? payMethod({ code: draft.code }, trip) : defaultEntryPay(trip));
  const form = `
  <section class="card">
    <div class="row"><label>여행</label>${tripSel}<button class="btn sm" data-action="trip-new">새 여행</button></div>
    <div class="row"><label>낸 사람</label><div class="payer" style="flex:1">${payerBtns}</div></div>
    <div class="row"><label>몫</label><div class="payer" style="flex:1">${[['', '같이'], ...state.people.map((p) => [p, `${p} 개인`])].map(([v, l]) => `<button class="${(draft.forWho || '') === v ? 'on' : ''}" data-action="draft-for" data-for="${esc(v)}">${esc(l)}</button>`).join('')}</div></div>
    <div class="row"><label>결제</label><div class="payer" style="flex:1">${[['cash', '현금'], ['card', '카드']].map(([v, l]) => `<button class="${shownPay === v ? 'on' : ''}" data-action="draft-pay" data-pay="${v}">${l}</button>`).join('')}</div></div>
    <div class="row"><label>날짜</label><input id="d-date" type="date" data-action="draft-date" value="${esc(draft.date || localDay(Date.now()))}" max="${esc(localDay(Date.now() + 86400e3))}"></div>
    <div class="row"><label>내용</label><input id="d-desc" data-action="draft-desc" value="${esc(draft.desc)}" placeholder="타진 + 민트티" autocomplete="off"></div>
    <div class="row"><label>금액</label><input id="d-amount" data-action="draft-amount" value="${esc(draft.amount)}" inputmode="decimal" placeholder="0" autocomplete="off">
      <select data-action="draft-code" style="flex:0 0 46%">${currencyOptions(draft.code)}</select></div>
    <div class="actions">
      ${editingId ? '<button class="btn danger" data-action="item-delete">삭제</button><button class="btn" data-action="draft-cancel">취소</button>' : ''}
      <button class="btn primary" data-action="draft-save">${editingId ? '저장' : '추가'}</button>
    </div>
    ${editingId ? '' : '<div class="actions"><button class="btn sm" data-action="paste-open">노션 메모 붙여넣기</button></div>'}
  </section>
  ${renderPasteBox()}`;

  const itemRow = (it) => {
    const payTag = payMethod(it, trip) === 'card' ? '<b>💳 카드</b>' : '';
    const sub = [payTag, it.forWho ? `<b>${esc(it.forWho)} 개인</b>` : '', it.note ? esc(it.note) : ''].filter(Boolean).join(' · ');
    // 메인은 실제로 낸 통화·금액(노션 메모 그대로). 원화·캐달은 환산값이라 작게
    const main = it.code === 'KRW' ? `${fmt(it.amount)}원` : `${ledgerAmount(it.amount, it.code)} ${esc(it.code)}`;
    const conv = it.code === 'KRW' ? `${cadOf(it.krw)} 캐달` : `${fmt(it.krw)}원 · ${cadOf(it.krw)} 캐달`;
    // 낸 사람별 행 색: 첫 사람(으뜸이) 연한 파랑, 둘째(서정이) 연한 핑크
    const pi = state.people.indexOf(it.payer);
    return `<div class="item ${pi >= 0 ? `p${pi % 4}` : ''}" data-action="item-edit" data-id="${esc(it.id)}">
      <span class="who">${esc(it.payer)}</span>
      <div class="mid"><div class="desc">${esc(it.desc || '(내용 없음)')}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
      <div class="amt"><b>${main}</b><small>${conv}</small></div>
    </div>`;
  };
  // 날짜별: 하루마다 "10월 4일 (토) · 73.73 CNY · 14,830원" 한 줄을 끼움
  let tripRate = 0;
  try { tripRate = trip.code === 'KRW' ? 1 : krwPerUnit(trip.code, ctx()).rate; } catch (e) { if (!(e instanceof RateMissingError)) throw e; }
  const today = localDay(Date.now());
  const wd = ['일', '월', '화', '수', '목', '금', '토'];
  const rows = groupByDay(items, trip.code, tripRate).map((g) => {
    let label = '날짜 없음';
    if (g.day) {
      const [y, m, dd] = g.day.split('-').map(Number);
      label = `${m}월 ${dd}일 (${wd[new Date(y, m - 1, dd).getDay()]})${g.day === today ? ' · 오늘' : ''}`;
    }
    const local = trip.code !== 'KRW' && g.local !== null ? `<b>${dayAmount(g.local, trip.code)} ${esc(trip.code)}</b> · ` : '';
    return `<div class="day"><span>${esc(label)}</span><span>${local}${fmt(g.krw)}원</span></div>${g.items.map(itemRow).join('')}`;
  }).join('');
  const groups = duplicateGroups(trip.items, state.dupOk);
  const dupeBtn = groups.length ? `<div class="actions"><button class="btn sm danger" data-action="items-dedupe">같은 항목 ${groups.length}묶음 확인</button></div>` : '';
  const clearBtn = items.length ? `<div class="actions"><button class="btn sm" data-action="items-clear">내역 전체 삭제</button></div>` : '';
  const list = `<section class="card"><h2>내역 ${items.length}건</h2>${dupeBtn}<div class="items">${rows || '<div class="empty">아직 없음. 위에서 추가하거나 환율 탭에서 "정산에 추가".</div>'}</div>${clearBtn}</section>`;

  let summary;
  try {
    const s = settle(trip.items, state.people, ctx(), state.ratio);
    const lines = state.people.map((p) => `<div class="line"><span>${esc(p)} 낸 돈</span><span>${fmt(s.paid[p])}원 <small class="muted">${cadOf(s.paid[p])} 캐달</small></span></div>`).join('');
    const ratioTxt = state.ratio.every((r) => r === state.ratio[0]) ? '균등' : state.ratio.join(':');
    const share = state.people.map((p) => `${esc(p)} ${fmt(s.share[p])}원${s.personal[p] ? ` <small class="muted">(개인 ${fmt(s.personal[p])})</small>` : ''}`).join(' · ');
    const xfer = s.transfers.length
      ? s.transfers.map((t) => `<div class="xfer">${esc(t.from)} → ${esc(t.to)} ${fmt(t.krw)}원 <small>(${t.cad === null ? '—' : fmt(t.cad, 1)} 캐달)</small></div>`).join('')
      : '<div class="xfer ok">정산 끝. 주고받을 돈 없음</div>';
    summary = `<div class="summary">${lines}
      <div class="line total"><span>합계</span><span>${fmt(s.total)}원 <small class="muted">${cadOf(s.total)} 캐달</small></span></div>
      <div class="line"><span>분담(${esc(ratioTxt)})</span><span>${share}</span></div>
      ${xfer}
      <div class="actions"><button class="btn" data-action="settle-copy">텍스트 복사</button><button class="btn" data-action="settle-share">공유 링크</button></div>
    </div>`;
  } catch (e) {
    summary = `<div class="summary"><div class="err">정산 계산 실패: ${esc(e.message)}</div></div>`;
  }
  return form + summary + renderCash(trip) + list + renderDedupe(trip);
}

/**
 * 중복 확인 창. 같은 항목 묶음마다 언제 적었는지 보여 주고, 눌러서 남길지·지울지 고름.
 * @param {object} trip
 * @returns {string}
 */
function renderDedupe(trip) {
  if (!dedupe) return '';
  const groups = duplicateGroups(trip.items, state.dupOk);
  const wd = ['일', '월', '화', '수', '목', '금', '토'];
  const when = (ts) => {
    if (!Number.isFinite(ts) || ts <= 0) return '날짜 없음';
    const t = new Date(ts);
    return `${t.getMonth() + 1}월 ${t.getDate()}일 (${wd[t.getDay()]}) ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  };
  let gone = 0;
  const body = groups.map((g, gi) => {
    const first = g.items[0].it;
    const main = first.code === 'KRW' ? `${fmt(first.amount)}원` : `${ledgerAmount(first.amount, first.code)} ${esc(first.code)}`;
    const rows = g.items.map(({ it, why }) => {
      const keep = dedupe.keep.has(it.id);
      if (!keep) gone += 1;
      const pay = payMethod(it, trip) === 'card' ? '💳 카드' : '💵 현금';
      const sub = [esc(why), pay, it.note ? esc(it.note) : ''].filter(Boolean).join(' · ');
      return `<button class="dup-row ${keep ? 'keep' : 'drop'}" data-action="dup-toggle" data-id="${esc(it.id)}">
        <span class="mark">${keep ? '✓ 남김' : '✕ 지움'}</span>
        <span class="mid"><b>${esc(when(it.ts))}</b><small>${sub}</small></span>
      </button>`;
    }).join('');
    const kept = g.items.filter(({ it }) => dedupe.keep.has(it.id)).length;
    return `<div class="dup-group">
      <div class="dup-head"><span class="who">${esc(first.payer)}</span><b>${esc(first.desc || '(내용 없음)')}${first.forWho ? ` · ${esc(first.forWho)} 개인` : ''}</b><span>${main} × ${g.items.length}</span></div>
      ${rows}
      <div class="dup-quick">
        <button class="btn sm ${kept === 1 ? 'on' : ''}" data-action="dup-one" data-g="${gi}">하나만 남기기</button>
        <button class="btn sm ${kept === g.items.length ? 'on' : ''}" data-action="dup-all" data-g="${gi}">모두 남기기</button>
      </div>
    </div>`;
  }).join('') || '<div class="empty">같은 항목 없음</div>';
  return `<div class="sheet-bg" data-action="dup-cancel"><section class="sheet" role="dialog" aria-label="같은 항목 확인" data-action="dup-noop">
    <h2>같은 항목 ${groups.length}묶음</h2>
    <p class="hint" style="margin:0 0 8px">낸 사람·내용·금액·통화가 같은 항목. 줄을 눌러 남길지 지울지 고름. 같은 날 10분 안에 또 들어온 건 지움으로, 다른 날·한참 뒤에 적은 건 따로 산 것일 수 있어 남김으로 미리 골라 둠.</p>
    <div class="sheet-body">${body}</div>
    <div class="actions"><button class="btn" data-action="dup-cancel">취소</button><button class="btn primary" data-action="dup-apply">${gone ? `${gone}건 지우기` : '모두 남기기'}</button></div>
  </section></div>`;
}

/**
 * 현금 지갑 카드. 사람·통화별 환전 − 현금 사용 = 남은 현금, 넣은 돈 목록과 추가 폼.
 * @param {object} trip
 * @returns {string}
 */
function renderCash(trip) {
  const bal = cashBalances(trip.items, state.cash, trip);
  const krwOf = (amt, code) => { try { return `${fmt(amt * krwPerUnit(code, ctx()).rate)}원`; } catch { return ''; } };
  // 현금은 정수면 소수점 없이, 아니면 두 자리
  const cf = (x) => fmt(x, Number.isInteger(Math.round(x * 100) / 100) ? 0 : 2);
  const rows = bal.map((w) => {
    if (!w.hasWallet) {
      // 넣은 돈을 안 적은 사람: 잔액 대신 현금 사용액만 알려 줌
      return `<div class="line"><span>${esc(w.person)} ${esc(w.code)} 현금 사용</span><span class="muted">${cf(w.spent)} ${esc(w.code)} · 넣은 돈 미입력</span></div>`;
    }
    const cls = w.remaining < 0 ? 'warn' : '';
    // 둘째 줄은 식 그대로: 넣은 돈 − 현금 사용 = 남은 돈
    return `<div class="line"><span>${esc(w.person)} ${esc(w.code)} 남은 현금</span><span class="${cls}"><b>${cf(w.remaining)} ${esc(w.code)}</b> <small class="muted">${esc(krwOf(w.remaining, w.code))}</small></span></div>
      <div class="line formula"><span class="muted">넣은 돈 ${cf(w.topup)} − 현금 사용 ${cf(w.spent)} = <b class="${cls}">남은 ${cf(w.remaining)} ${esc(w.code)}</b></span></div>`;
  }).join('') || '<div class="empty">아직 없음. 환전한 현금을 아래에 넣으면 정산 내역 중 현금 결제분이 빠져나간 잔액이 보임.</div>';
  const list = state.cash.map((c) => `<div class="kv"><span>${esc(c.person)} · ${cf(c.amount)} ${esc(c.code)}${c.note ? ` · ${esc(c.note)}` : ''}</span><button class="del" data-action="cash-del" data-id="${esc(c.id)}">삭제</button></div>`).join('');
  const personSel = `<select id="c-person" style="flex:0 0 30%">${state.people.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}</select>`;
  return `<section class="card cash"><h2>현금 지갑</h2>${rows}
    <div class="hint" style="margin:6px 0">${list ? '넣은 돈:' : ''}</div>${list}
    <div class="row" style="margin-top:8px">${personSel}<input id="c-amount" inputmode="decimal" placeholder="환전 금액" autocomplete="off"><select id="c-code" style="flex:0 0 34%">${currencyOptions(trip.code)}</select></div>
    <div class="actions"><button class="btn primary" data-action="cash-add">현금 넣기</button></div>
    <p class="hint">새로 적는 항목은 현금이 기본. 카드로 낸 것만 입력할 때 "카드"를 누르면 됨. 내역의 💳 표시가 카드로 잡힌 항목.</p></section>`;
}



/**
 * 노션·카톡에 붙여 넣을 정산 요약 텍스트.
 * @returns {string}
 */
function summaryText() {
  const trip = activeTrip();
  const s = settle(trip.items, state.people, ctx(), state.ratio);
  const cadTxt = (krw) => { const c = cadOf(krw); return c === '—' ? '' : ` (C$${c})`; };
  const out = [`[${trip.name} 정산] ${new Date().toISOString().slice(0, 10)} 기준, ${trip.items.length}건`];
  for (const p of state.people) out.push(`${p} 낸 돈 ${fmt(s.paid[p])}원${cadTxt(s.paid[p])}`);
  out.push(`합계 ${fmt(s.total)}원${cadTxt(s.total)} · 분담 ${state.people.map((p) => `${p} ${fmt(s.share[p])}원`).join(', ')}`);
  for (const t of s.transfers) out.push(`→ ${t.from}이(가) ${t.to}에게 ${fmt(t.krw)}원${t.cad === null ? '' : ` (C$${fmt(t.cad, 1)})`}`);
  if (!s.transfers.length) out.push('→ 주고받을 돈 없음');
  const codes = [...new Set(trip.items.map((i) => i.code).filter((c) => c !== 'KRW'))];
  const rl = codes.map((c) => { try { const r = krwPerUnit(c, ctx()); return `1 ${c}=${fmt(r.rate, r.rate < 10 ? 3 : 2)}원(${sourceLabel(r.source)})`; } catch { return `${c} 환율 없음`; } });
  try { const r = krwPerUnit('CAD', ctx()); rl.push(`1 CAD=${fmt(r.rate, 1)}원`); } catch { /* CAD 없으면 생략 */ }
  if (rl.length) out.push(`환율: ${rl.join(', ')}`);
  for (const w of cashBalances(trip.items, state.cash, trip)) if (w.hasWallet) out.push(`현금 ${w.person} ${w.code}: 넣은 돈 ${fmt(w.topup, 2)} − 사용 ${fmt(w.spent, 2)} = 남은 ${fmt(w.remaining, 2)}`);
  out.push('', ...[...trip.items].sort((a, b) => a.ts - b.ts).map((i) => `${i.payer} ${i.desc || '-'} ${ledgerAmount(i.amount, i.code)} ${i.code} = ${fmt(i.krw)}원${i.forWho ? ` (${i.forWho} 개인)` : ''}${payMethod(i, trip) === 'card' ? ' [카드]' : ''}`));
  return out.join('\n');
}

/**
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch (e) { logger.warn('clipboard API 실패', e); }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

/** 입력 폼 → 항목 저장. 환율이 없으면 막음(조용한 오답 금지). */
function saveDraft() {
  const wasEditing = !!editingId;
  const amount = parseAmount(draft.amount);
  if (!(amount > 0)) { toast('금액을 넣어 줘'); return; }
  const trip = activeTrip();
  let r;
  try { r = krwPerUnit(draft.code, ctx()); } catch (e) {
    if (e instanceof RateMissingError) { toast(`${draft.code} 환율이 없어 저장 못 함. 설정에서 수동 환율 입력`); return; }
    throw e;
  }
  if (editingId) {
    const it = trip.items.find((x) => x.id === editingId);
    if (!it) { editingId = null; return; }
    const changed = it.amount !== amount || it.code !== draft.code;
    Object.assign(it, { payer: draft.payer, desc: draft.desc.trim(), amount, code: draft.code });
    if (draft.forWho) it.forWho = draft.forWho; else delete it.forWho;
    if (draft.pay) it.pay = draft.pay; else delete it.pay;
    if (changed) Object.assign(it, { krw: Math.round(amount * r.rate), rate: r.rate, source: r.source });
    // 날짜만 바꾸고 시각은 유지(원화 환산은 저장 때 환율 그대로)
    if (draft.date && (!Number.isFinite(it.ts) || draft.date !== localDay(it.ts))) it.ts = withDay(Number.isFinite(it.ts) ? it.ts : Date.now(), draft.date);
    touch(it);
    editingId = null;
    toast('수정함');
  } else {
    trip.items.push({
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      ts: draft.date && draft.date !== localDay(Date.now()) ? withDay(Date.now(), draft.date) : Date.now(), payer: draft.payer, desc: draft.desc.trim(), amount, code: draft.code,
      krw: Math.round(amount * r.rate), rate: r.rate, source: r.source, rev: Date.now(), dirty: true,
      ...(draft.forWho ? { forWho: draft.forWho } : {}), pay: draft.pay || defaultEntryPay(trip),
    });
    toast(`추가함 · ${fmt(amount * r.rate)}원`);
  }
  const keepDate = !wasEditing && draft.date && draft.date !== localDay(Date.now()) ? draft.date : '';
  draft = { payer: draft.payer, desc: '', amount: '', code: draft.code, forWho: '', pay: '', date: keepDate };
  persist();
  render();
}

/* ───────────── 설정 탭 ───────────── */

/**
 * 트래블로그 앱 환율 입력 행. USD·CAD·EUR·JPY + 여행 통화·즐겨찾기 중 트래블로그 지원 통화.
 * @returns {string}
 */
function travlogRows() {
  const codes = [...new Set(['USD', 'CAD', 'EUR', 'JPY', activeTrip().code, ...state.favorites])]
    .filter((c) => c !== 'KRW' && currencyInfo(c) && currencyInfo(c).travlog !== 'none');
  return codes.map((c) => {
    const unit = currencyInfo(c).unit || 1;
    let posted = '';
    try {
      const q = rates?.rates?.[c];
      if (q) posted = `고시 ${fmt(q.mid, 2)}`;
    } catch { posted = ''; }
    const v = state.travlog.rates[c];
    const diff = v && rates?.rates?.[c] ? v * unit - rates.rates[c].mid : null;
    return `<div class="row"><label style="flex:0 0 96px">${esc(c)} ${unit > 1 ? unit : 1} =</label><input data-action="travlog-val" data-code="${esc(c)}" value="${v ? esc(fmt(v * unit, 2).replace(/,/g, '')) : ''}" inputmode="decimal" placeholder="${esc(posted.replace('고시 ', '').replace(/,/g, ''))}" autocomplete="off"><span class="muted" style="flex:0 0 118px;font-size:.78rem;text-align:right">${esc(posted)}${diff !== null ? `<br>${diff >= 0 ? '+' : ''}${fmt(diff, 2)}` : ''}</span></div>`;
  }).join('');
}

/** @returns {string} */
function travlogStatus() {
  const t = state.travlog;
  if (!t.at || !Object.keys(t.rates).length) return '아직 없음. 하나머니 앱 → 하나머니 탭에서 보이는 환율을 넣을 것.';
  if (travlogActive()) return `${esc(t.at)} 입력값 사용 중. 고시일 ${esc(rates?.baseDate || '—')} 보다 새 고시가 나오면 자동 해제.`;
  return `<span class="warn">${esc(t.at)} 입력값은 만료됨(고시일 ${esc(rates?.baseDate || '—')} 이 더 새로움). 다시 보고 넣을 것.</span>`;
}

/* ───────────── 아래에서 올라오는 창(통화 찾기·차트) ───────────── */

/**
 * 검색 결과 줄. 누르면 그 통화로 환율 탭을 열고 버튼 줄에 추가.
 * @param {string} q
 * @returns {string}
 */
function curResults(q) {
  if (!q.trim()) return '<p class="hint">나라 이름(멕시코), 통화 이름(페소), 도시(방콕), 영문 코드(THB) 아무거나.</p>';
  const list = searchCurrencies(q, 15).filter((c) => c.code !== 'KRW');
  if (!list.length) return '<p class="hint">못 찾음. 다른 이름이나 영문 3자 코드로 찾아 볼 것.</p>';
  return list.map((c) => `<div class="cur-row"><span class="code">${esc(c.code)}</span><span class="nm">${esc(countryOf(c.code)?.flag || '')} ${esc(c.name)}${state.favorites.includes(c.code) ? ' · <small>버튼 있음</small>' : ''}</span>
    ${hasHistory(c.code) ? `<button class="btn sm" data-action="chart-open" data-code="${esc(c.code)}" aria-label="${esc(c.name)} 차트">📈</button>` : ''}
    <button class="btn sm primary" data-action="cur-pick" data-code="${esc(c.code)}">보기</button></div>`).join('');
}

/** @returns {string} 지금 환율 탭 버튼 줄의 통화들(✕ 로 빼기) */
function curMine() {
  if (!state.favorites.length) return '<p class="hint">없음. 위에서 찾아 추가.</p>';
  return state.favorites.map((c) => `<div class="cur-row"><span class="code">${esc(c)}</span><span class="nm">${esc(countryOf(c)?.flag || '')} ${esc(currencyInfo(c).name)}</span><button class="del" data-action="cur-del" data-code="${esc(c)}" aria-label="${esc(c)} 빼기">✕ 빼기</button></div>`).join('');
}

/** 검색어 칠 때·뺄 때는 창 전체를 다시 그리지 않음(입력 중 글자·키보드 유지) */
function updateCurSheet() {
  if (sheet?.type !== 'cur') return;
  const r = document.getElementById('cur-results');
  const m = document.getElementById('cur-mine');
  if (r) r.innerHTML = curResults(sheet.q);
  if (m) m.innerHTML = curMine();
}

/**
 * 원화 대비 차트 열기. 캐시가 있으면 바로 그리고, 없으면 받는 동안 "불러오는 중".
 * @param {string} code
 */
function openChart(code) {
  const years = sheet?.type === 'chart' ? sheet.years : 5;
  sheet = { type: 'chart', code, years, status: hasHistory(code) ? 'loading' : 'none', points: null, fromCache: false, peg: null, error: '', idx: -1 };
  renderSheet();
  if (!hasHistory(code)) return;
  loadHistory(code).then((r) => {
    if (sheet?.type !== 'chart' || sheet.code !== code) return;
    Object.assign(sheet, { status: 'ok', points: r.points, fromCache: r.fromCache, peg: r.peg || null });
    renderSheet();
  }).catch((e) => {
    if (sheet?.type !== 'chart' || sheet.code !== code) return;
    Object.assign(sheet, { status: 'error', error: e?.message || String(e) });
    renderSheet();
  });
}

/**
 * 차트 값 표시: 1000 넘으면 정수, 100 넘으면 한 자리, 그 아래는 두 자리.
 * @param {number} v
 * @returns {string}
 */
function fmtV(v) { return fmt(v, v >= 1000 ? 0 : v >= 100 ? 1 : 2); }

/**
 * 'YYYY-MM-DD' → '25.04.07'
 * @param {string} d
 * @returns {string}
 */
function shortDay(d) { return `${d.slice(2, 4)}.${d.slice(5, 7)}.${d.slice(8, 10)}`; }

/** @returns {string} 차트 창 HTML(그래프는 drawChart 가 폭을 재서 그림) */
function chartSheetHtml() {
  const s = /** @type {any} */ (sheet);
  const info = currencyInfo(s.code);
  const u = unitOf(s.code);
  const seg = `<div class="seg" role="group" aria-label="기간">${[1, 3, 5].map((y) => `<button class="${s.years === y ? 'on' : ''}" data-action="chart-range" data-years="${y}">${y}년</button>`).join('')}</div>`;
  let body = '';
  if (s.status === 'none') {
    const list = [...ECB_CODES, ...Object.keys(PEGS)].sort().join(' ');
    body = `<p class="hint">${esc(info.name)}(${esc(s.code)})는 무료로 받을 수 있는 과거 환율(ECB)에 없어서 차트를 못 그림.<br>차트 되는 통화: ${esc(list)}</p>`;
  } else if (s.status === 'error' && !s.points) {
    body = `<p class="err">못 받음: ${esc(s.error)}. 인터넷 연결을 확인하고 다시 열 것.</p>`;
  } else if (!s.points) {
    body = '<p class="muted">불러오는 중…</p>';
  } else {
    const pts = sliceYears(s.points, s.years);
    const sm = summarize(pts);
    const up = sm.changePct >= 0;
    const months = new Map();
    for (const [d, v] of pts) months.set(d.slice(0, 7), [d, v]);
    const rows = [...months.values()].reverse().map(([d, v]) => `<tr><td>${esc(d.slice(0, 7))}</td><td>${fmtV(v * u)}원</td></tr>`).join('');
    body = `${seg}
      <div class="chart-hero">${u} ${esc(s.code)} = ${fmtV(sm.last[1] * u)}원</div>
      <div class="muted">${esc(shortDay(sm.last[0]))} 기준 · <b class="delta ${up ? 'up' : 'down'}">${up ? '+' : ''}${fmt(sm.changePct, 1)}%</b> (${s.years}년 전 ${fmtV(sm.first[1] * u)}원)</div>
      <div class="chart-wrap" id="chart-wrap"><div class="chart-tip" id="chart-tip" aria-live="polite"></div></div>
      <div class="muted">최저 ${fmtV(sm.min[1] * u)}원 (${esc(shortDay(sm.min[0]))}) · 최고 ${fmtV(sm.max[1] * u)}원 (${esc(shortDay(sm.max[0]))})</div>
      <details class="chart-table"><summary>표로 보기 (달마다 마지막 날)</summary><div class="tbl-wrap"><table class="rates"><tr><th>달</th><th>${u} ${esc(s.code)}</th></tr>${rows}</table></div></details>
      <p class="hint">출처: ECB(유럽중앙은행) 기준환율, 평일 하루 1번. 하나은행 고시·트래블로그 값과 조금 다를 수 있음.${s.peg ? ` ${esc(s.code)} 는 ${esc(s.peg[0])} 고정환율(${esc(s.peg[0])} 1 = ${s.peg[1]} ${esc(s.code)})로 환산.` : ''}${s.fromCache ? ' 저장해 둔 값으로 그림(새로 받지 못함).' : ''}</p>`;
  }
  return `<div class="sheet" role="dialog" aria-label="${esc(info.name)} 원화 대비 차트">
    <div class="sheet-head"><h3>${esc(info.name)} · 원화 기준</h3><button class="btn sm" data-action="sheet-close">닫기</button></div>${body}</div>`;
}

/** 창 그리기(없으면 숨김) */
function renderSheet() {
  if (!sheet) { sheetEl.hidden = true; sheetEl.innerHTML = ''; return; }
  sheetEl.hidden = false;
  if (sheet.type === 'cur') {
    sheetEl.innerHTML = `<div class="sheet" role="dialog" aria-label="통화 찾기">
      <div class="sheet-head"><h3>통화 찾기 · 버튼 편집</h3><button class="btn sm" data-action="sheet-close">닫기</button></div>
      <input id="cur-q" data-action="cur-q" value="${esc(sheet.q)}" placeholder="나라·통화·도시 (예: 멕시코, 페소, 방콕)" autocomplete="off" enterkeyhint="search">
      <div id="cur-results">${curResults(sheet.q)}</div>
      <h2 style="margin-top:14px">환율 탭 버튼</h2>
      <div id="cur-mine">${curMine()}</div>
      <p class="hint">✕ 빼기로 버튼에서 뺌. 지금 여행 통화(${esc(activeTrip().code)})는 빼도 맨 앞에 늘 보임.</p></div>`;
    return;
  }
  sheetEl.innerHTML = chartSheetHtml();
  drawChart();
}

/** 차트 SVG. 폭은 창 폭에 맞춤. 손가락·마우스로 누른 날짜의 값을 보여 주는 세로선 */
function drawChart() {
  const wrap = document.getElementById('chart-wrap');
  const s = /** @type {any} */ (sheet);
  if (!wrap || !s?.points) return;
  const pts = sliceYears(s.points, s.years);
  const u = unitOf(s.code);
  const scaled = pts.map(([d, v]) => /** @type {[string, number]} */ ([d, v * u]));
  const w = Math.max(260, wrap.clientWidth || 320);
  const box = { w, h: 220, left: 46, right: 12, top: 12, bottom: 24 };
  const m = chartModel(scaled, box);
  const step = m.yTicks.length > 1 ? m.yTicks[1].v - m.yTicks[0].v : 1;
  // 눈금 간격이 2.5 면 62.5 처럼 한 자리까지(반올림해 63 으로 보이지 않게)
  const tickDec = Number.isInteger(Number(step.toFixed(6))) ? 0 : Number.isInteger(Number((step * 10).toFixed(6))) ? 1 : 2;
  const grid = m.yTicks.map((t) => `<line class="grid" x1="${box.left}" x2="${w - box.right}" y1="${t.y.toFixed(1)}" y2="${t.y.toFixed(1)}"/><text class="ax" x="${box.left - 6}" y="${(t.y + 4).toFixed(1)}" text-anchor="end">${fmt(t.v, tickDec)}</text>`).join('');
  const xl = m.xTicks.map((t) => `<text class="ax" x="${t.x.toFixed(1)}" y="${box.h - 6}" text-anchor="middle">${esc(t.label)}</text>`).join('');
  const n = m.xs.length - 1;
  wrap.insertAdjacentHTML('beforeend', `<svg id="chart-svg" width="${w}" height="${box.h}" viewBox="0 0 ${w} ${box.h}" role="img" tabindex="0"
    aria-label="${esc(currencyInfo(s.code).name)} ${s.years}년 원화 환율 선 그래프, 처음 ${fmtV(scaled[0][1])}원, 마지막 ${fmtV(scaled[n][1])}원">
    ${grid}${xl}
    <path class="area" d="${m.area}"/><path class="line" d="${m.line}"/>
    <circle class="dot" cx="${m.xs[n].toFixed(1)}" cy="${m.ys[n].toFixed(1)}" r="4"/>
    <line id="chart-cross" class="cross" x1="0" x2="0" y1="${box.top}" y2="${box.h - box.bottom}" visibility="hidden"/>
    <circle id="chart-cdot" class="dot" r="4" visibility="hidden"/>
  </svg>`);
  const svg = /** @type {SVGSVGElement} */ (document.getElementById('chart-svg'));
  const tip = /** @type {HTMLElement} */ (document.getElementById('chart-tip'));
  const cross = svg.querySelector('#chart-cross');
  const cdot = svg.querySelector('#chart-cdot');
  const show = (i) => {
    if (i < 0 || i > n) return;
    s.idx = i;
    const x = m.xs[i];
    cross.setAttribute('x1', x.toFixed(1)); cross.setAttribute('x2', x.toFixed(1)); cross.setAttribute('visibility', 'visible');
    cdot.setAttribute('cx', x.toFixed(1)); cdot.setAttribute('cy', m.ys[i].toFixed(1)); cdot.setAttribute('visibility', 'visible');
    tip.textContent = '';
    const b = document.createElement('b'); b.textContent = `${fmtV(scaled[i][1])}원`;
    const sp = document.createElement('span'); sp.textContent = ` ${shortDay(scaled[i][0])}`;
    tip.append(b, sp);
    tip.style.visibility = 'visible';
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(x - tw / 2, 0), w - tw)}px`;
  };
  // x 로 가장 가까운 점(이분 탐색)
  const nearest = (x) => {
    let lo = 0; let hi = n;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (m.xs[mid] < x) lo = mid; else hi = mid; }
    return x - m.xs[lo] <= m.xs[hi] - x ? lo : hi;
  };
  const onPoint = (e) => {
    const r = svg.getBoundingClientRect();
    show(nearest(((e.clientX - r.left) / r.width) * w));
  };
  svg.addEventListener('pointerdown', onPoint);
  svg.addEventListener('pointermove', onPoint);
  svg.addEventListener('keydown', (e) => {
    const cur = s.idx >= 0 ? s.idx : n;
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(Math.max(0, cur - 1)); }
    if (e.key === 'ArrowRight') { e.preventDefault(); show(Math.min(n, cur + 1)); }
  });
  if (s.idx >= 0 && s.idx <= n) show(s.idx);
}

/**
 * @param {string} code
 * @returns {number} 고시 단위(엔 100, 나머지 1)
 */
function unitOf(code) { const u = currencyInfo(code).unit; return u > 1 ? u : 1; }

/**
 * 숫자를 소수 max 자리까지, 뒤 0 은 떼고 쉼표. 9.2 → "9.2", 18.7512 → "18.7512"
 * @param {number} v
 * @param {number} max
 * @returns {string}
 */
function trimNum(v, max) {
  const r = Number(v.toFixed(max));
  const dec = (String(r).split('.')[1] || '').length;
  return fmt(r, Math.min(dec, max));
}

/**
 * 수동 환율 종류. 그 나라 돈이 왼쪽(Chan 2026-10-17): "멕시코 페소 ? = USD 1달러", "멕시코 페소 1 = 한화 ?원"
 * @param {string} code
 * @param {string} selected 'usdCross' | 'krw'
 * @returns {string}
 */
function manualKindOptions(code, selected) {
  const i = currencyInfo(code);
  return [['usdCross', `${i.name} ? = USD 1달러`], ['krw', `${i.name} ${unitOf(code)} = 한화 ?원`]]
    .map(([v, l]) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${esc(l)}</option>`).join('');
}

/**
 * 트래블로그 미지원 통화(MAD)는 USD 지갑으로 결제하니 달러 기준, 나머지는 원화 기준이 기본.
 * @param {string} code
 * @returns {'usdCross'|'krw'}
 */
function manualDefaultKind(code) { return currencyInfo(code).travlog === 'none' ? 'usdCross' : 'krw'; }

/**
 * 지금 앱이 쓰는 값을 입력칸 예시로. usdCross: 그 통화 몇 개 = 1달러, krw: 고시 단위당 원.
 * @param {string} code
 * @param {string} kind
 * @returns {string}
 */
function manualPlaceholder(code, kind) {
  try {
    const r = krwPerUnit(code, ctx()).rate;
    if (kind === 'usdCross') return String(Number((krwPerUnit('USD', ctx()).rate / r).toFixed(4)));
    return String(Number((r * unitOf(code)).toFixed(2)));
  } catch (e) {
    if (e instanceof RateMissingError) return '';
    throw e;
  }
}

/**
 * 저장하면 어떤 환율이 되는지 미리 보여 줌. 고시와 많이 다르면(1.5배 넘게) 숫자를 거꾸로 넣었는지 경고.
 * @param {string} code
 * @param {string} kind
 * @param {number} v 입력값
 * @returns {string}
 */
function manualPreviewText(code, kind, v) {
  const u = unitOf(code);
  let posted = null;
  try { posted = krwPerUnit(code, { rates, manual: {} }).rate; } catch (e) { if (!(e instanceof RateMissingError)) throw e; }
  const postedTxt = posted ? `고시 ${u} ${code} = ${fmt(posted * u, 2)}원` : '고시 없음';
  if (!(v > 0)) return postedTxt;
  let krw = null;
  if (kind === 'usdCross') {
    try { krw = krwPerUnit('USD', ctx()).rate / v; } catch (e) { if (!(e instanceof RateMissingError)) throw e; }
  } else krw = v / u;
  if (!krw) return '달러 환율이 없어 원화로 못 바꿈';
  const ratio = posted ? krw / posted : 1;
  const warn = ratio > 1.5 || ratio < 1 / 1.5 ? ' 🟡 고시와 차이가 큼, 숫자 확인' : '';
  return `저장하면 ${u} ${code} = ${fmt(krw * u, 2)}원 · ${postedTxt}${warn}`;
}

/**
 * 수동 환율 입력칸이 바뀌면 다시 그리지 않고 라벨·예시·미리보기만 고침(입력 중인 값 유지).
 * @param {'code'|'kind'|'val'} what
 */
function updateManualForm(what) {
  const codeEl = /** @type {HTMLSelectElement|null} */ (document.getElementById('m-code'));
  const kindEl = /** @type {HTMLSelectElement|null} */ (document.getElementById('m-kind'));
  const valEl = /** @type {HTMLInputElement|null} */ (document.getElementById('m-val'));
  const prev = document.getElementById('m-preview');
  if (!codeEl || !kindEl || !valEl || !prev) return;
  const code = codeEl.value;
  if (what === 'code') kindEl.innerHTML = manualKindOptions(code, manualDefaultKind(code));
  if (what !== 'val') valEl.placeholder = manualPlaceholder(code, kindEl.value);
  prev.textContent = manualPreviewText(code, kindEl.value, parseAmount(valEl.value));
}

/** @returns {string} */
function renderSettings() {
  const payOpt = (t) => [['cash', '결제 기본: 현금'], ['card', '결제 기본: 카드']]
    .map(([v, l]) => `<option value="${v}" ${(t.pay === 'card' ? 'card' : 'cash') === v ? 'selected' : ''}>${l}</option>`).join('');
  const trips = state.trips.map((t) => `<div class="trip-set"><div class="row"><input data-action="trip-name" data-id="${esc(t.id)}" value="${esc(t.name)}"><button class="btn sm danger" data-action="trip-delete" data-id="${esc(t.id)}">삭제</button></div>
    <div class="row"><select data-action="trip-code" data-id="${esc(t.id)}">${currencyOptions(t.code)}</select><select data-action="trip-pay" data-id="${esc(t.id)}">${payOpt(t)}</select></div></div>`).join('');
  const favChips = CURRENCIES.filter((c) => c.code !== 'KRW').map((c) => `<button class="chip ${state.favorites.includes(c.code) ? 'on' : ''}" data-action="fav-toggle" data-code="${esc(c.code)}">${esc(c.code)}</button>`).join('');
  const manualRows = [
    ...Object.entries(state.manual.krw).map(([c, v]) => { const u = unitOf(c); return `<div class="kv"><span>${u} ${esc(c)} = 한화 ${fmt(v * u, 2)}원</span><button class="del" data-action="manual-del" data-kind="krw" data-code="${esc(c)}">삭제</button></div>`; }),
    ...Object.entries(state.manual.usdCross).map(([c, v]) => `<div class="kv"><span>${trimNum(v, 4)} ${esc(c)} = USD 1달러</span><button class="del" data-action="manual-del" data-kind="usdCross" data-code="${esc(c)}">삭제</button></div>`),
  ].join('') || '<div class="muted">없음</div>';

  let rateTable = '<div class="muted">환율 데이터 없음</div>';
  if (rates) {
    const codes = [...new Set(['USD', 'CAD', ...state.favorites])].filter((c) => c !== 'KRW');
    const tr = codes.map((c) => {
      try {
        const r = krwPerUnit(c, ctx());
        const unit = r.unit > 1 ? r.unit : 1;
        return `<tr><td>${esc(c)}${unit > 1 ? ` <small>/${unit}</small>` : ''}</td><td>${fmt(r.rate * unit, 2)}</td><td>${r.ttb ? fmt(r.ttb, 2) : '—'}</td><td>${esc(sourceLabel(r.source))}</td></tr>`;
      } catch { return `<tr><td>${esc(c)}</td><td colspan="3" class="warn">없음</td></tr>`; }
    }).join('');
    rateTable = `<div class="tbl-wrap"><table class="rates"><tr><th>통화</th><th>충전가(매매기준)</th><th>환급가</th><th>출처</th></tr>${tr}</table></div>`;
  }
  const log = rateLog.length ? `<ul class="list-plain">${rateLog.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '';

  return `
  <section class="card"><h2>여행</h2>${trips}<p class="hint">새로 적는 항목은 모든 여행에서 현금이 기본. 카드로 주로 쓰는 여행만 "결제 기본: 카드"로 바꾸면 됨.</p><div class="actions"><button class="btn" data-action="trip-new">새 여행</button></div></section>
  <section class="card"><h2>즐겨찾기 통화</h2><div class="chips" style="flex-wrap:wrap;overflow:visible">${favChips}</div></section>
  <section class="card"><h2>트래블로그 앱 환율 맞추기</h2>
    <p class="hint" style="margin:0 0 6px">하나머니 화면의 "USD 1 = 1,359원" 값을 그대로 넣으면 앱 전체(정산 내역 포함)가 그 환율로 계산됨. 더 새 고시가 나오면 자동으로 해제.</p>
    ${travlogRows()}
    <div class="actions"><button class="btn primary" data-action="travlog-save">저장</button>${Object.keys(state.travlog.rates).length ? '<button class="btn sm" data-action="travlog-clear">지우기</button>' : ''}</div>
    <div class="muted" style="margin-top:6px">${travlogStatus()}</div></section>
  <section class="card"><h2>수동 환율 (항상 우선)</h2>${manualRows}
    <div class="row" style="margin-top:8px"><select id="m-code" data-action="manual-code">${currencyOptions(fx.code)}</select></div>
    <div class="row"><select id="m-kind" data-action="manual-kind">${manualKindOptions(fx.code, manualDefaultKind(fx.code))}</select></div>
    <div class="row"><input id="m-val" data-action="manual-val" inputmode="decimal" placeholder="${esc(manualPlaceholder(fx.code, manualDefaultKind(fx.code)))}" autocomplete="off"></div>
    <div id="m-preview" class="muted" style="min-height:1.3em">${esc(manualPreviewText(fx.code, manualDefaultKind(fx.code), 0))}</div>
    <div class="actions"><button class="btn primary" data-action="manual-add">수동 환율 저장</button></div>
    <p class="hint">트래블로그 결제 내역에 찍힌 실제 환율을 넣으면 그 값으로 계산. 예: 모로코 "9.2 MAD = USD 1달러", 멕시코 "1 MXN = 한화 72원".</p></section>
  <section class="card"><h2>같이 쓰기 (두 폰 동기화)</h2>
    ${state.sync.code ? `
    <div class="line" style="display:flex;justify-content:space-between;align-items:center"><span>방 코드</span><span><b style="font-size:1.3rem;letter-spacing:.12em">${esc(state.sync.code)}</b></span></div>
    <div class="muted" style="margin:4px 0">${state.sync.lastAt ? `마지막 동기화 ${esc(shortTime(new Date(state.sync.lastAt).toISOString()))}` : '아직 동기화 안 됨'}${dirtyCount() ? ` · 올릴 것 ${dirtyCount()}건` : ''}${syncError ? ` · <span class="warn">${esc(syncError)}</span>` : ' · <span class="ok">정상</span>'}</div>
    <div class="actions"><button class="btn primary" data-action="sync-now">지금 동기화</button><button class="btn" data-action="sync-copy">코드 복사</button><button class="btn sm danger" data-action="sync-leave">나가기</button></div>
    <p class="hint">저장할 때마다 몇 초 안에 올라가고, 앱을 열거나 화면에 돌아올 때·1분마다 받아옴. 인터넷이 없으면 폰에 두었다가 잡히면 올림. 정산 탭 "공유 링크"에도 이 코드가 들어가서 상대 폰은 링크만 넣으면 됨.</p>` : `
    <p class="hint" style="margin:0 0 6px">한쪽 폰에서 방을 만들고, 다른 폰은 그 코드를 넣으면 내역·지갑·환율이 자동으로 같아짐. 무료(Supabase).</p>
    <div class="actions"><button class="btn primary" data-action="sync-create">방 만들기 (이 폰 내용으로)</button></div>
    <div class="row" style="margin-top:8px"><input id="sync-code" placeholder="방 코드 6자" autocomplete="off" autocapitalize="characters" style="text-transform:uppercase"><button class="btn sm" data-action="sync-join">연결</button></div>`}
  </section>
  <section class="card"><h2>공유 링크로 가져오기</h2>
    <p class="hint" style="margin:0 0 6px">다른 폰에서 만든 "공유 링크"를 여기 붙여 넣으면 정산 항목·현금 지갑·환율이 들어옴. 아이폰 홈 화면 앱은 링크를 눌러도 앱으로 안 열리니 이 칸을 쓸 것.</p>
    <textarea id="share-in" rows="3" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:.85rem" placeholder="https://wnvcks1.github.io/travlog-fx/#import=…"></textarea>
    <div class="actions"><button class="btn primary" data-action="share-import">가져오기</button></div></section>
  <section class="card"><h2>환율 데이터</h2>
    <div class="muted">출처 ${esc(rates ? sourceLabel(rates.source) : '없음')}${rates?.via ? ` (${esc(rates.via)} 경유)` : ''}${rates?.baseDate ? ` · 고시일 ${esc(rates.baseDate)}` : ''} · 수집 ${esc(rates ? shortTime(rates.asof) : '—')}${rates?.round ? ` · ${esc(rates.round)}` : ''}${rates?.filledFrom ? ` · 빈 통화는 ${esc(sourceLabel(rates.filledFrom))}로 보충` : ''}</div>
    ${rateTable}${log}
    <div class="muted">마지막 갱신 ${lastRefreshAt ? esc(shortTime(new Date(lastRefreshAt).toISOString())) : '아직 없음'} · 앱을 열 때·화면에 돌아올 때·30분마다 자동 갱신</div>
    <div class="actions"><button class="btn primary" data-action="rates-refresh">환율 새로고침</button></div>
    <p class="hint">하나은행 고시환율(매매기준율 = 트래블로그 충전가)을 FXCOD 공개 JSON 에서 받음(영업일 하루 3번쯤 갱신). 하나은행에 없는 통화(모로코 디르함 등)는 er-api 의 USD 교차환율, 없거나 오래되면 er-api·ECB 로 대체. 트래블로그 앱에 찍힌 실제 환율과 다르면 위 수동 환율에 넣을 것.</p></section>
  <section class="card"><h2>환급 손실 계산</h2>
    <div class="row"><input id="rf-amt" inputmode="decimal" placeholder="남은 외화"><select id="rf-code" style="flex:0 0 46%">${currencyOptions('JPY')}</select></div>
    <div class="actions"><button class="btn" data-action="refund-calc">계산</button></div>
    <div id="rf-out" class="muted"></div>
    <div class="row" style="margin-top:8px"><label>환급 수수료 %</label><input data-action="set-fee" value="${esc(state.settings.refundFeePct)}" inputmode="decimal"></div>
    <div class="row"><label>오래됨 기준(시간)</label><input data-action="set-stale" value="${esc(state.settings.staleHours)}" inputmode="numeric"></div>
</section>
  <section class="card"><h2>홈 화면에 앱으로 설치</h2>
    ${installEvt ? '<div class="actions"><button class="btn primary" data-action="install">홈 화면에 추가</button></div>' : '<p class="muted">크롬 메뉴(⋮) → "홈 화면에 추가" 또는 "앱 설치". 이미 설치했으면 이 안내는 무시.</p>'}
  </section>
  <section class="card"><h2>데이터</h2>
    <div class="actions"><button class="btn" data-action="export">내보내기(JSON)</button><button class="btn" data-action="import">가져오기</button></div>
    <input id="import-file" type="file" accept="application/json" style="display:none" data-action="import-file">
    <div class="actions"><button class="btn danger" data-action="reset">전체 초기화</button><button class="btn" data-action="app-update">앱 업데이트</button></div>
    <p class="hint">빌드 ${esc(BUILD.startsWith('__') ? 'dev' : BUILD)} · 데이터는 이 폰 브라우저 안에만 저장됨. 폰을 바꾸면 내보내기로 옮길 것.</p></section>`;
}

/* ───────────── 이벤트 ───────────── */

/**
 * @param {string} name
 * @param {string} code
 */
function newTrip(name, code) {
  const id = `t${Date.now().toString(36)}`;
  state.trips.push({ id, name: name.trim() || '새 여행', code: code || 'USD', items: [] });
  state.activeTrip = id;
  draft.code = code || 'USD';
  persist();
}

/**
 * 환율 갱신. silent 면 토스트 없이 조용히. 하나은행 값을 못 받았으면 20초 뒤 한 번 더 시도(모로코처럼 느린 망 대비).
 * @param {{silent?:boolean, retry?:boolean}} [opts]
 */
async function refreshRates(opts = {}) {
  if (refreshing) return;
  refreshing = true;
  badgeEl.style.opacity = '0.5';
  if (!opts.silent) toast('환율 받는 중…');
  try {
    const { rates: r, log } = await loadRates({ cache: state.ratesCache, timeoutMs: 20000 });
    rateLog = log;
    logger.info('rates', log);
    if (r) {
      rates = r;
      state.ratesCache = r;
      lastRefreshAt = Date.now();
      persist();
      if (!opts.silent) toast(`환율 갱신 · ${sourceLabel(r.source)} ${shortTime(r.asof)}`);
    } else if (!opts.silent) {
      toast('환율을 못 받음. 수동 환율로 계산');
    }
    if (!opts.retry && (!r || r.source !== 'hana')) {
      window.setTimeout(() => { refreshRates({ silent: true, retry: true }).catch((e) => logger.warn(e)); }, 20000);
    }
  } finally {
    refreshing = false;
    badgeEl.style.opacity = '';
    render();
  }
}

/**
 * @param {HTMLElement} el
 */
async function onClick(el) {
  const a = el.dataset.action;
  const d = el.dataset;
  switch (a) {
    case 'fx-code': setFxCode(d.code); persist(); render(); break;
    case 'fx-more': {
      sheet = { type: 'cur', q: '' };
      renderSheet();
      document.getElementById('cur-q')?.focus();
      break;
    }
    case 'sheet-close': sheet = null; renderSheet(); break;
    case 'cur-pick': {
      const c = d.code;
      if (!c) return;
      if (!state.favorites.includes(c)) state.favorites.unshift(c);
      setFxCode(c); state.ui.tab = 'fx';
      sheet = null; renderSheet();
      persist(); render(); break;
    }
    case 'cur-del': {
      const c = d.code;
      state.favorites = state.favorites.filter((x) => x !== c);
      // 보던 통화를 빼면 바로 전에 보던 통화로(Chan 2026-10-21: 빼도 화면에 남아 있다가 다른 통화를 눌러야 사라졌음)
      let back = '';
      if (fx.code === c && !fxChipCodes().includes(c)) { back = fallbackFxCode(c); setFxCode(back); }
      fx.prev = fx.prev.filter((x) => x !== c);
      persist(); render(); updateCurSheet(); toast(back ? `${c} 버튼을 뺌 → ${back} 보는 중` : `${c} 버튼을 뺌`); break;
    }
    case 'chart-open': openChart(d.code || fx.code); break;
    case 'chart-range': if (sheet?.type === 'chart') { sheet.years = Number(d.years) || 5; sheet.idx = -1; renderSheet(); } break;
    case 'fx-key': {
      const k = d.key;
      if (k === 'back') {
        // 입력 중인 값이 없으면 마지막 '+' 를 되돌림
        if (fx.input) fx.input = fx.input.slice(0, -1);
        else if (fx.terms.length) fx.input = String(fx.terms.pop());
      } else if (k === '+') {
        if (fx.input && parseAmount(fx.input) > 0 && fx.terms.length < 50) { fx.terms.push(parseAmount(fx.input)); fx.input = ''; }
      } else if (k === '.') { if (!fx.input.includes('.')) fx.input = (fx.input || '0') + '.'; }
      else if (fx.input.replace('.', '').length < 12) fx.input = fx.input === '0' ? k : fx.input + k;
      render(); break;
    }
    case 'fx-clear': fx.input = ''; fx.terms = []; render(); break;
    case 'fx-add': {
      const amt = Math.round(fxTotal() * 100) / 100;
      if (!(amt > 0)) { toast('금액을 먼저 넣어 줘'); return; }
      draft = { payer: draft.payer, desc: '', amount: String(amt), code: fx.code, forWho: '', pay: '', date: '' };
      fx.input = ''; fx.terms = [];
      editingId = null;
      state.ui.tab = 'settle'; persist(); render();
      break;
    }
    case 'draft-payer': draft.payer = d.payer; render(); break;
    case 'draft-for': draft.forWho = d.for || ''; render(); break;
    case 'draft-pay': draft.pay = d.pay; render(); break;
    case 'paste-open': pasteBox = { text: '', items: [], skipped: [], warnings: [] }; render(); document.getElementById('paste-text')?.focus(); break;
    case 'paste-close': pasteBox = null; render(); break;
    case 'paste-preview': {
      const text = /** @type {HTMLTextAreaElement} */ (document.getElementById('paste-text')).value;
      const r = parseLedger(text, state.people, activeTrip().code, state.initials);
      pasteBox = { text, ...r };
      render(); break;
    }
    case 'paste-add': {
      if (!pasteBox || !pasteBox.items.length) return;
      const { added, failed } = addItems(activeTrip(), pasteBox.items);
      pasteBox = null; persist(); render();
      toast(`${added}건 추가${failed.length ? ` · ${failed.length}건 실패` : ''}`); break;
    }
    case 'draft-save': saveDraft(); break;
    case 'draft-cancel': editingId = null; draft = { payer: draft.payer, desc: '', amount: '', code: draft.code, forWho: '', pay: '', date: '' }; render(); break;
    case 'item-edit': {
      const it = activeTrip().items.find((x) => x.id === d.id);
      if (!it) return;
      editingId = it.id;
      draft = { payer: it.payer, desc: it.desc, amount: String(it.amount), code: it.code, forWho: it.forWho || '', pay: it.pay || '', date: Number.isFinite(it.ts) ? localDay(it.ts) : '' };
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      break;
    }
    case 'item-delete': {
      const trip = activeTrip();
      removeItems(trip, (x) => x.id === editingId);
      editingId = null; draft = { payer: draft.payer, desc: '', amount: '', code: draft.code, forWho: '', pay: '', date: '' };
      persist(); render(); toast('삭제함'); break;
    }
    case 'cash-add': {
      const person = /** @type {HTMLSelectElement} */ (document.getElementById('c-person')).value;
      const code = /** @type {HTMLSelectElement} */ (document.getElementById('c-code')).value;
      const amount = parseAmount(/** @type {HTMLInputElement} */ (document.getElementById('c-amount')).value);
      if (!(amount > 0)) { toast('금액을 넣어 줘'); return; }
      state.cash.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, person, code, amount, ts: Date.now(), note: '' });
      persist(); render(); toast(`${person} ${fmt(amount, 2)} ${code} 넣음`); break;
    }
    case 'cash-del': {
      const c = state.cash.find((x) => x.id === d.id);
      if (!c || !window.confirm(`${c.person} ${fmt(c.amount, 2)} ${c.code} 을 지울까?`)) return;
      state.cash = state.cash.filter((x) => x.id !== d.id);
      persist(); render(); break;
    }
    case 'items-dedupe': {
      // 바로 지우지 않고 확인 창: 무엇이 같은지 보여 주고 남길 것을 고르게 함
      const groups = duplicateGroups(activeTrip().items, state.dupOk);
      if (!groups.length) return;
      dedupe = { keep: new Set(groups.flatMap((g) => g.items.filter((r) => r.keep).map((r) => r.it.id))) };
      render(); break;
    }
    case 'dup-toggle': {
      if (!dedupe) return;
      const g = duplicateGroups(activeTrip().items, state.dupOk).find((x) => x.items.some((r) => r.it.id === d.id));
      if (!g) return;
      if (dedupe.keep.has(d.id)) {
        // 묶음에서 하나는 남아야 함 (전부 지우려면 항목을 눌러 따로 삭제)
        if (g.items.filter((r) => dedupe.keep.has(r.it.id)).length <= 1) { toast('하나는 남겨야 함'); return; }
        dedupe.keep.delete(d.id);
      } else dedupe.keep.add(d.id);
      render(); break;
    }
    case 'dup-one':
    case 'dup-all': {
      if (!dedupe) return;
      const g = duplicateGroups(activeTrip().items, state.dupOk)[Number(d.g)];
      if (!g) return;
      g.items.forEach((r, i) => { if (a === 'dup-all' || i === 0) dedupe.keep.add(r.it.id); else dedupe.keep.delete(r.it.id); });
      render(); break;
    }
    case 'dup-noop': break; // 창 안 빈 곳을 눌러도 배경(닫기)으로 안 넘어가게
    case 'dup-cancel': dedupe = null; render(); break;
    case 'dup-apply': {
      if (!dedupe) return;
      const trip = activeTrip();
      const groups = duplicateGroups(trip.items, state.dupOk);
      const ids = new Set(groups.flatMap((g) => g.items.map((r) => r.it.id)));
      const n = removeItems(trip, (it) => ids.has(it.id) && !dedupe.keep.has(it.id));
      // 둘 이상 남긴 묶음은 '중복 아님'으로 기억 → 다음부터 안 물어봄 (새로 같은 게 또 들어오면 다시 물음)
      let kept = 0;
      for (const g of groups) {
        const k = g.items.filter((r) => dedupe.keep.has(r.it.id)).map((r) => r.it.id);
        if (k.length > 1) { state.dupOk.push(...k); kept += 1; }
      }
      state.dupOk = [...new Set(state.dupOk)].slice(-5000);
      dedupe = null; editingId = null; persist(); render();
      toast(n ? `${n}건 지움${kept ? ` · ${kept}묶음은 둘 다 남김` : ''}` : '모두 남김 · 다음부터 안 물어봄');
      break;
    }
    case 'items-clear': {
      const trip = activeTrip();
      if (!trip.items.length || !window.confirm(`"${trip.name}" 내역 ${trip.items.length}건을 전부 지울까? 되돌릴 수 없음.${state.sync.code ? ' 같이 쓰는 폰에서도 지워짐.' : ''}`)) return;
      removeItems(trip, () => true); editingId = null; persist(); render(); toast('내역을 비움'); break;
    }
    case 'settle-share': {
      const url = buildShareLink();
      const n = activeTrip().items.length;
      if (navigator.share) {
        try { await navigator.share({ title: `${activeTrip().name} 정산 ${n}건`, text: `${activeTrip().name} 정산 ${n}건 (환율·정산 앱)`, url }); return; }
        catch (e) { if (e && e.name === 'AbortError') return; }
      }
      try { toast((await copyText(url)) ? `공유 링크 복사함 (${n}건). 카톡에 붙여 넣기` : '복사 실패'); }
      catch (e) { toast(`복사 실패: ${e.message}`); }
      break;
    }
    case 'sync-create': {
      if (!window.confirm('이 폰 내용으로 방을 만들까? 상대 폰은 코드만 넣으면 됨.')) return;
      await createRoom(); break;
    }
    case 'sync-join': {
      const v = /** @type {HTMLInputElement} */ (document.getElementById('sync-code'))?.value || '';
      await joinRoom(v); break;
    }
    case 'sync-now': { const ok = await syncNow(); toast(ok ? '동기화 완료' : `동기화 실패${syncError ? `: ${syncError}` : ''}`); render(); break; }
    case 'sync-copy': {
      try { toast((await copyText(state.sync.code)) ? `코드 ${state.sync.code} 복사함` : '복사 실패'); } catch (e) { toast(`복사 실패: ${e.message}`); }
      break;
    }
    case 'sync-leave': {
      if (!window.confirm(`방 ${state.sync.code} 에서 나갈까? 이 폰의 내역은 그대로 남고, 이후 변경은 서로 안 넘어감.`)) return;
      state.sync = { code: '', lastAt: 0, metaRev: state.sync.metaRev }; state.tombstones = [];
      for (const t of state.trips) for (const it of t.items) delete it.dirty;
      saveState(state); render(); break;
    }
    case 'share-import': {
      const ta = /** @type {HTMLTextAreaElement} */ (document.getElementById('share-in'));
      if (!ta || !ta.value.trim()) { toast('링크를 붙여 넣어 줘'); return; }
      if (await importFromText(ta.value)) ta.value = '';
      break;
    }
    case 'settle-copy': {
      try { toast((await copyText(summaryText())) ? '복사함. 노션·카톡에 붙여 넣기' : '복사 실패'); }
      catch (e) { toast(`복사 실패: ${e.message}`); }
      break;
    }
    case 'trip-new': {
      const name = window.prompt('여행 이름 (예: 중국, 일본, 다낭)', '');
      if (name === null || !name.trim()) return;
      // 이름으로 통화 추정(중국 → CNY). 비워 두거나 모르는 값이면 추정값, 추정도 안 되면 USD
      const guess = findCurrency(name) || 'USD';
      const raw = window.prompt('기본 통화 (코드나 이름. 예: CNY, 위안, JPY, 엔)', guess);
      if (raw === null) return;
      const code = findCurrency(raw) || guess;
      newTrip(name, code);
      fx.code = tripFxCode(); fx.input = ''; fx.terms = [];
      render(); toast(`'${name.trim()}' 여행 · 기본 통화 ${code}. 설정 → 여행에서 바꿀 수 있음`); break;
    }
    case 'trip-delete': {
      const t = state.trips.find((x) => x.id === d.id);
      if (!t) return;
      if (state.trips.length === 1) { toast('여행은 하나는 있어야 함'); return; }
      if (!window.confirm(`"${t.name}" 와 내역 ${t.items.length}건을 지울까?`)) return;
      state.trips = state.trips.filter((x) => x.id !== d.id);
      if (state.activeTrip === d.id) state.activeTrip = state.trips[0].id;
      persist(); render(); break;
    }
    case 'fav-toggle': {
      const c = d.code;
      state.favorites = state.favorites.includes(c) ? state.favorites.filter((x) => x !== c) : [...state.favorites, c];
      persist(); render(); break;
    }
    case 'manual-add': {
      const code = /** @type {HTMLSelectElement} */ (document.getElementById('m-code')).value;
      const kind = /** @type {HTMLSelectElement} */ (document.getElementById('m-kind')).value;
      const v = parseAmount(/** @type {HTMLInputElement} */ (document.getElementById('m-val')).value);
      if (!(v > 0)) { toast('값을 넣어 줘'); return; }
      state.manual[kind][code] = kind === 'krw' ? v / unitOf(code) : v;
      const n = resnapshotItems(code);
      persist(); render(); toast(`${code} 수동 환율 저장${n ? ` · 내역 ${n}건 다시 계산` : ''}`); break;
    }
    case 'travlog-save': {
      const inputs = [...document.querySelectorAll('[data-action="travlog-val"]')];
      const next = {};
      for (const inp of inputs) {
        const code = /** @type {HTMLInputElement} */ (inp).dataset.code;
        const v = parseAmount(/** @type {HTMLInputElement} */ (inp).value);
        if (v > 0) next[code] = v / (currencyInfo(code).unit || 1);
      }
      if (!Object.keys(next).length) { toast('값을 하나 이상 넣어 줘'); return; }
      state.travlog = { rates: next, at: todayStr() };
      let n = 0;
      const codes = new Set(Object.keys(next));
      // USD 가 바뀌면 USD 교차로 계산되는 통화(MAD 등)도 같이
      if (codes.has('USD')) for (const t of state.trips) for (const it of t.items) if (it.source === 'cross' || it.source === 'manual-cross') codes.add(it.code);
      for (const c of codes) n += resnapshotItems(c);
      persist(); render(); toast(`트래블로그 환율 저장${n ? ` · 내역 ${n}건 다시 계산` : ''}`); break;
    }
    case 'travlog-clear': {
      const codes = new Set(Object.keys(state.travlog.rates));
      for (const t of state.trips) for (const it of t.items) if (it.source === 'travlog' || it.source === 'cross' || it.source === 'manual-cross') codes.add(it.code);
      state.travlog = { rates: {}, at: null };
      let n = 0;
      for (const c of codes) n += resnapshotItems(c);
      persist(); render(); toast(`지움${n ? ` · 내역 ${n}건 다시 계산` : ''}`); break;
    }
    case 'manual-del': {
      delete state.manual[d.kind][d.code];
      const n = resnapshotItems(d.code);
      persist(); render(); if (n) toast(`내역 ${n}건 다시 계산`); break;
    }
    case 'rates-refresh': await refreshRates(); break;
    case 'install': {
      if (!installEvt) return;
      installEvt.prompt();
      const r = await installEvt.userChoice.catch(() => null);
      logger.info('install', r);
      installEvt = null; render(); break;
    }
    case 'refund-calc': {
      const amt = parseAmount(/** @type {HTMLInputElement} */ (document.getElementById('rf-amt')).value);
      const code = /** @type {HTMLSelectElement} */ (document.getElementById('rf-code')).value;
      const out = document.getElementById('rf-out');
      if (!out) return;
      try {
        const r = refundLoss(amt, code, ctx(), { feePct: state.settings.refundFeePct });
        out.innerHTML = `충전가 기준 ${fmt(r.midKrw)}원 → 환급 ${fmt(r.refundKrw)}원. 손실 <b class="warn">${fmt(r.lossKrw)}원</b> (스프레드 ${fmt(r.spreadKrw)} + 수수료 ${fmt(r.feeKrw)})`;
      } catch (e) { out.innerHTML = `<span class="err">${esc(e.message)}</span>`; }
      break;
    }
    case 'export': {
      const blob = new Blob([exportJson(state)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const aEl = document.createElement('a');
      aEl.href = url; aEl.download = `travlog-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(aEl); aEl.click(); aEl.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      break;
    }
    case 'import': document.getElementById('import-file')?.click(); break;
    case 'reset': {
      if (!window.confirm('내역·설정을 전부 지울까? 되돌릴 수 없음')) return;
      Object.assign(state, defaultState());
      persist(); draft = { payer: state.people[0], desc: '', amount: '', code: '', forWho: '', pay: '', date: '' }; render(); break;
    }
    case 'app-update': {
      try {
        const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
        await Promise.all(regs.map((r) => r.unregister()));
        const keys = await caches?.keys?.() || [];
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (e) { logger.warn('캐시 정리 실패', e); }
      window.location.reload();
      break;
    }
    default: break;
  }
}

/**
 * @param {HTMLInputElement|HTMLSelectElement} el
 */
function onInput(el) {
  const a = el.dataset.action;
  const d = el.dataset;
  switch (a) {
    case 'draft-desc': draft.desc = el.value; break;
    case 'draft-amount': draft.amount = el.value; break;
    case 'draft-code': draft.code = el.value; break;
    case 'draft-date': draft.date = el.value; break;
    case 'trip-select': state.activeTrip = el.value; draft.code = activeTrip().code; editingId = null; fx.code = tripFxCode(); fx.input = ''; fx.terms = []; persist(); render(); break;
    case 'set-person': {
      const i = Number(d.i);
      const old = state.people[i];
      const nv = el.value.trim();
      if (!nv || state.people.includes(nv)) return;
      state.people[i] = nv;
      if (draft.payer === old) draft.payer = nv;
      for (const t of state.trips) for (const it of t.items) {
        if (it.payer === old) { it.payer = nv; touch(it); }
        if (it.forWho === old) { it.forWho = nv; touch(it); }
      }
      persist(); break;
    }
    case 'set-initial': { state.initials[Number(d.i)] = el.value.trim(); persist(); break; }
    case 'set-ratio': {
      const v = parseAmount(el.value);
      if (v >= 0) { state.ratio[Number(d.i)] = v; persist(); }
      break;
    }
    case 'trip-name': { const t = state.trips.find((x) => x.id === d.id); if (t) { t.name = el.value; persist(); } break; }
    case 'manual-code': updateManualForm('code'); break;
    case 'manual-kind': updateManualForm('kind'); break;
    case 'manual-val': updateManualForm('val'); break;
    case 'trip-pay': {
      const t = state.trips.find((x) => x.id === d.id);
      if (!t) break;
      if (el.value === 'card') t.pay = 'card'; else if (t.pay === 'card') delete t.pay;
      persist(); break;
    }
    case 'trip-code': {
      const t = state.trips.find((x) => x.id === d.id);
      if (!t) break;
      const prev = activeTrip().code;
      t.code = el.value;
      followTripCurrency(prev);
      persist(); break;
    }
    case 'set-fee': { const v = parseAmount(el.value); if (v >= 0) { state.settings.refundFeePct = v; persist(); } break; }
    case 'set-stale': { const v = parseAmount(el.value); if (v > 0) { state.settings.staleHours = v; persist(); } break; }
    case 'import-file': {
      const f = /** @type {HTMLInputElement} */ (el).files?.[0];
      if (!f) return;
      f.text().then((txt) => {
        const s = importJson(txt);
        Object.assign(state, s);
        persist(); render(); toast('가져옴');
      }).catch((e) => toast(`가져오기 실패: ${e.message}`));
      break;
    }
    default: break;
  }
}

view.addEventListener('click', (e) => {
  const el = /** @type {HTMLElement|null} */ (e.target instanceof Element ? e.target.closest('[data-action]') : null);
  if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
  onClick(el).catch((err) => { logger.error(err); toast(`오류: ${err.message}`); });
});
view.addEventListener('input', (e) => {
  const el = e.target;
  if (el instanceof HTMLInputElement && el.dataset.action && el.dataset.action !== 'import-file') onInput(el);
});
view.addEventListener('change', (e) => {
  const el = e.target;
  if ((el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && el.type === 'file')) && el.dataset.action) onInput(el);
});
view.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target instanceof HTMLInputElement && (e.target.id === 'd-amount' || e.target.id === 'd-desc')) {
    e.preventDefault(); saveDraft();
  }
});
sheetEl.addEventListener('click', (e) => {
  if (e.target === sheetEl) { sheet = null; renderSheet(); return; }
  const el = e.target instanceof Element ? e.target.closest('[data-action]') : null;
  if (el && !(el instanceof HTMLInputElement)) onClick(/** @type {HTMLElement} */ (el)).catch((err) => logger.error(err));
});
sheetEl.addEventListener('input', (e) => {
  const el = e.target;
  if (el instanceof HTMLInputElement && el.dataset.action === 'cur-q' && sheet?.type === 'cur') { sheet.q = el.value; updateCurSheet(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet) { sheet = null; renderSheet(); } });
tabs.addEventListener('click', (e) => {
  const b = e.target instanceof Element ? e.target.closest('button[data-tab]') : null;
  if (!b) return;
  state.ui.tab = /** @type {HTMLElement} */ (b).dataset.tab || 'fx';
  persist(); render();
  window.scrollTo(0, 0);
});

/* ───────────── 시작 ───────────── */

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvt = e;
  if (state.ui.tab === 'settings') render();
});
if (!draft.code) draft.code = activeTrip().code;
render();
refreshRates({ silent: true }).then(() => applyHashImport()).then(() => syncNow({ quiet: true })).catch((e) => logger.error('환율 로딩 실패', e));
// 앱이 이미 열려 있는 상태에서 가져오기 링크를 누르면 주소만 바뀌고 새로 안 뜸 → 그때도 처리
window.addEventListener('hashchange', () => { applyHashImport().catch((e) => logger.error('가져오기 실패', e)); });

/** @type {ServiceWorkerRegistration|null} */
let swReg = null;
let pendingReload = false;
let resumedAt = STARTED_AT;

/** @returns {boolean} 적다 만 게 없음(새로고침해도 잃을 게 없음) */
function appIdle() {
  const focused = document.activeElement?.matches?.('input, textarea, select');
  return !fx.input && !fx.terms.length && !sheet && !editingId && !draft.amount && !draft.desc && !focused;
}

/** 새 버전이 받아져 있고 적던 게 없으면 새로고침해서 적용 */
function applyUpdateIfIdle() {
  if (pendingReload && appIdle()) window.location.reload();
}

// 자동 갱신: 화면에 돌아왔을 때(10분 지났으면), 온라인 복귀, 30분마다
document.addEventListener('visibilitychange', () => {
  // 안드로이드 홈 화면 앱은 다시 열어도 새로 안 뜸 → 내려갈 때 새 버전 적용, 올라올 때 새 버전 확인
  if (document.hidden) { applyUpdateIfIdle(); return; }
  resumedAt = Date.now();
  swReg?.update().catch(() => {});
  if (Date.now() - lastRefreshAt > 10 * 60 * 1000) refreshRates({ silent: true }).catch((e) => logger.warn(e));
  if (state.sync.code) syncNow({ quiet: true }).catch(() => {});
});
window.addEventListener('online', () => { refreshRates({ silent: true }).catch((e) => logger.warn(e)); syncNow({ quiet: true }).catch(() => {}); });
window.setInterval(() => { if (!document.hidden) refreshRates({ silent: true }).catch((e) => logger.warn(e)); }, 30 * 60 * 1000);
window.setInterval(() => { if (!document.hidden && state.sync.code) syncNow({ quiet: true }).catch(() => {}); }, 60 * 1000);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  let firstClaim = !navigator.serviceWorker.controller; // 첫 설치의 claim 은 업데이트가 아님
  // 새 버전 서비스워커가 자리를 잡으면: 열거나 돌아온 직후(20초)이고 적던 게 없으면 바로 새로고침.
  // 쓰는 중이면 안내만 하고, 앱을 내릴 때(적던 게 없으면) 적용
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (firstClaim) { firstClaim = false; return; }
    if (pendingReload) return;
    pendingReload = true;
    if (document.hidden || Date.now() - resumedAt < 20000) applyUpdateIfIdle();
    toast('새 버전 준비됨. 앱을 내렸다 다시 열면 적용');
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    swReg = reg;
    reg.update().catch(() => {});
  }).catch((e) => logger.warn('SW 등록 실패', e));
}
