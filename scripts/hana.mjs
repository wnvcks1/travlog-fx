/**
 * 하나은행 고시환율 HTML 파서. 네트워크 없이 테스트 가능하게 분리.
 * 응답 표(추정, 확신 70%): 통화 | 현찰 사실때 환율 | Spread | 현찰 파실때 환율 | Spread | 송금 보내실때 | 송금 받으실때 | 매매기준율 | 환가료율 | 미화환산율
 */

/**
 * @param {string} s
 * @returns {string}
 */
function cellText(s) {
  return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} s
 * @returns {number|null}
 */
function num(s) {
  const t = s.replace(/,/g, '').trim();
  if (!/^-?\d*\.?\d+$/.test(t)) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {string} html
 * @returns {{rows:Array<{code:string,name:string,unit:number,mid:number,ttb:number|null,tts:number|null,cashBuy:number|null,cashSell:number|null}>, round:string|null, asofText:string|null, headers:string[], skipped:string[]}}
 */
export function parseHanaHtml(html) {
  const rows = [];
  const skipped = [];
  const headers = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(html)) !== null) {
    const cells = [...m[1].matchAll(/<t([dh])[^>]*>([\s\S]*?)<\/t\1>/gi)].map((c) => ({ th: c[1].toLowerCase() === 'h', text: cellText(c[2]) }));
    if (!cells.length) continue;
    if (cells.every((c) => c.th)) { headers.push(cells.map((c) => c.text).join('|')); continue; }
    const first = cells[0].text;
    const cm = first.match(/\b([A-Z]{3})\b(?:\s*\((\d+)\))?/);
    if (!cm) { skipped.push(first.slice(0, 40)); continue; }
    const code = cm[1];
    const unit = cm[2] ? parseInt(cm[2], 10) : 1;
    const vals = cells.slice(1).map((c) => num(c.text));
    let mid = null; let ttb = null; let tts = null; let cashBuy = null; let cashSell = null;
    if (vals.length >= 9) { [cashBuy, , cashSell, , tts, ttb, mid] = vals; }
    else if (vals.length === 7) { [cashBuy, cashSell, tts, ttb, mid] = vals; }
    else if (vals.length === 5) { [cashBuy, cashSell, tts, ttb, mid] = vals; }
    else if (vals.length >= 1) { mid = vals[vals.length - 1]; }
    if (!(mid > 0)) { skipped.push(`${code}: ${cells.slice(1).map((c) => c.text).join('|')}`); continue; }
    rows.push({ code, name: first.replace(/\s*\(\d+\)\s*$/, ''), unit, mid, ttb: ttb > 0 ? ttb : null, tts: tts > 0 ? tts : null, cashBuy: cashBuy > 0 ? cashBuy : null, cashSell: cashSell > 0 ? cashSell : null });
  }
  const text = cellText(html);
  // 시각이 있는 형태를 먼저, 없으면 날짜·회차만
  const rm = text.match(/(\d{4}[.\-/]\d{2}[.\-/]\d{2})\D{0,20}?(\d{1,3})\s*회차?\D{0,10}?(\d{2}:\d{2}(?::\d{2})?)/)
    || text.match(/(\d{4}[.\-/]\d{2}[.\-/]\d{2})\D{0,20}?(\d{1,3})\s*회차?/);
  const round = rm ? `${rm[2]}회차` : (text.match(/(\d{1,3})\s*회차/) || [])[0] || null;
  const asofText = rm ? `${rm[1].replace(/[./]/g, '-')}${rm[3] ? `T${rm[3].length === 5 ? `${rm[3]}:00` : rm[3]}+09:00` : 'T09:00:00+09:00'}` : null;
  return { rows, round, asofText, headers, skipped };
}

/**
 * 파싱 결과 → rates.json. USD 가 없으면 throw(교차환율 기준이라 필수).
 * @param {ReturnType<typeof parseHanaHtml>} parsed
 * @param {string} [fallbackAsof] ISO
 * @returns {object}
 */
export function buildHanaRates(parsed, fallbackAsof = new Date().toISOString()) {
  const rates = {};
  for (const r of parsed.rows) rates[r.code] = { mid: r.mid, ttb: r.ttb ?? undefined, tts: r.tts ?? undefined, cashBuy: r.cashBuy ?? undefined, cashSell: r.cashSell ?? undefined, unit: r.unit };
  if (!rates.USD) throw new Error('하나은행 응답에 USD 가 없음');
  const usd = rates.USD.mid / rates.USD.unit;
  const usdCross = {};
  for (const [code, q] of Object.entries(rates)) usdCross[code] = usd / (q.mid / q.unit);
  return { source: 'hana', asof: parsed.asofText || fallbackAsof, round: parsed.round, base: 'KRW', rates, usdCross };
}

