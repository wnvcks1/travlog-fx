/**
 * 환율 로딩. 순서: 같은 도메인 data/rates.json(하나은행, Actions 가 만듦) → open.er-api.com → api.frankfurter.dev.
 * 결과는 rates.json 형식 하나로 합쳐서 돌려줌. 순수 변환 함수는 테스트 가능하게 export.
 */
import { CURRENCIES } from './currencies.js';

export const ERAPI_URL = 'https://open.er-api.com/v6/latest/USD';
/** 하나은행·KB 고시환율을 정적 JSON 으로 재게시하는 공개 저장소(github.com/bhagyeongc/ExchangeRateData). CORS 허용, 영업일 하루 3번쯤 갱신 */
export const FXCOD_URL = 'https://exchangerate.fxcod.com/latest.json';
export const FRANKFURTER_URL = 'https://api.frankfurter.dev/v1/latest?base=USD';

/**
 * er-api 응답 → rates.json 형식. KRW 가 없으면 throw.
 * @param {{result?:string, time_last_update_utc?:string, time_last_update_unix?:number, rates?:Record<string,number>}} j
 * @returns {object}
 */
export function fromErApi(j) {
  if (!j || j.result !== 'success' || !j.rates || !(j.rates.KRW > 0)) throw new Error('er-api 응답 형식 아님');
  const krwPerUsd = j.rates.KRW;
  const rates = {};
  for (const c of CURRENCIES) {
    const per = j.rates[c.code];
    if (c.code !== 'KRW' && per > 0) rates[c.code] = { mid: krwPerUsd / per, unit: 1 };
  }
  const asof = j.time_last_update_unix ? new Date(j.time_last_update_unix * 1000).toISOString() : (j.time_last_update_utc || null);
  return { source: 'erapi', asof, base: 'KRW', rates, usdCross: { ...j.rates } };
}

/**
 * FXCOD latest.json → rates.json 형식. 하나은행(hana) 값을 쓰고 없으면 KB 값으로 메움.
 * baseRate=매매기준율(트래블로그 충전가), receive=송금 받으실 때(환급가), send=송금 보내실 때.
 * @param {{updatedAt?:string, baseDate?:string, rates?:Record<string,{hana?:object, kb?:object}>}} j
 * @returns {object}
 */
export function fromFxcod(j) {
  if (!j || !j.rates || typeof j.rates !== 'object') throw new Error('FXCOD 응답 형식 아님');
  const rates = {};
  for (const [code, banks] of Object.entries(j.rates)) {
    const q = banks?.hana || banks?.kb;
    if (!q || !(q.baseRate > 0)) continue;
    const unit = q.unit > 0 ? q.unit : 1;
    rates[code] = {
      mid: q.baseRate, unit,
      ttb: q.receive > 0 ? q.receive : undefined, tts: q.send > 0 ? q.send : undefined,
      cashBuy: q.cashBuy > 0 ? q.cashBuy : undefined, cashSell: q.cashSell > 0 ? q.cashSell : undefined,
      ...(banks?.hana ? {} : { src: 'kb' }),
    };
  }
  if (!rates.USD) throw new Error('FXCOD 응답에 USD 가 없음');
  const usd = rates.USD.mid / rates.USD.unit;
  const usdCross = {};
  for (const [code, q] of Object.entries(rates)) usdCross[code] = usd / (q.mid / q.unit);
  return { source: 'hana', via: 'fxcod', asof: j.updatedAt || null, baseDate: j.baseDate || null, base: 'KRW', rates, usdCross };
}

/**
 * frankfurter(ECB) 응답 → rates.json 형식. 통화가 30개쯤이라 usdCross 도 그만큼만.
 * @param {{base?:string, date?:string, rates?:Record<string,number>}} j
 * @returns {object}
 */
export function fromFrankfurter(j) {
  if (!j || j.base !== 'USD' || !j.rates || !(j.rates.KRW > 0)) throw new Error('frankfurter 응답 형식 아님');
  const krwPerUsd = j.rates.KRW;
  const rates = { USD: { mid: krwPerUsd, unit: 1 } };
  for (const [code, per] of Object.entries(j.rates)) {
    if (code !== 'KRW' && per > 0) rates[code] = { mid: krwPerUsd / per, unit: 1 };
  }
  // ECB 고시는 CET 16:00 무렵. 날짜만 있으니 그날 16:00Z 로 둠
  return { source: 'frankfurter', asof: j.date ? `${j.date}T16:00:00Z` : null, base: 'KRW', rates, usdCross: { ...j.rates, USD: 1 } };
}

