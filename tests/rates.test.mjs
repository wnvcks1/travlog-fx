import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromErApi, fromFrankfurter, mergeRates, pickPrimary, hoursOld, loadRates } from '../rates.js';

const er = { result: 'success', time_last_update_unix: 1790294400, rates: { USD: 1, KRW: 1400, MAD: 9.2, JPY: 150, CAD: 1.36, ZZZ: 3 } };
const fr = { base: 'USD', date: '2026-09-24', rates: { KRW: 1398, JPY: 149, CAD: 1.35 } };

test('fromErApi: KRW 기준 mid 와 usdCross', () => {
  const r = fromErApi(er);
  assert.equal(r.source, 'erapi');
  assert.equal(r.rates.USD.mid, 1400);
  assert.ok(Math.abs(r.rates.JPY.mid - 1400 / 150) < 1e-9);
  assert.equal(r.rates.JPY.unit, 1);
  assert.equal(r.rates.ZZZ, undefined); // 테이블에 없는 통화는 rates 엔 안 넣고
  assert.equal(r.usdCross.ZZZ, 3); // usdCross 엔 남김
  assert.equal(r.asof, '2026-09-25T00:00:00.000Z');
  assert.throws(() => fromErApi({ result: 'error' }));
});

test('fromFrankfurter', () => {
  const r = fromFrankfurter(fr);
  assert.equal(r.source, 'frankfurter');
  assert.equal(r.rates.USD.mid, 1398);
  assert.equal(r.usdCross.USD, 1);
  assert.equal(r.asof, '2026-09-24T16:00:00Z');
  assert.throws(() => fromFrankfurter({ base: 'EUR', rates: { KRW: 1 } }));
});

test('mergeRates: primary 유지, 빈 통화·교차만 채움', () => {
  const hana = { source: 'hana', asof: '2026-09-25T00:30:00Z', rates: { USD: { mid: 1401, unit: 1 }, JPY: { mid: 940, unit: 100 } }, usdCross: {} };
  const m = mergeRates(hana, fromErApi(er));
  assert.equal(m.source, 'hana');
  assert.equal(m.rates.JPY.mid, 940);
  assert.equal(m.rates.CAD.src, 'erapi');
  assert.equal(m.usdCross.MAD, 9.2);
  assert.equal(m.filledFrom, 'erapi');
  assert.equal(mergeRates(null, null), null);
  assert.equal(mergeRates(null, hana), hana);
});

test('pickPrimary: 신선한 하나은행 우선, 오래되면 라이브 API', () => {
  const now = Date.parse('2026-09-26T00:00:00Z');
  const hanaFresh = { source: 'hana', asof: '2026-09-25T20:00:00Z', rates: { USD: { mid: 1401 } } };
  const hanaOld = { source: 'hana', asof: '2026-09-20T00:00:00Z', rates: { USD: { mid: 1300 } } };
  const e = fromErApi(er);
  assert.equal(pickPrimary({ hana: hanaFresh, erapi: e }, 36, now).primary.source, 'hana');
  const p = pickPrimary({ hana: hanaOld, erapi: e }, 36, now);
  assert.equal(p.primary.source, 'erapi');
  assert.equal(p.secondary.source, 'hana');
  assert.equal(pickPrimary({ hana: hanaOld }, 36, now).primary.source, 'hana');
  assert.equal(pickPrimary({ cache: e }, 36, now).primary.source, 'erapi');
  assert.equal(pickPrimary({}, 36, now).primary, null);
  assert.equal(hoursOld(null), Infinity);
});

test('loadRates: 네트워크 전부 실패해도 캐시로 살아남고 로그를 남김', async () => {
  const failing = async () => { throw new Error('offline'); };
  const cache = fromErApi(er);
  const r = await loadRates({ fetchImpl: failing, cache, timeoutMs: 100 });
  assert.equal(r.rates.source, 'erapi');
  assert.equal(r.log.length, 4);
  assert.ok(r.log.every((l) => l.includes('실패')));
  const none = await loadRates({ fetchImpl: failing, timeoutMs: 100 });
  assert.equal(none.rates, null);
});

test('loadRates: rates.json 만 성공하면 그것을 씀', async () => {
  const hana = { source: 'hana', asof: new Date().toISOString(), rates: { USD: { mid: 1401, unit: 1 } }, usdCross: {} };
  const fetchImpl = async (url) => {
    if (String(url).includes('rates.json')) return { ok: true, json: async () => hana };
    throw new Error('blocked');
  };
  const r = await loadRates({ fetchImpl, timeoutMs: 100 });
  assert.equal(r.rates.source, 'hana');
  assert.equal(r.rates.rates.USD.mid, 1401);
});

import { fromFxcod } from '../rates.js';

test('fromFxcod: 하나은행 값 우선, 없으면 KB, unit·환급가·USD 교차', () => {
  const j = { updatedAt: '2026-09-25T22:51:00+09:00', baseDate: '2026-09-23', rates: {
    USD: { hana: { code: 'USD', unit: 1, baseRate: 1356.3, cashBuy: 1380.03, cashSell: 1332.57, send: 1369.5, receive: 1343.1 }, kb: { baseRate: 1356 } },
    JPY: { hana: { code: 'JPY', unit: 100, baseRate: 863.67, cashBuy: 878.78, cashSell: 848.56, send: 872.13, receive: 855.21 } },
    INR: { hana: { code: 'INR', unit: 1, baseRate: 14.16, cashBuy: 0, cashSell: 0, send: 14.32, receive: 14.0 } },
    XXX: { kb: { code: 'XXX', unit: 1, baseRate: 10, cashBuy: 11, cashSell: 9, send: 10.1, receive: 9.9 } },
    ZZZ: { hana: { baseRate: 0 } },
  } };
  const r = fromFxcod(j);
  assert.equal(r.source, 'hana');
  assert.equal(r.via, 'fxcod');
  assert.equal(r.asof, '2026-09-25T22:51:00+09:00');
  assert.equal(r.baseDate, '2026-09-23');
  assert.equal(r.rates.USD.mid, 1356.3);
  assert.equal(r.rates.USD.ttb, 1343.1);
  assert.equal(r.rates.JPY.unit, 100);
  assert.equal(r.rates.INR.cashBuy, undefined);
  assert.equal(r.rates.XXX.src, 'kb');
  assert.equal(r.rates.ZZZ, undefined);
  assert.ok(Math.abs(r.usdCross.JPY - 1356.3 / 8.6367) < 1e-9);
  assert.throws(() => fromFxcod({ rates: { JPY: { hana: { baseRate: 9, unit: 100 } } } }), /USD/);
  assert.throws(() => fromFxcod(null));
});

test('pickPrimary: rates.json 과 FXCOD 둘 다 하나은행이면 더 신선한 쪽', () => {
  const now = Date.parse('2026-09-26T00:00:00Z');
  const older = { source: 'hana', asof: '2026-09-25T10:00:00Z', rates: { USD: { mid: 1300 } } };
  const newer = { source: 'hana', via: 'fxcod', asof: '2026-09-25T20:00:00Z', rates: { USD: { mid: 1356 } } };
  assert.equal(pickPrimary({ hana: older, fxcod: newer }, 36, now).primary.rates.USD.mid, 1356);
  assert.equal(pickPrimary({ hana: newer, fxcod: older }, 36, now).primary.rates.USD.mid, 1356);
});
