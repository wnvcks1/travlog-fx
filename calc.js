/**
 * 순수 계산 함수. 브라우저(app.js)와 node(tests, scripts) 양쪽에서 import.
 * 환율 컨텍스트 ctx = { rates, manual }
 *   rates:  rates.json 형식 { source, asof, rates:{USD:{mid,ttb,tts,unit}}, usdCross:{MAD:9.2} }
 *   manual: { krw:{MAD:141.3}, usdCross:{MAD:9.2} }  사용자가 직접 넣은 값. 항상 우선.
 * mid 는 unit 단위당 원화(매매기준율 = 트래블로그 충전가), ttb 는 송금 받으실 때(환급가).
 */
import { currencyInfo } from './currencies.js';

export class RateMissingError extends Error {
  /** @param {string} code */
  constructor(code) {
    super(`환율 없음: ${code}`);
    this.name = 'RateMissingError';
    this.code = code;
  }
}

/**
 * @param {unknown} amount
 * @param {string} label
 * @returns {number}
 */
function assertAmount(amount, label = 'amount') {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new TypeError(`${label} 는 유한한 숫자여야 함: ${String(amount)}`);
  }
  return amount;
}

/**
 * 통화 1단위당 원화와 그 출처를 돌려줌. 우선순위: 수동 원화 > 수동 USD 교차 > 고시환율 > USD 교차.
 * @param {string} code
 * @param {{rates?:object, manual?:object}} ctx
 * @returns {{rate:number, source:string, unit:number, mid?:number, ttb?:number}}
 */
export function krwPerUnit(code, ctx = {}) {
  if (code === 'KRW') return { rate: 1, source: 'fixed', unit: 1 };
  const rates = ctx.rates || {};
  const manual = ctx.manual || {};
  const usdMid = rates.rates?.USD ? rates.rates.USD.mid / (rates.rates.USD.unit || 1) : manual.krw?.USD;

  if (manual.krw && Number.isFinite(manual.krw[code]) && manual.krw[code] > 0) {
    return { rate: manual.krw[code], source: 'manual', unit: 1 };
  }
  if (manual.usdCross && Number.isFinite(manual.usdCross[code]) && manual.usdCross[code] > 0 && usdMid) {
    return { rate: usdMid / manual.usdCross[code], source: 'manual-cross', unit: 1 };
  }
  const q = rates.rates?.[code];
  if (q && Number.isFinite(q.mid) && q.mid > 0) {
    const unit = q.unit || 1;
    return { rate: q.mid / unit, source: rates.source || 'hana', unit, mid: q.mid, ttb: q.ttb };
  }
  const cross = rates.usdCross?.[code];
  if (Number.isFinite(cross) && cross > 0 && usdMid) {
    return { rate: usdMid / cross, source: 'cross', unit: 1 };
  }
  throw new RateMissingError(code);
}

/**
 * 외화 → 원화.
 * @param {number} amount
 * @param {string} code
 * @param {object} ctx
 * @returns {number}
 */
export function toKrw(amount, code, ctx) {
  assertAmount(amount);
  return amount * krwPerUnit(code, ctx).rate;
}

/**
 * 원화 → 외화.
 * @param {number} krw
 * @param {string} code
 * @param {object} ctx
 * @returns {number}
 */
export function fromKrw(krw, code, ctx) {
  assertAmount(krw, 'krw');
  return krw / krwPerUnit(code, ctx).rate;
}

/**
 * 외화 → 캐나다 달러. 원화를 거침(하나은행 CAD 매매기준율이 같은 표에 있어 출처가 하나로 통일됨).
 * @param {number} amount
 * @param {string} code
 * @param {object} ctx
 * @returns {number}
 */
export function toCad(amount, code, ctx) {
  return toKrw(amount, code, ctx) / krwPerUnit('CAD', ctx).rate;
}

/**
 * 캐나다 달러 → 외화.
 * @param {number} cad
 * @param {string} code
 * @param {object} ctx
 * @returns {number}
 */
export function fromCad(cad, code, ctx) {
  assertAmount(cad, 'cad');
  return (cad * krwPerUnit('CAD', ctx).rate) / krwPerUnit(code, ctx).rate;
}

/**
 * 한 번에 원화·캐달 둘 다. 화면의 기본 동작.
 * @param {number} amount
 * @param {string} code
 * @param {object} ctx
 * @returns {{krw:number, cad:number, rate:number, source:string, cadRate:number}}
 */
export function convert(amount, code, ctx) {
  const r = krwPerUnit(code, ctx);
  const c = krwPerUnit('CAD', ctx);
  const krw = assertAmount(amount) * r.rate;
  return { krw, cad: krw / c.rate, rate: r.rate, source: r.source, cadRate: c.rate };
}

/**
 * 남은 외화 하나머니를 원화로 환급할 때의 손실.
 * 환급가(ttb)가 없으면 매매기준율에 스프레드를 적용. spread099 통화는 매매기준율×(1−0.0099).
 * @param {number} amount 남은 외화
 * @param {string} code
 * @param {object} ctx
 * @param {{feePct?:number}} [opts] 환급 수수료 %. 기본 1
 * @returns {{refundKrw:number, spreadKrw:number, feeKrw:number, lossKrw:number, midKrw:number}}
 */
