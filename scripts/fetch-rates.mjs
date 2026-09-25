#!/usr/bin/env node
/**
 * GitHub Actions 에서 실행. 하나은행 고시환율 → 실패하면 er-api → frankfurter 순으로 받아
 * travlog/data/rates.json 을 만든다. 어떤 경우에도 파일은 남긴다(배포가 환율 때문에 깨지면 안 됨).
 * 로그에 응답 상태·행 수·헤더를 남겨 파싱이 틀렸을 때 Actions 로그만 보고 고칠 수 있게 함.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { parseHanaHtml, buildHanaRates } from './hana.mjs';
import { fromErApi, fromFrankfurter, fromFxcod, mergeRates, ERAPI_URL, FRANKFURTER_URL, FXCOD_URL } from '../rates.js';

const OUT = new URL('../data/rates.json', import.meta.url);
const HANA_URLS = (process.env.HANA_URLS || 'https://www.kebhana.com/cms/rate/wpfxd651_01i_01.do,https://www.kebhana.com/cms/rate/wpfxd651_07i_1.do').split(',');
const HANA_PAGE = 'https://www.kebhana.com/cms/rate/index.do?contentUrl=/cms/rate/wpfxd651_01i.do';
// 하나은행 사이트는 해외 IP(GitHub 러너)에 "이용불가안내"를 내려 직접 조회가 안 됨(2026-09-25 실측). HANA_DIRECT=1 일 때만 시도.
const HANA_DIRECT = process.env.HANA_DIRECT === '1';
const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Mobile Safari/537.36';

/** @param {string} msg */
const log = (msg) => process.stdout.write(`[fetch-rates] ${msg}\n`);

/** @returns {{dot:string, plain:string, iso:string}} 한국 시간 오늘 */
function kstToday() {
  const now = new Date(Date.now() + 9 * 3600e3);
  const y = now.getUTCFullYear(); const m = String(now.getUTCMonth() + 1).padStart(2, '0'); const d = String(now.getUTCDate()).padStart(2, '0');
  const hh = String(now.getUTCHours()).padStart(2, '0'); const mm = String(now.getUTCMinutes()).padStart(2, '0');
  return { dot: `${y}.${m}.${d}`, plain: `${y}${m}${d}`, iso: `${y}-${m}-${d}T${hh}:${mm}:00+09:00` };
}

/**
 * @param {string} url
 * @param {RequestInit} init
 * @param {number} ms
 */
async function fetchWithTimeout(url, init, ms = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctl.signal }); } finally { clearTimeout(t); }
}

/**
 * 응답 본문을 문자셋에 맞게 디코드(네이버는 EUC-KR).
 * @param {Response} res
 * @returns {Promise<string>}
 */
