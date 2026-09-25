/**
 * 노션에 손으로 적은 정산 메모를 항목으로 바꿈.
 * 줄 형식 예: "ㅈ빵 + 망고주스 큰거 = 5 + 22 = 27", "ㅅ마트 97.6", "ㅈ마라케시 3박 144000원", "ㅈ사하라 여행 예약 191 달러"
 *  - 맨 앞 초성(ㅈ/ㅅ)이나 이름이 낸 사람. 이름의 첫 글자 초성으로 자동 매칭
 *  - '=' 가 있으면 마지막 '=' 뒤가 금액. 괄호 메모는 금액 계산에서 빼고 설명에 남김
 *  - 단위: 원→KRW, 달러/불→USD, 유로→EUR, 다르함/디르함→MAD, 엔→JPY. 없으면 기본 통화
 */

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const UNITS = [
  [/(원|krw)$/i, 'KRW'], [/(달러|불|usd|\$)$/i, 'USD'], [/(유로|eur|€)$/i, 'EUR'],
  [/(다르함|디르함|mad)$/i, 'MAD'], [/(엔|jpy|¥)$/i, 'JPY'], [/(캐달|cad)$/i, 'CAD'],
];

/**
 * 한글 음절의 초성. 한글이 아니면 그 글자 그대로.
 * @param {string} ch
 * @returns {string}
 */
export function chosung(ch) {
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return ch;
  return CHO[Math.floor(code / 588)];
}

/**
 * @param {string} line
 * @param {string[]} people
 * @param {string[]} [initials] 메모에서 쓰는 초성·별칭. people 과 같은 순서. 없으면 이름 첫 글자 초성
 * @returns {{payer:string, rest:string}|null}
 */
function splitPayer(line, people, initials = []) {
  const t = line.trim();
  for (const p of people) {
    if (t.startsWith(p)) return { payer: p, rest: t.slice(p.length) };
  }
  // 별칭(예: ㅈ=으뜸)이 이름보다 먼저. 긴 별칭부터 맞춰 봄
  const al = people.map((p, i) => ({ p, a: String(initials[i] || '').trim() })).filter((x) => x.a).sort((x, y) => y.a.length - x.a.length);
  for (const { p, a } of al) if (t.startsWith(a)) return { payer: p, rest: t.slice(a.length) };
  const first = t[0];
  if (CHO.includes(first)) {
    const p = people.find((n) => chosung(n[0]) === first);
    if (p) return { payer: p, rest: t.slice(1) };
  }
  return null;
}

/**
 * "152,300원" / "191 달러" / "97.6" → {amount, code}
 * @param {string} seg
 * @param {string} defaultCode
 * @returns {{amount:number, code:string, index:number}|null}
 */
function lastAmount(seg, defaultCode) {
  const re = /(\d[\d,]*(?:\.\d+)?)\s*([가-힣a-zA-Z$€¥]*)/g;
  let m; let last = null;
  while ((m = re.exec(seg)) !== null) last = m;
  if (!last) return null;
  const amount = parseFloat(last[1].replace(/,/g, ''));
  if (!Number.isFinite(amount)) return null;
  let code = defaultCode;
  const suffix = (last[2] || '').trim();
  for (const [rx, c] of UNITS) if (rx.test(suffix)) { code = c; break; }
  return { amount, code, index: last.index };
}

/**
 * @param {string} text 노션 페이지 본문(줄 단위)
 * @param {string[]} people 사람 이름(낸 사람 매칭용)
 * @param {string} [defaultCode] 단위 없는 금액의 통화. 기본 MAD
 * @param {string[]} [initials] 메모 초성·별칭(people 순서). 예: ['ㅈ','ㅅ']
 * @returns {{items:Array<{payer:string, desc:string, amount:number, code:string, note?:string}>, skipped:string[], warnings:string[]}}
 */
export function parseLedger(text, people, defaultCode = 'MAD', initials = []) {
  const items = [];
  const skipped = [];
  const warnings = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/<br>/g, ' ').trim();
    if (!line) continue;
    const sp = splitPayer(line, people, initials);
    if (!sp) { skipped.push(line); continue; }
    let rest = sp.rest.trim();
    // 낸 사람 바로 뒤에 숫자가 오면 합계 줄(예: "ㅈ 2604 다르함 + 356,300원") → 항목 아님
    if (/^\s*[\d,]+(?:\.\d+)?\s*(원|달러|다르함|디르함|유로)?\s*(\+|=|$)/.test(rest)) { skipped.push(line); continue; }
    const notes = [];
    rest = rest.replace(/\(([^)]*)\)/g, (_, n) => { notes.push(n.trim()); return ' '; });
    const segs = rest.split('=');
    const amountSeg = segs[segs.length - 1];
    const found = lastAmount(amountSeg, defaultCode);
    if (!found) { skipped.push(line); continue; }
    let desc = segs.length > 1 ? segs[0] : amountSeg.slice(0, found.index);
    desc = desc.replace(/[\s.:=\-]+$/g, '').replace(/^[\s.:=\-]+/g, '').replace(/\s+/g, ' ').trim();
    if (!desc) desc = '(내용 없음)';
    const item = { payer: sp.payer, desc: desc.slice(0, 40), amount: found.amount, code: found.code };
    if (notes.length) { item.note = notes.join(' / '); warnings.push(`"${desc}" 에 메모 있음: ${item.note} — 몫을 확인할 것`); }
    items.push(item);
  }
  return { items, skipped, warnings };
}

/**
 * 링크로 나르는 가져오기 묶음을 만들고 푼다. #import=<base64url(JSON)>
 * @param {object} payload
 * @returns {string}
 */
export function encodeImport(payload) {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * @param {string} s
 * @returns {object}
 */
export function decodeImport(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const obj = JSON.parse(new TextDecoder().decode(bytes));
  if (!obj || obj.v !== 1 || !Array.isArray(obj.items)) throw new TypeError('가져오기 링크 형식이 아님');
  return obj;
}