/**
 * primary 를 유지하고 없는 통화·교차환율만 secondary 에서 채움.
 * @param {object|null} primary
 * @param {object|null} secondary
 * @returns {object|null}
 */
export function mergeRates(primary, secondary) {
  if (!primary) return secondary || null;
  if (!secondary) return primary;
  const out = { ...primary, rates: { ...(primary.rates || {}) }, usdCross: { ...(secondary.usdCross || {}), ...(primary.usdCross || {}) } };
  out.filledFrom = secondary.source;
  for (const [code, q] of Object.entries(secondary.rates || {})) {
    if (!out.rates[code]) out.rates[code] = { ...q, src: secondary.source };
  }
  return out;
}

/**
 * 환율의 나이(시간).
 * @param {object|null} r
 * @param {number} [now]
 * @returns {number}
 */
export function hoursOld(r, now = Date.now()) {
  const t = r?.asof ? Date.parse(r.asof) : NaN;
  return Number.isFinite(t) ? (now - t) / 3.6e6 : Infinity;
}

/**
 * 후보 중 기준 통화가 있고 가장 신선한 것을 고름. 하나은행은 maxHanaAge 시간까지 우선.
 * @param {{hana?:object|null, erapi?:object|null, frankfurter?:object|null, cache?:object|null}} c
 * @param {number} [maxHanaAge]
 * @param {number} [now]
 * @returns {{primary:object|null, secondary:object|null}}
 */
export function pickPrimary(c, maxHanaAge = 36, now = Date.now()) {
  const ok = (r) => r && r.rates && r.rates.USD && r.rates.USD.mid > 0;
  const hanaAll = [c.hana, c.fxcod].filter((r) => ok(r) && r.source === 'hana').sort((a, b) => hoursOld(a, now) - hoursOld(b, now));
  const hana = hanaAll.length && hoursOld(hanaAll[0], now) <= maxHanaAge ? hanaAll[0] : null;
  const live = [c.erapi, c.frankfurter].filter(ok).sort((a, b) => hoursOld(a, now) - hoursOld(b, now));
  if (hana) return { primary: hana, secondary: live[0] || c.cache || null };
  if (live.length) return { primary: live[0], secondary: hanaAll[0] || live[1] || c.cache || null };
  if (hanaAll.length) return { primary: hanaAll[0], secondary: c.cache || null };
  if (ok(c.cache)) return { primary: c.cache, secondary: null };
  return { primary: null, secondary: null };
}

/**
 * 네트워크에서 전부 받아 합침. 실패는 log 에 남기고 계속 감.
 * @param {{cache?:object|null, fetchImpl?:typeof fetch, timeoutMs?:number}} [opts]
 * @returns {Promise<{rates:object|null, log:string[]}>}
 */
export async function loadRates(opts = {}) {
  const f = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const log = [];
  const get = async (url, init) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await f(url, { ...init, signal: ctl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  };
  const tryGet = async (name, url, init, conv) => {
    try {
      const j = await get(url, init);
      const r = conv(j);
      log.push(`${name}: ok (${r.asof || '시각 없음'})`);
      return r;
    } catch (e) {
      log.push(`${name}: 실패 — ${e && e.message ? e.message : e}`);
      return null;
    }
  };
  const [hana, fxcod, erapi] = await Promise.all([
    tryGet('rates.json', `./data/rates.json?t=${Date.now()}`, { cache: 'no-store' }, (j) => {
      if (!j || !j.rates) throw new Error('형식 아님');
      return j;
    }),
    tryGet('하나은행(FXCOD)', FXCOD_URL, { cache: 'no-store' }, fromFxcod),
    tryGet('er-api', ERAPI_URL, {}, fromErApi),
  ]);
  let frankfurter = null;
  if (!erapi && !fxcod) frankfurter = await tryGet('frankfurter', FRANKFURTER_URL, {}, fromFrankfurter);
  const { primary, secondary } = pickPrimary({ hana, fxcod, erapi, frankfurter, cache: opts.cache || null });
  return { rates: mergeRates(primary, secondary), log };
}

/**
 * 출처 코드 → 한글 라벨.
 * @param {string|undefined} s
 * @returns {string}
 */
export function sourceLabel(s) {
  return { hana: '하나은행', kb: 'KB국민', erapi: 'er-api', frankfurter: 'ECB', sample: '샘플', manual: '수동', 'manual-cross': '수동 교차', travlog: '트래블로그 앱', cross: 'USD 교차', fixed: '' }[s] || (s || '없음');
}