async function readText(res) {
  const buf = new Uint8Array(await res.arrayBuffer());
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const cs = /charset=([\w-]+)/.exec(ct)?.[1] || (/euc-kr|ks_c_5601/i.test(ct) ? 'euc-kr' : 'utf-8');
  try { return new TextDecoder(cs).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

/** @returns {Promise<object|null>} 하나은행 직접 조회. 먼저 조회 페이지를 GET 해 쿠키를 받고, 같은 세션으로 POST */
async function fetchHana() {
  const today = kstToday();
  let cookie = '';
  try {
    const pre = await fetchWithTimeout(HANA_PAGE, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, redirect: 'follow' });
    const setc = typeof pre.headers.getSetCookie === 'function' ? pre.headers.getSetCookie() : [pre.headers.get('set-cookie') || ''];
    cookie = setc.filter(Boolean).map((c) => c.split(';')[0]).join('; ');
    const html = await readText(pre);
    log(`hana page: HTTP ${pre.status}, ${html.length} bytes, 쿠키 ${setc.filter(Boolean).length}개, title=${(html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '?'}`);
  } catch (e) {
    log(`hana page: 실패 — ${e.message}`);
  }
  for (const url of HANA_URLS) {
    for (const pbldDvCd of ['3', '1']) {
      const body = new URLSearchParams({ ajax: 'true', curCd: '', tmpInqStrDt: today.dot, pbldDvCd, pbldSqn: '', inqStrDt: today.plain, inqKindCd: '1', hid_key_data: '', hid_enc_data: '', requestTarget: 'searchContentDiv' });
      try {
        const res = await fetchWithTimeout(url, {
          method: 'POST', body,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'User-Agent': UA, Referer: HANA_PAGE, Origin: 'https://www.kebhana.com', 'X-Requested-With': 'XMLHttpRequest', Accept: 'text/html, */*; q=0.01', ...(cookie ? { Cookie: cookie } : {}) },
        });
        const html = await readText(res);
        const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
        log(`hana ${url.split('/').pop()} pbldDvCd=${pbldDvCd}: HTTP ${res.status}, ${html.length} bytes${title ? `, title=${title.trim()}` : ''}`);
        if (!res.ok) continue;
        const parsed = parseHanaHtml(html);
        log(`hana headers: ${parsed.headers.slice(0, 3).join(' / ') || '(없음)'}`);
        log(`hana rows: ${parsed.rows.length}, round=${parsed.round}, asof=${parsed.asofText}, skipped=${parsed.skipped.length}`);
        if (parsed.rows.length < 5) {
          if (parsed.skipped.length) log(`hana skipped 예: ${parsed.skipped.slice(0, 3).join(' / ')}`);
          continue;
        }
        log(`hana 예: ${parsed.rows.slice(0, 3).map((r) => `${r.code}/${r.unit}=${r.mid}`).join(', ')}`);
        return buildHanaRates(parsed, today.iso);
      } catch (e) {
        log(`hana ${url.split('/').pop()} pbldDvCd=${pbldDvCd}: 실패 — ${e.message}`);
      }
    }
  }
  return null;
}

/**
 * @param {string} name
 * @param {string} url
 * @param {(j:any)=>object} conv
 * @returns {Promise<object|null>}
 */
async function fetchJson(name, url, conv) {
  try {
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': UA } });
    log(`${name}: HTTP ${res.status}`);
    if (!res.ok) return null;
    const r = conv(await res.json());
    log(`${name}: ${Object.keys(r.rates).length} 통화, asof=${r.asof}`);
    return r;
  } catch (e) {
    log(`${name}: 실패 — ${e.message}`);
    return null;
  }
}

async function main() {
  const [fxcod, hanaDirect, erapi] = await Promise.all([
    fetchJson('하나은행(FXCOD)', FXCOD_URL, fromFxcod),
    HANA_DIRECT ? fetchHana() : Promise.resolve(null),
    fetchJson('er-api', ERAPI_URL, fromErApi),
  ]);
  if (fxcod) log(`fxcod: baseDate=${fxcod.baseDate}, updatedAt=${fxcod.asof}, USD=${fxcod.rates.USD.mid}, JPY/100=${fxcod.rates.JPY?.mid}`);
  const hana = hanaDirect || fxcod;
  let frank = null;
  if (!hana && !erapi) frank = await fetchJson('frankfurter', FRANKFURTER_URL, fromFrankfurter);
  const primary = hana || erapi || frank;
  let out;
  if (primary) {
    out = mergeRates(primary, hana ? erapi : (erapi ? null : null));
    if (!hana && erapi && frank) out = mergeRates(erapi, frank);
    out.generatedAt = new Date().toISOString();
    log(`결과: source=${out.source}, ${Object.keys(out.rates).length} 통화, usdCross ${Object.keys(out.usdCross || {}).length} 개, filledFrom=${out.filledFrom || '-'}`);
  } else {
    let prev = null;
    try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* 없으면 아래 */ }
    out = prev ? { ...prev, note: `모든 소스 실패 ${new Date().toISOString()} — 이전 파일 유지` } : { source: 'none', asof: null, rates: {}, usdCross: {} };
    log('🔴 모든 환율 소스 실패. 이전 rates.json 을 그대로 둠 — 앱이 브라우저에서 er-api 를 다시 시도함');
  }
  await writeFile(OUT, JSON.stringify(out, null, 1));
  log(`wrote ${OUT.pathname}`);
}

main().catch((e) => { log(`치명적 오류: ${e.stack || e}`); process.exitCode = 0; });
