/**
 * 트래블로그 환율·정산 PWA UI. 빌드 없이 브라우저 ES module 로 바로 실행.
 * 상태는 store.js(localStorage), 계산은 calc.js, 환율 로딩은 rates.js.
 */
import { CURRENCIES, currencyInfo } from './currencies.js';
import { krwPerUnit, settle, fmt, refundLoss, RateMissingError } from './calc.js';
import { loadState, saveState, exportJson, importJson, defaultState } from './store.js';
import { loadRates, hoursOld, sourceLabel } from './rates.js';
import { parseLedger, decodeImport } from './importer.js';

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
const fx = { input: '', code: state.ui.code || 'MAD' };
/** @type {any} */
let installEvt = null;
/** @type {string|null} */
let editingId = null;
let draft = { payer: state.people[0], desc: '', amount: '', code: '', forWho: '' };
/** @type {{text:string, items:any[], skipped:string[], warnings:string[]}|null} */
let pasteBox = null;

const view = /** @type {HTMLElement} */ (document.getElementById('view'));
const tabs = /** @type {HTMLElement} */ (document.getElementById('tabs'));
const titleEl = /** @type {HTMLElement} */ (document.getElementById('title'));
const badgeEl = /** @type {HTMLElement} */ (document.getElementById('rate-badge'));
const toastEl = /** @type {HTMLElement} */ (document.getElementById('toast'));

/** @returns {{rates:object|null, manual:object}} */
function ctx() { return { rates, manual: state.manual }; }
function persist() { if (!saveState(state)) logger.warn('localStorage 저장 실패'); }

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
 * @param {string} code
 * @returns {string}
 */
