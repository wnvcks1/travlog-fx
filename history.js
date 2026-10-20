/**
 * 원화 대비 과거 환율(차트용). 무료로 5년치를 주는 곳이 ECB 기준환율(api.frankfurter.dev)뿐이라 그 30개 통화만 됨.
 * 달러·유로·홍콩달러에 고정된 통화는 고정 비율로 환산(PEGS).
 * 순수 함수(parseHistory·sliceYears·summarize·niceTicks·chartModel)는 node 테스트 대상, loadHistory 만 네트워크.
 */

/** ECB 기준환율이 있는 통화(2026-10 확인). KRW 는 기준 통화라 차트 대상 아님 */
export const ECB_CODES = new Set(['AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY',
  'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR']);

/** 고정환율 통화: [기준 통화, 기준 1단위당 이 통화 개수] */
export const PEGS = {
  AED: ['USD', 3.6725], SAR: ['USD', 3.75], QAR: ['USD', 3.64], BHD: ['USD', 0.376], OMR: ['USD', 0.3845], JOD: ['USD', 0.709],
  MOP: ['HKD', 1.03], XPF: ['EUR', 119.33174], BAM: ['EUR', 1.95583],
};

/**
 * @param {string} code
 * @returns {boolean} 차트를 그릴 수 있는 통화인지
 */
export function hasHistory(code) { return ECB_CODES.has(code) || code in PEGS; }

/**
 * Frankfurter 기간 응답 → [['YYYY-MM-DD', 1단위당 원], ...] 날짜순. 형식이 아니면 throw.
 * @param {{base?:string, rates?:Record<string, {KRW?:number}>}} j
 * @returns {Array<[string, number]>}
 */
export function parseHistory(j) {
  if (!j || !j.rates || typeof j.rates !== 'object') throw new Error('과거 환율 응답 형식 아님');
  const out = [];
  for (const [d, r] of Object.entries(j.rates)) {
    const v = r?.KRW;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && typeof v === 'number' && Number.isFinite(v) && v > 0) out.push([d, v]);
  }
  if (out.length < 2) throw new Error('과거 환율이 비어 있음');
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/**
 * 마지막 날짜에서 years 년 전까지만.
 * @param {Array<[string, number]>} points
 * @param {number} years
 * @returns {Array<[string, number]>}
 */
export function sliceYears(points, years) {
  if (!points.length) return [];
  const last = points[points.length - 1][0];
  const from = `${Number(last.slice(0, 4)) - years}${last.slice(4)}`;
  return points.filter(([d]) => d >= from);
}

/**
 * @param {Array<[string, number]>} points
 * @returns {{first:[string,number], last:[string,number], min:[string,number], max:[string,number], changePct:number}}
 */
export function summarize(points) {
  if (!points.length) throw new Error('점이 없음');
  let min = points[0];
  let max = points[0];
  for (const p of points) { if (p[1] < min[1]) min = p; if (p[1] > max[1]) max = p; }
  const first = points[0];
  const last = points[points.length - 1];
  return { first, last, min, max, changePct: (last[1] / first[1] - 1) * 100 };
}

/**
 * 눈금: lo~hi 를 덮는 1·2·2.5·5 ×10^n 간격, count 개 안팎.
 * @param {number} lo
 * @param {number} hi
 * @param {number} [count]
 * @returns {number[]}
 */
export function niceTicks(lo, hi, count = 5) {
  if (!(hi > lo)) { const pad = Math.abs(lo) * 0.01 || 1; lo -= pad; hi += pad; }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) || 10 * mag;
  // 맨 아래·맨 위 눈금이 값을 반드시 감싸게(선이 상자 밖으로 안 나가게)
  const start = Math.floor(lo / step + 1e-9) * step;
  const end = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let v = start; v <= end + step * 1e-6; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

/**
 * 좌표 계산(그리기는 app.js). 날짜는 실제 시간 간격으로 x 에 놓음(주말·휴일 빈칸이 줄을 당기지 않게).
 * @param {Array<[string, number]>} points
 * @param {{w:number, h:number, left:number, right:number, top:number, bottom:number}} box
 * @returns {{xs:number[], ys:number[], line:string, area:string, yTicks:Array<{y:number, v:number}>, xTicks:Array<{x:number, label:string}>, y0:number, y1:number}}
 */
