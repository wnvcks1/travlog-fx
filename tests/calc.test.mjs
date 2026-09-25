import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  krwPerUnit, toKrw, fromKrw, toCad, fromCad, convert, refundLoss, itemKrw, settle, fmt, ageHours, RateMissingError,
} from '../calc.js';
import { CURRENCIES, TRAVLOG_COUNT, currencyInfo } from '../currencies.js';

const rates = {
  source: 'hana',
  asof: '2026-09-25T09:30:00+09:00',
  rates: {
    USD: { mid: 1357.07, ttb: 1343.9, tts: 1370.2, unit: 1 },
    JPY: { mid: 912.3, ttb: 903.4, tts: 921.2, unit: 100 },
    CAD: { mid: 1000, ttb: 990, tts: 1010, unit: 1 },
    TWD: { mid: 42.5, ttb: 42.0, tts: 43.0, unit: 1 },
  },
  usdCross: { MAD: 9.6, INR: 83.4 },
};
const ctx = { rates, manual: {} };

test('통화 테이블: 트래블로그 56종(58종 중 2종 미확인), 코드 중복 없음', () => {
  assert.equal(TRAVLOG_COUNT, 56);
  const codes = CURRENCIES.map((c) => c.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(currencyInfo('XXX').travlog, 'none');
  assert.equal(currencyInfo('JPY').unit, 100);
});

test('krwPerUnit 우선순위: 수동 원화 > 수동 교차 > 고시 > USD 교차', () => {
  assert.equal(krwPerUnit('KRW', ctx).rate, 1);
  assert.deepEqual(krwPerUnit('USD', ctx).source, 'hana');
  assert.ok(Math.abs(krwPerUnit('JPY', ctx).rate - 9.123) < 1e-9);
  const cross = krwPerUnit('MAD', ctx);
  assert.equal(cross.source, 'cross');
  assert.ok(Math.abs(cross.rate - 1357.07 / 9.6) < 1e-9);
  const mc = krwPerUnit('MAD', { rates, manual: { usdCross: { MAD: 9.2 } } });
  assert.equal(mc.source, 'manual-cross');
  assert.ok(Math.abs(mc.rate - 1357.07 / 9.2) < 1e-9);
  const mk = krwPerUnit('MAD', { rates, manual: { krw: { MAD: 141.28 }, usdCross: { MAD: 9.2 } } });
  assert.equal(mk.source, 'manual');
  assert.equal(mk.rate, 141.28);
});

test('환율 없으면 throw (조용한 오답 금지)', () => {
  assert.throws(() => krwPerUnit('XXX', ctx), RateMissingError);
  assert.throws(() => toKrw(1, 'XXX', ctx), RateMissingError);
  assert.throws(() => toKrw(NaN, 'USD', ctx), TypeError);
  assert.throws(() => toKrw('12', 'USD', ctx), TypeError);
  // USD 고시가 없으면 교차환율도 못 씀
  assert.throws(() => krwPerUnit('MAD', { rates: { rates: {}, usdCross: { MAD: 9.6 } } }), RateMissingError);
});

test('외화→원화→캐달, 역방향 왕복', () => {
  assert.ok(Math.abs(toKrw(191, 'USD', ctx) - 259200.37) < 1e-6);
  assert.ok(Math.abs(toKrw(1000, 'JPY', ctx) - 9123) < 1e-9);
  const c = convert(100, 'MAD', ctx);
  assert.ok(Math.abs(c.krw - 14136.145833) < 1e-5);
  assert.ok(Math.abs(c.cad - 14.136145833) < 1e-8);
  assert.equal(c.source, 'cross');
  assert.ok(Math.abs(toCad(100, 'MAD', ctx) - c.cad) < 1e-12);
  assert.ok(Math.abs(fromKrw(toKrw(1234.5, 'JPY', ctx), 'JPY', ctx) - 1234.5) < 1e-9);
  assert.ok(Math.abs(fromCad(toCad(77, 'USD', ctx), 'USD', ctx) - 77) < 1e-9);
  assert.equal(toKrw(0, 'USD', ctx), 0);
});

test('환급 손실: 전신환 매입률 + 1% 수수료 / 0.99% 스프레드 통화', () => {
  const r = refundLoss(10000, 'JPY', ctx);
  assert.ok(Math.abs(r.midKrw - 91230) < 1e-9);
  assert.ok(Math.abs(r.spreadKrw - 890) < 1e-9);
  assert.ok(Math.abs(r.feeKrw - 903.4) < 1e-9);
  assert.ok(Math.abs(r.refundKrw - (90340 - 903.4)) < 1e-9);
  assert.ok(Math.abs(r.lossKrw - (890 + 903.4)) < 1e-9);
  const t = refundLoss(1000, 'TWD', ctx, { feePct: 1 });
  assert.ok(Math.abs(t.spreadKrw - 42500 * 0.0099) < 1e-9);
  const z = refundLoss(50, 'USD', ctx, { feePct: 0 });
  assert.equal(z.feeKrw, 0);
});

test('정산: 노션 「여행 정산 9.2 = 1달라」 픽스처', () => {
  // 노션 메모의 환산: 2604 MAD → 367,900원 (141.28원/MAD), 191 USD → 259,200원
  const c2 = { rates, manual: { krw: { MAD: 141.28 } } };
  const people = ['주찬', '서정'];
  const items = [
    { payer: '주찬', desc: '다르함 합계', amount: 2604, code: 'MAD' },
    { payer: '주찬', desc: '원화 결제 합계', amount: 356300, code: 'KRW' },
    { payer: '주찬', desc: '사하라 투어', amount: 191, code: 'USD' },
    { payer: '서정', desc: '다르함 합계', amount: 526, code: 'MAD' },
  ];
  const s = settle(items, people, c2);
  assert.equal(s.paid['주찬'], 367893 + 356300 + 259200);
  assert.equal(s.paid['서정'], 74313);
  assert.equal(s.total, 1057706);
  assert.equal(s.share['주찬'], 528853);
  assert.equal(s.share['서정'], 528853);
  assert.equal(s.transfers.length, 1);
  assert.deepEqual([s.transfers[0].from, s.transfers[0].to, s.transfers[0].krw], ['서정', '주찬', 454540]);
  assert.ok(Math.abs(s.transfers[0].cad - 454.54) < 1e-9);
  assert.equal(s.balance['주찬'] + s.balance['서정'], 0);
});

test('정산: 비율·홀수 나머지·스냅샷·빈 목록·모르는 사람', () => {
  const people = ['A', 'B'];
  const s = settle([{ payer: 'A', amount: 1001, code: 'KRW' }], people, ctx, [3, 2]);
  assert.equal(s.share.A + s.share.B, 1001);
  assert.equal(s.share.A, 601); // floor(600.6)=600 + 나머지 1
  assert.equal(s.share.B, 400);
  assert.equal(s.transfers[0].krw, 400);

  // 스냅샷이 있으면 현재 환율이 바뀌어도 그대로
  assert.equal(itemKrw({ amount: 10, code: 'USD', krw: 12345.4 }, ctx), 12345);
  assert.equal(itemKrw({ amount: 10, code: 'USD' }, ctx), 13571);

  const e = settle([], people, ctx);
  assert.equal(e.total, 0);
  assert.deepEqual(e.transfers, []);

  assert.throws(() => settle([{ payer: 'C', amount: 1, code: 'KRW' }], people, ctx), RangeError);
  assert.throws(() => settle([], people, ctx, [0, 0]), TypeError);

  // CAD 환율이 없어도 정산은 되고 cad 만 null
  const noCad = settle([{ payer: 'A', amount: 100, code: 'KRW' }], people, { rates: { rates: {} } });
  assert.equal(noCad.transfers[0].cad, null);
  assert.equal(noCad.cadRate, null);
});

test('정산: 균등 분할일 때 더 낸 쪽으로 송금 방향이 잡힘', () => {
  const s = settle(
    [{ payer: 'A', amount: 100, code: 'KRW' }, { payer: 'B', amount: 300, code: 'KRW' }],
    ['A', 'B'], ctx,
  );
  assert.deepEqual(s.transfers, [{ from: 'A', to: 'B', krw: 100, cad: 0.1 }]);
});

test('fmt / ageHours', () => {
  assert.equal(fmt(1057706), '1,057,706');
  assert.equal(fmt(13.9, 1), '13.9');
  assert.equal(fmt(NaN), '—');
  const now = Date.parse('2026-09-25T12:30:00+09:00');
  assert.equal(ageHours(rates, now), 3);
  assert.equal(ageHours(null), Infinity);
  assert.equal(ageHours({ asof: 'garbage' }), Infinity);
});

test('정산: 개인 몫(forWho) — 남이 대신 낸 개인 지출은 그 사람이 전액 부담', () => {
  const people = ['주찬', '서정'];
  const items = [
    { payer: '서정', desc: '레드과일', amount: 35, code: 'KRW', forWho: '주찬' },
    { payer: '주찬', desc: '타진', amount: 100, code: 'KRW' },
  ];
  const s = settle(items, people, ctx);
  assert.equal(s.shared, 100);
  assert.deepEqual(s.personal, { 주찬: 35, 서정: 0 });
  assert.deepEqual(s.share, { 주찬: 85, 서정: 50 });
  assert.deepEqual(s.paid, { 주찬: 100, 서정: 35 });
  // 주찬 잔액 +15, 서정 −15 → 서정이 주찬에게 15
  assert.deepEqual([s.transfers[0].from, s.transfers[0].to, s.transfers[0].krw], ['서정', '주찬', 15]);
  assert.throws(() => settle([{ payer: '주찬', amount: 1, code: 'KRW', forWho: '누구' }], people, ctx), RangeError);
});