function travlogPill(code) {
  const t = currencyInfo(code).travlog;
  if (t === 'always') return '<span class="pill">무료환전</span>';
  if (t === 'event') return '<span class="pill">무료환전·이벤트</span>';
  if (code === 'KRW') return '';
  return '<span class="pill">USD 지갑 결제</span>';
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
  const code = fx.code;
  const info = currencyInfo(code);
  const amt = parseAmount(fx.input);
  const favs = state.favorites.includes(code) ? state.favorites : [code, ...state.favorites];
  const chips = favs.map((c) => `<button class="chip ${c === code ? 'on' : ''}" data-action="fx-code" data-code="${esc(c)}">${esc(c)}</button>`).join('')
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
    if (code !== 'KRW') lines.push(`<b>${esc(per(code))}</b> · ${badgeHtml()}`);
    if (unsupported(code)) {
      // 미지원 통화는 USD 지갑에서 빠짐: 교차 → USD 금액 → 원화, 단계마다 한 줄
      lines.push(`USD 1 = ${fmt(crossOf(code) || 0, 2)} ${esc(code)} (${crossLabel(code)}) · USD 지갑에서 결제`);
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
  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', 'back'];
  const keypad = keys.map((k) => (k === 'back'
    ? '<button class="key fn" data-action="fx-key" data-key="back" aria-label="지우기">⌫</button>'
    : `<button class="key" data-action="fx-key" data-key="${k}">${k}</button>`)).join('');
  return `
  <section class="card">
    <div class="chips">${chips}</div>
    <div class="muted">${esc(info.name)} 입력 ${travlogPill(code)}</div>
    <div class="amount"><span class="num">${displayInput(fx.input)}</span><span class="unit">${esc(code === 'KRW' ? '원' : code)}</span></div>
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
    <p class="hint">줄 맨 앞 초성(${state.people.map((p, i) => `${esc(state.initials[i] || chosungOf(p))}=${esc(p)}`).join(', ')})이 낸 사람. 초성은 설정에서 바꿈. 단위 없으면 ${esc(trip.code)}. 원·달러·유로 단위는 그대로 읽음.</p>
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
      krw: Math.round(it.amount * r.rate), rate: r.rate, source: r.source,
      ...(it.forWho ? { forWho: it.forWho } : {}), ...(it.note ? { note: it.note } : {}),
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
  let p;
  try { p = decodeImport(m[1]); } catch (e) { toast(`가져오기 링크 오류: ${e.message}`); return; }
  history.replaceState(null, '', location.pathname + location.search);
  const tripName = p.trip?.name || '여행';
  const hasAny = state.trips.some((t) => t.items.length > 0);
  // 같은 링크를 두 번 누르면 항목이 두 벌 들어감. 내역이 있을 때는 한 번 가져온 링크를 막음
  const key = `${m[1].length}:${m[1].slice(0, 32)}:${m[1].slice(-32)}`;
  if (state.imports.includes(key) && hasAny) { toast('이미 가져온 링크라 건너뜀. 다시 넣으려면 내역을 먼저 지울 것'); return; }
  if (!window.confirm(`${p.items.length}건을 '${tripName}' 정산에 추가할까?`)) return;
  state.imports = [...state.imports.filter((k) => k !== key), key].slice(-20);
  if (Array.isArray(p.people) && p.people.length === state.people.length && !hasAny) {
    state.people = [...p.people];
    draft.payer = state.people[0];
  }
  for (const [kind, map] of Object.entries(p.manual || {})) {
    if (!state.manual[kind]) continue;
    for (const [code, v] of Object.entries(map)) if (!(state.manual[kind][code] > 0) && v > 0) state.manual[kind][code] = v;
  }
  let trip = state.trips.find((t) => t.name === tripName);
  if (!trip) {
    // 비어 있는 기본 여행('여행 1')이 있으면 새로 만들지 않고 그 자리를 씀
    const empty = state.trips.find((t) => t.items.length === 0 && /^여행 \d+$/.test(t.name));
    if (empty) { empty.name = tripName; empty.code = p.trip?.code || empty.code; trip = empty; }
    else { newTrip(tripName, p.trip?.code || 'USD'); trip = activeTrip(); }
  }
  state.activeTrip = trip.id;
  draft.code = trip.code;
  if (!rates) { await refreshRates({ silent: true }).catch(() => {}); }
  const list = p.items.map((it) => ({
    payer: state.people[it.p] ?? String(it.p), desc: it.d, amount: it.a, code: it.c,
    ...(it.f !== undefined && it.f !== null ? { forWho: state.people[it.f] } : {}), ...(it.n ? { note: it.n } : {}),
  }));
  const { added, failed } = addItems(trip, list);
  persist();
  state.ui.tab = 'settle';
  render();
  toast(`${added}건 추가${failed.length ? ` · ${failed.length}건 실패(환율 없음)` : ''}`);
  if (failed.length) logger.warn('가져오기 실패', failed);
}

/** @returns {string} */
function renderSettle() {
  const trip = activeTrip();
  if (!draft.code) draft.code = trip.code || 'MAD';
  const items = [...trip.items].sort((a, b) => b.ts - a.ts);
  const tripSel = `<select data-action="trip-select">${state.trips.map((t) => `<option value="${esc(t.id)}" ${t.id === trip.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>`;
  const payerBtns = state.people.map((p) => `<button class="${draft.payer === p ? 'on' : ''}" data-action="draft-payer" data-payer="${esc(p)}">${esc(p)}</button>`).join('');
  const form = `
  <section class="card">
    <div class="row"><label>여행</label>${tripSel}<button class="btn sm" data-action="trip-new">새 여행</button></div>
    <div class="row"><label>낸 사람</label><div class="payer" style="flex:1">${payerBtns}</div></div>
    <div class="row"><label>몫</label><div class="payer" style="flex:1">${[['', '같이'], ...state.people.map((p) => [p, `${p} 개인`])].map(([v, l]) => `<button class="${(draft.forWho || '') === v ? 'on' : ''}" data-action="draft-for" data-for="${esc(v)}">${esc(l)}</button>`).join('')}</div></div>
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

  const rows = items.map((it) => {
    const i = currencyInfo(it.code);
    const sub = [it.forWho ? `<b>${esc(it.forWho)} 개인</b>` : '', it.note ? esc(it.note) : ''].filter(Boolean).join(' · ');
    // 메인은 실제로 낸 통화·금액(노션 메모 그대로). 원화·캐달은 환산값이라 작게
    const main = it.code === 'KRW' ? `${fmt(it.amount)}원` : `${fmt(it.amount, i.dec)} ${esc(it.code)}`;
    const conv = it.code === 'KRW' ? `${cadOf(it.krw)} 캐달` : `${fmt(it.krw)}원 · ${cadOf(it.krw)} 캐달`;
    return `<div class="item" data-action="item-edit" data-id="${esc(it.id)}">
      <span class="who">${esc(it.payer)}</span>
      <div class="mid"><div class="desc">${esc(it.desc || '(내용 없음)')}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
      <div class="amt"><b>${main}</b><small>${conv}</small></div>
    </div>`;
  }).join('');
  const dupes = duplicateCount(trip);
  const dupeBtn = dupes ? `<div class="actions"><button class="btn sm danger" data-action="items-dedupe">같은 항목 ${dupes}건 중복 정리</button></div>` : '';
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
      <div class="actions"><button class="btn" data-action="settle-copy">텍스트 복사</button></div>
    </div>`;
  } catch (e) {
    summary = `<div class="summary"><div class="err">정산 계산 실패: ${esc(e.message)}</div></div>`;
  }
  return form + summary + list;
}

/**
 * 내용·낸 사람·금액·통화·몫이 완전히 같은 항목의 초과분 수(같은 링크를 두 번 눌렀을 때 등).
 * @param {object} trip
 * @returns {number}
 */
function duplicateCount(trip) {
  const seen = new Set();
  let n = 0;
  for (const it of trip.items) {
    const k = itemKey(it);
    if (seen.has(k)) n += 1; else seen.add(k);
  }
  return n;
}

/**
 * @param {object} it
 * @returns {string}
 */
function itemKey(it) { return JSON.stringify([it.payer, (it.desc || '').trim(), it.amount, it.code, it.forWho || '']); }


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
  out.push('', ...[...trip.items].sort((a, b) => a.ts - b.ts).map((i) => `${i.payer} ${i.desc || '-'} ${fmt(i.amount, currencyInfo(i.code).dec)} ${i.code} = ${fmt(i.krw)}원${i.forWho ? ` (${i.forWho} 개인)` : ''}`));
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
    if (changed) Object.assign(it, { krw: Math.round(amount * r.rate), rate: r.rate, source: r.source });
    editingId = null;
    toast('수정함');
  } else {
    trip.items.push({
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      ts: Date.now(), payer: draft.payer, desc: draft.desc.trim(), amount, code: draft.code,
      krw: Math.round(amount * r.rate), rate: r.rate, source: r.source,
      ...(draft.forWho ? { forWho: draft.forWho } : {}),
    });
    toast(`추가함 · ${fmt(amount * r.rate)}원`);
  }
  draft = { payer: draft.payer, desc: '', amount: '', code: draft.code, forWho: '' };
  persist();
  render();
}