export function refundLoss(amount, code, ctx, opts = {}) {
  assertAmount(amount);
  const feePct = opts.feePct ?? 1;
  const info = currencyInfo(code);
  const r = krwPerUnit(code, ctx);
  const midKrw = amount * r.rate;
  let refundRate;
  if (info.spread099) refundRate = r.rate * (1 - 0.0099);
  else if (Number.isFinite(r.ttb) && r.ttb > 0) refundRate = r.ttb / r.unit;
  else refundRate = r.rate;
  const gross = amount * refundRate;
  const feeKrw = gross * (feePct / 100);
  const refundKrw = gross - feeKrw;
  return { refundKrw, spreadKrw: midKrw - gross, feeKrw, lossKrw: midKrw - refundKrw, midKrw };
}

/**
 * 정산 항목의 원화 금액(정수). 저장된 스냅샷이 있으면 그것을 씀 — 나중에 환율이 바뀌어도 정산이 흔들리지 않게.
 * @param {{amount:number, code:string, krw?:number}} item
 * @param {object} ctx
 * @returns {number}
 */
export function itemKrw(item, ctx) {
  if (Number.isFinite(item.krw)) return Math.round(item.krw);
  return Math.round(toKrw(item.amount, item.code, ctx));
}

/**
 * 두 사람(이상) 정산. 사람별 낸 돈 → 비율대로 분담액 → 누가 누구에게 얼마.
 * forWho 가 있는 항목은 그 사람 몫 100%(남이 대신 낸 개인 지출). 없으면 비율대로 나눔.
 * @param {Array<{payer:string, amount:number, code:string, krw?:number, forWho?:string}>} items
 * @param {string[]} people 이름 배열. payer 는 이 안에 있어야 함
 * @param {object} ctx
 * @param {number[]} [ratio] 분담 비율. 기본 균등
 * @returns {{paid:Record<string,number>, share:Record<string,number>, balance:Record<string,number>, total:number, transfers:Array<{from:string,to:string,krw:number,cad:number|null}>, cadRate:number|null}}
 */
export function settle(items, people, ctx, ratio) {
  if (!Array.isArray(people) || people.length < 1) throw new TypeError('people 이 비어 있음');
  const w = ratio && ratio.length === people.length ? ratio : people.map(() => 1);
  const wsum = w.reduce((a, b) => a + b, 0);
  if (!(wsum > 0) || w.some((x) => !(x >= 0))) throw new TypeError('ratio 가 잘못됨');

  const paid = Object.fromEntries(people.map((p) => [p, 0]));
  const personal = Object.fromEntries(people.map((p) => [p, 0]));
  let shared = 0;
  for (const it of items) {
    if (!(it.payer in paid)) throw new RangeError(`모르는 사람: ${it.payer}`);
    const krw = itemKrw(it, ctx);
    paid[it.payer] += krw;
    if (it.forWho) {
      if (!(it.forWho in personal)) throw new RangeError(`모르는 사람: ${it.forWho}`);
      personal[it.forWho] += krw;
    } else shared += krw;
  }
  const total = Object.values(paid).reduce((a, b) => a + b, 0);

  // 공동 지출은 비율대로(정수, 나머지 원 단위는 첫 사람에게), 개인 지출은 그 사람 몫 그대로
  const share = {};
  let acc = 0;
  people.forEach((p, i) => {
    share[p] = Math.floor((shared * w[i]) / wsum);
    acc += share[p];
  });
  share[people[0]] += shared - acc;
  for (const p of people) share[p] += personal[p];

  const balance = Object.fromEntries(people.map((p) => [p, paid[p] - share[p]]));

  let cadRate = null;
  try {
    cadRate = krwPerUnit('CAD', ctx).rate;
  } catch (e) {
    if (!(e instanceof RateMissingError)) throw e;
  }

  // 마이너스(덜 낸 사람) → 플러스(더 낸 사람) 로 탐욕 매칭. 2명이면 송금 1건
  const debtors = people.filter((p) => balance[p] < 0).map((p) => ({ p, v: -balance[p] }));
  const creditors = people.filter((p) => balance[p] > 0).map((p) => ({ p, v: balance[p] }));
  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const krw = Math.min(debtors[i].v, creditors[j].v);
    if (krw > 0) {
      transfers.push({ from: debtors[i].p, to: creditors[j].p, krw, cad: cadRate ? krw / cadRate : null });
    }
    debtors[i].v -= krw;
    creditors[j].v -= krw;
    if (debtors[i].v === 0) i += 1;
    if (creditors[j].v === 0) j += 1;
  }
  return { paid, share, balance, total, shared, personal, transfers, cadRate };
}

/**
 * 숫자를 자릿수 맞춰 천 단위 쉼표로. 표시 전용.
 * @param {number} n
 * @param {number} [dec]
 * @returns {string}
 */
export function fmt(n, dec = 0) {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('ko-KR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/**
 * 환율 자료의 나이(시간). asof 가 없거나 못 읽으면 Infinity.
 * @param {{asof?:string}|null|undefined} rates
 * @param {number} [now] ms
 * @returns {number}
 */
export function ageHours(rates, now = Date.now()) {
  const t = rates?.asof ? Date.parse(rates.asof) : NaN;
  if (!Number.isFinite(t)) return Infinity;
  return (now - t) / 3.6e6;
}