export function chartModel(points, box) {
  const t = points.map(([d]) => Date.parse(`${d}T00:00:00Z`));
  const vs = points.map((p) => p[1]);
  const ticks = niceTicks(Math.min(...vs), Math.max(...vs), 5);
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const t0 = t[0];
  const t1 = t[t.length - 1] > t0 ? t[t.length - 1] : t0 + 1;
  const iw = box.w - box.left - box.right;
  const ih = box.h - box.top - box.bottom;
  const X = (ms) => box.left + ((ms - t0) / (t1 - t0)) * iw;
  const Y = (v) => box.top + (1 - (v - y0) / (y1 - y0 || 1)) * ih;
  const xs = t.map(X);
  const ys = vs.map(Y);
  const line = xs.map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join('');
  const base = (box.top + ih).toFixed(1);
  const area = `${line}L${xs[xs.length - 1].toFixed(1)},${base}L${xs[0].toFixed(1)},${base}Z`;
  const yTicks = ticks.map((v) => ({ y: Y(v), v }));
  // x 눈금: 2년 넘게면 해마다 1월, 아니면 분기(1·4·7·10월)
  const spanYears = (t1 - t0) / (365.25 * 86400e3);
  const xTicks = [];
  const d0 = new Date(t0);
  for (let y = d0.getUTCFullYear(); y <= new Date(t1).getUTCFullYear(); y += 1) {
    const months = spanYears > 2 ? [0] : [0, 3, 6, 9];
    for (const m of months) {
      const ms = Date.UTC(y, m, 1);
      if (ms < t0 || ms > t1) continue;
      xTicks.push({ x: X(ms), label: spanYears > 2 ? String(y) : `${String(y).slice(2)}.${m + 1}` });
    }
  }
  return { xs, ys, line, area, yTicks, xTicks, y0, y1 };
}

/**
 * 원화 대비 과거 환율 받기(5년치). 하루 지난 캐시는 다시 받고, 실패하면 캐시라도 돌려줌.
 * @param {string} code
 * @param {{fetchFn?:typeof fetch, storage?:Storage|null, now?:number, maxAgeMs?:number}} [opts]
 * @returns {Promise<{points:Array<[string, number]>, fromCache:boolean, at:number, peg?:[string, number]}>}
 */
export async function loadHistory(code, opts = {}) {
  if (!hasHistory(code)) throw new Error(`${code} 는 과거 환율 데이터가 없음`);
  const now = opts.now ?? Date.now();
  const storage = opts.storage === undefined ? safeStorage() : opts.storage;
  const key = `travlog.hist.v1.${code}`;
  let cached = null;
  try { cached = storage ? JSON.parse(storage.getItem(key) || 'null') : null; } catch { cached = null; }
  if (cached && Array.isArray(cached.points) && now - cached.at < (opts.maxAgeMs ?? 12 * 3600e3)) {
    return { points: cached.points, fromCache: true, at: cached.at, ...(PEGS[code] ? { peg: PEGS[code] } : {}) };
  }
  const peg = PEGS[code];
  const base = peg ? peg[0] : code;
  const to = new Date(now).toISOString().slice(0, 10);
  const from = `${Number(to.slice(0, 4)) - 5}${to.slice(4)}`;
  try {
    const f = opts.fetchFn || fetch;
    const res = await f(`https://api.frankfurter.dev/v1/${from}..${to}?base=${base}&symbols=KRW`);
    if (!res.ok) throw new Error(`과거 환율 HTTP ${res.status}`);
    let points = parseHistory(await res.json());
    if (peg) points = points.map(([d, v]) => [d, v / peg[1]]);
    try { storage?.setItem(key, JSON.stringify({ at: now, points })); } catch { /* 저장 공간 부족이면 캐시 없이 */ }
    return { points, fromCache: false, at: now, ...(peg ? { peg } : {}) };
  } catch (e) {
    if (cached && Array.isArray(cached.points)) return { points: cached.points, fromCache: true, at: cached.at, ...(peg ? { peg } : {}) };
    throw e;
  }
}

/** @returns {Storage|null} */
function safeStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