/* ───────────── 설정 탭 ───────────── */

/** @returns {string} */
function renderSettings() {
  const people = state.people.map((p, i) => `<div class="row"><label>사람 ${i + 1}</label><input data-action="set-person" data-i="${i}" value="${esc(p)}"><input data-action="set-initial" data-i="${i}" value="${esc(state.initials[i] || '')}" style="flex:0 0 56px;text-align:center" aria-label="메모 초성" placeholder="초성"><input data-action="set-ratio" data-i="${i}" value="${esc(state.ratio[i])}" inputmode="decimal" style="flex:0 0 60px" aria-label="분담 비율"></div>`).join('');
  const trips = state.trips.map((t) => `<div class="row"><input data-action="trip-name" data-id="${esc(t.id)}" value="${esc(t.name)}"><select data-action="trip-code" data-id="${esc(t.id)}" style="flex:0 0 44%">${currencyOptions(t.code)}</select><button class="btn sm danger" data-action="trip-delete" data-id="${esc(t.id)}">삭제</button></div>`).join('');
  const favChips = CURRENCIES.filter((c) => c.code !== 'KRW').map((c) => `<button class="chip ${state.favorites.includes(c.code) ? 'on' : ''}" data-action="fav-toggle" data-code="${esc(c.code)}">${esc(c.code)}</button>`).join('');
  const manualRows = [
    ...Object.entries(state.manual.krw).map(([c, v]) => `<div class="kv"><span>1 ${esc(c)} = ${fmt(v, 2)}원</span><button class="del" data-action="manual-del" data-kind="krw" data-code="${esc(c)}">삭제</button></div>`),
    ...Object.entries(state.manual.usdCross).map(([c, v]) => `<div class="kv"><span>USD 1 = ${fmt(v, 3)} ${esc(c)}</span><button class="del" data-action="manual-del" data-kind="usdCross" data-code="${esc(c)}">삭제</button></div>`),
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
  <section class="card"><h2>사람 · 메모 초성 · 분담 비율</h2>${people}<p class="hint">이름을 바꾸면 기존 내역의 이름도 같이 바뀜. 가운데는 노션 메모 줄 맨 앞 글자(ㅈ·ㅅ), 오른쪽은 분담 비율(1:1 이 균등).</p></section>
  <section class="card"><h2>여행</h2>${trips}<div class="actions"><button class="btn" data-action="trip-new">새 여행</button></div></section>
  <section class="card"><h2>즐겨찾기 통화</h2><div class="chips" style="flex-wrap:wrap;overflow:visible">${favChips}</div></section>
  <section class="card"><h2>수동 환율 (항상 우선)</h2>${manualRows}
    <div class="row" style="margin-top:8px"><select id="m-code" style="flex:0 0 40%">${currencyOptions(fx.code)}</select>
      <select id="m-kind" style="flex:0 0 30%"><option value="usdCross">USD 1달러 = ? 현지</option><option value="krw">현지 1 = ? 원</option></select>
      <input id="m-val" inputmode="decimal" placeholder="9.2"></div>
    <div class="actions"><button class="btn primary" data-action="manual-add">수동 환율 저장</button></div>
    <p class="hint">트래블로그 결제 내역에 찍힌 실제 환율을 넣으면 그 값으로 계산. 예: 모로코 "USD 1 = 9.2 MAD".</p></section>
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
    case 'fx-code': fx.code = d.code; state.ui.code = fx.code; persist(); render(); break;
    case 'fx-more': {
      const code = window.prompt('통화 코드(예: THB, INR, MAD)', fx.code);
      if (!code) return;
      const up = code.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(up)) { toast('통화 코드는 영문 3자'); return; }
      fx.code = up; state.ui.code = up;
      if (!state.favorites.includes(up)) state.favorites.unshift(up);
      persist(); render(); break;
    }
    case 'fx-key': {
      const k = d.key;
      if (k === 'back') fx.input = fx.input.slice(0, -1);
      else if (k === '.') { if (!fx.input.includes('.')) fx.input = (fx.input || '0') + '.'; }
      else if (fx.input.replace('.', '').length < 12) fx.input = fx.input === '0' ? k : fx.input + k;
      render(); break;
    }
    case 'fx-clear': fx.input = ''; render(); break;
    case 'fx-add': {
      const amt = parseAmount(fx.input);
      if (!(amt > 0)) { toast('금액을 먼저 넣어 줘'); return; }
      draft = { payer: draft.payer, desc: '', amount: String(amt), code: fx.code };
      editingId = null;
      state.ui.tab = 'settle'; persist(); render();
      break;
    }
    case 'draft-payer': draft.payer = d.payer; render(); break;
    case 'draft-for': draft.forWho = d.for || ''; render(); break;
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
    case 'draft-cancel': editingId = null; draft = { payer: draft.payer, desc: '', amount: '', code: draft.code, forWho: '' }; render(); break;
    case 'item-edit': {
      const it = activeTrip().items.find((x) => x.id === d.id);
      if (!it) return;
      editingId = it.id;
      draft = { payer: it.payer, desc: it.desc, amount: String(it.amount), code: it.code, forWho: it.forWho || '' };
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      break;
    }
    case 'item-delete': {
      const trip = activeTrip();
      trip.items = trip.items.filter((x) => x.id !== editingId);
      editingId = null; draft = { payer: draft.payer, desc: '', amount: '', code: draft.code, forWho: '' };
      persist(); render(); toast('삭제함'); break;
    }
    case 'items-dedupe': {
      const trip = activeTrip();
      const n = duplicateCount(trip);
      if (!n || !window.confirm(`같은 내용·금액 항목 ${n}건을 지우고 한 벌만 남길까?`)) return;
      const seen = new Set();
      trip.items = [...trip.items].sort((a, b) => a.ts - b.ts).filter((it) => { const k = itemKey(it); if (seen.has(k)) return false; seen.add(k); return true; });
      editingId = null; persist(); render(); toast(`${n}건 정리함`); break;
    }
    case 'items-clear': {
      const trip = activeTrip();
      if (!trip.items.length || !window.confirm(`"${trip.name}" 내역 ${trip.items.length}건을 전부 지울까? 되돌릴 수 없음.`)) return;
      trip.items = []; editingId = null; persist(); render(); toast('내역을 비움'); break;
    }
    case 'settle-copy': {
      try { toast((await copyText(summaryText())) ? '복사함. 노션·카톡에 붙여 넣기' : '복사 실패'); }
      catch (e) { toast(`복사 실패: ${e.message}`); }
      break;
    }
    case 'trip-new': {
      const name = window.prompt('여행 이름', '일본');
      if (name === null) return;
      const code = (window.prompt('기본 통화 코드', 'JPY') || 'USD').trim().toUpperCase();
      newTrip(name, code); render(); break;
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
      state.manual[kind][code] = v;
      const n = resnapshotItems(code);
      persist(); render(); toast(`${code} 수동 환율 저장${n ? ` · 내역 ${n}건 다시 계산` : ''}`); break;
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
      persist(); draft = { payer: state.people[0], desc: '', amount: '', code: '' }; render(); break;
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
    case 'trip-select': state.activeTrip = el.value; draft.code = activeTrip().code; editingId = null; persist(); render(); break;
    case 'set-person': {
      const i = Number(d.i);
      const old = state.people[i];
      const nv = el.value.trim();
      if (!nv || state.people.includes(nv)) return;
      state.people[i] = nv;
      if (draft.payer === old) draft.payer = nv;
      for (const t of state.trips) for (const it of t.items) if (it.payer === old) it.payer = nv;
      persist(); break;
    }
    case 'set-initial': { state.initials[Number(d.i)] = el.value.trim(); persist(); break; }
    case 'set-ratio': {
      const v = parseAmount(el.value);
      if (v >= 0) { state.ratio[Number(d.i)] = v; persist(); }
      break;
    }
    case 'trip-name': { const t = state.trips.find((x) => x.id === d.id); if (t) { t.name = el.value; persist(); } break; }
    case 'trip-code': { const t = state.trips.find((x) => x.id === d.id); if (t) { t.code = el.value; persist(); } break; }
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
refreshRates({ silent: true }).then(() => applyHashImport()).catch((e) => logger.error('환율 로딩 실패', e));
// 앱이 이미 열려 있는 상태에서 가져오기 링크를 누르면 주소만 바뀌고 새로 안 뜸 → 그때도 처리
window.addEventListener('hashchange', () => { applyHashImport().catch((e) => logger.error('가져오기 실패', e)); });

// 자동 갱신: 화면에 돌아왔을 때(10분 지났으면), 온라인 복귀, 30분마다
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - lastRefreshAt > 10 * 60 * 1000) refreshRates({ silent: true }).catch((e) => logger.warn(e));
});
window.addEventListener('online', () => { refreshRates({ silent: true }).catch((e) => logger.warn(e)); });
window.setInterval(() => { if (!document.hidden) refreshRates({ silent: true }).catch((e) => logger.warn(e)); }, 30 * 60 * 1000);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  let reloading = false;
  let firstClaim = !navigator.serviceWorker.controller; // 첫 설치의 claim 은 업데이트가 아님
  // 새 버전 서비스워커가 자리를 잡으면 앱을 연 직후엔 바로 새로고침, 쓰는 중이면 안내만
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (firstClaim) { firstClaim = false; return; }
    if (reloading) return;
    reloading = true;
    if (Date.now() - STARTED_AT < 8000 || document.hidden) window.location.reload();
    else toast('새 버전 준비됨. 다음에 열면 적용');
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.update().catch(() => {});
  }).catch((e) => logger.warn('SW 등록 실패', e));
}
