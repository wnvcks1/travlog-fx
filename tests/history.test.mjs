import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHistory, sliceYears, summarize, niceTicks, chartModel, loadHistory, hasHistory, PEGS } from '../history.js';
import { searchCurrencies, findCurrency, currencyInfo } from '../currencies.js';

const sample = { base: 'MXN', rates: { '2021-10-20': { KRW: 58.1 }, '2021-10-19': { KRW: 57.9 }, '2024-05-02': { KRW: 80.2 }, '2025-10-17': { KRW: 70 }, '2026-10-19': { KRW: 71.9 }, bad: { KRW: 1 }, '2026-10-18': { KRW: null } } };

test('parseHistory: 날짜순, 잘못된 값은 버림, 비면 throw', () => {
  const p = parseHistory(sample);
  assert.deepEqual(p.map((x) => x[0]), ['2021-10-19', '2021-10-20', '2024-05-02', '2025-10-17', '2026-10-19']);
  assert.throws(() => parseHistory({ rates: {} }), /비어/);
  assert.throws(() => parseHistory(null), /형식/);
});

test('sliceYears·summarize: 1년 자르기와 처음·끝·최저·최고·변화율', () => {
  const p = parseHistory(sample);
  assert.deepEqual(sliceYears(p, 1).map((x) => x[0]), ['2025-10-17', '2026-10-19'].filter((d) => d >= '2025-10-19'));
  const s = summarize(p);
  assert.equal(s.first[1], 57.9);
  assert.equal(s.max[0], '2024-05-02');
  assert.ok(Math.abs(s.changePct - (71.9 / 57.9 - 1) * 100) < 1e-9);
});

test('niceTicks: 범위를 덮는 깔끔한 눈금', () => {
  const t = niceTicks(57.9, 80.2);
  assert.deepEqual(t, [55, 60, 65, 70, 75, 80, 85]);
  const j = niceTicks(8.12, 8.97);
  assert.ok(j[0] <= 8.12 && j[j.length - 1] >= 8.97 && j.length >= 3 && j.length <= 8);
  assert.ok(niceTicks(5, 5).length >= 2);
});

test('chartModel: 좌표가 상자 안, NaN 없음, 5년이면 해마다 눈금', () => {
  const p = parseHistory(sample);
  const box = { w: 340, h: 200, left: 40, right: 12, top: 10, bottom: 22 };
  const m = chartModel(p, box);
  assert.equal(m.xs.length, p.length);
  for (let i = 0; i < m.xs.length; i += 1) {
    assert.ok(m.xs[i] >= box.left - 0.01 && m.xs[i] <= box.w - box.right + 0.01);
    assert.ok(m.ys[i] >= box.top - 0.01 && m.ys[i] <= box.h - box.bottom + 0.01);
  }
  assert.ok(!/NaN/.test(m.line + m.area));
  assert.deepEqual(m.xTicks.map((x) => x.label), ['2022', '2023', '2024', '2025', '2026']);
});

test('loadHistory: 받아서 캐시, 고정환율 통화는 환산, 실패하면 캐시', async () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  let url = '';
  const ok = async (u) => { url = u; return { ok: true, json: async () => ({ rates: { '2021-10-20': { KRW: 1170 }, '2026-10-19': { KRW: 1357 } } }) }; };
  const r = await loadHistory('AED', { fetchFn: ok, storage, now: Date.parse('2026-10-20T00:00:00Z') });
  assert.match(url, /2021-10-20\.\.2026-10-20\?base=USD&symbols=KRW/);
  assert.ok(Math.abs(r.points[1][1] - 1357 / PEGS.AED[1]) < 1e-9);
  assert.equal(r.fromCache, false);
  const again = await loadHistory('AED', { fetchFn: async () => { throw new Error('x'); }, storage, now: Date.parse('2026-10-20T01:00:00Z') });
  assert.equal(again.fromCache, true);
  const stale = await loadHistory('AED', { fetchFn: async () => { throw new Error('오프라인'); }, storage, now: Date.parse('2026-10-25T00:00:00Z') });
  assert.equal(stale.fromCache, true);
  await assert.rejects(() => loadHistory('MAD', { storage }), /데이터가 없음/);
  assert.equal(hasHistory('KRW'), false);
});

test('searchCurrencies: 나라 이름 일부·통화 이름·코드·도시', () => {
  const codes = (q) => searchCurrencies(q).map((c) => c.code);
  assert.equal(codes('멕')[0], 'MXN');
  assert.equal(codes('멕시코')[0], 'MXN');
  assert.ok(codes('페소').includes('MXN') && codes('페소').includes('ARS') && codes('페소').includes('PHP'));
  assert.equal(codes('THB')[0], 'THB');
  assert.equal(codes('상하이')[0], 'CNY');
  assert.equal(codes('페루')[0], 'PEN');
  assert.equal(codes('아이슬란드')[0], 'ISK');
  assert.deepEqual(codes(''), []);
  assert.equal(findCurrency('타히티'), 'XPF');
  assert.equal(findCurrency('프랑스'), 'EUR');
  assert.equal(currencyInfo('PEN').travlog, 'none');
});
