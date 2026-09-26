import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metaOf, buildPush, applyRemote, newRoomCode, normalizeCode } from '../sync.js';
import { defaultState } from '../store.js';

const mk = () => {
  const s = defaultState();
  s.sync = { code: 'ABCDEF', lastAt: 0, metaRev: 10 };
  s.tombstones = [];
  s.trips[0].items = [
    { id: 'a', ts: 1, payer: '으뜸이', desc: '물', amount: 7, code: 'MAD', krw: 1032, rev: 100, dirty: false },
    { id: 'b', ts: 2, payer: '서정이', desc: '빵', amount: 27, code: 'MAD', krw: 3980, rev: 200, dirty: true },
  ];
  return s;
};

test('방 코드: 6자 대문자, 정리 함수', () => {
  assert.match(newRoomCode(), /^[A-Z2-9]{6}$/);
  assert.equal(normalizeCode(' ab-cd ef '), 'ABCDEF');
  assert.equal(normalizeCode('abc'), '');
});

test('buildPush: dirty 항목과 삭제 기록만, all 이면 전부. rev 없는 항목은 now 로', () => {
  const s = mk();
  s.trips[0].items.push({ id: 'c', payer: '으뜸이', desc: '새것', amount: 1, code: 'MAD', krw: 147 });
  s.tombstones.push({ id: 'z', rev: 300 });
  const p = buildPush(s, { now: 999 });
  assert.deepEqual(p.items.map((i) => [i.id, i.rev, i.deleted]), [['b', 200, false], ['c', 999, false], ['z', 300, true]]);
  assert.equal(p.items[0].data.trip, 'trip1');
  assert.equal('dirty' in p.items[0].data, false);
  assert.equal(p.meta_rev, 10);
  assert.deepEqual(p.meta.people, ['으뜸이', '서정이']);
  assert.equal(buildPush(s, { all: true, now: 999 }).items.length, 4);
});

test('applyRemote: 서버 rev 가 크면 덮고, 같으면 dirty 해제, 작으면 로컬 유지. 삭제 전파. 새 항목 추가', () => {
  const s = mk();
  const r = applyRemote(s, { meta_rev: 5, meta: null, items: [
    { id: 'a', data: { trip: 'trip1', payer: '으뜸이', desc: '물 큰거', amount: 10, code: 'MAD', krw: 1474 }, rev: 150, deleted: false },
    { id: 'b', data: { trip: 'trip1', payer: '서정이', desc: '빵(옛값)', amount: 20, code: 'MAD', krw: 2948 }, rev: 199, deleted: false },
    { id: 'n', data: { trip: 'trip1', payer: '서정이', desc: '택시', amount: 30, code: 'MAD', krw: 4423 }, rev: 400, deleted: false },
  ] });
  assert.deepEqual([r.added, r.updated, r.removed, r.metaApplied], [1, 1, 0, false]);
  const items = s.trips[0].items;
  assert.equal(items.find((i) => i.id === 'a').desc, '물 큰거');
  assert.equal(items.find((i) => i.id === 'a').dirty, false);
  assert.equal(items.find((i) => i.id === 'b').desc, '빵');
  assert.equal(items.find((i) => i.id === 'b').dirty, true);
  assert.equal(items.find((i) => i.id === 'n').payer, '서정이');
  // 같은 rev → dirty 해제
  applyRemote(s, { items: [{ id: 'b', data: { trip: 'trip1' }, rev: 200, deleted: false }] });
  assert.equal(items.find((i) => i.id === 'b').dirty, false);
  // 삭제: rev 500 >= 로컬 rev
  const r2 = applyRemote(s, { items: [{ id: 'n', data: {}, rev: 500, deleted: true }] });
  assert.equal(r2.removed, 1);
  assert.equal(s.trips[0].items.some((i) => i.id === 'n'), false);
  // 로컬에서 지운 기록(rev 900)이 더 새로우면 서버의 옛 항목을 되살리지 않음
  s.tombstones.push({ id: 'old', rev: 900 });
  applyRemote(s, { items: [{ id: 'old', data: { trip: 'trip1', desc: 'x', amount: 1, code: 'MAD', payer: '으뜸이' }, rev: 800, deleted: false }] });
  assert.equal(s.trips[0].items.some((i) => i.id === 'old'), false);
});

test('applyRemote: 메타는 metaRev 가 클 때만 통째로. 여행 목록은 합치고 이름·통화 갱신', () => {
  const s = mk();
  const meta = { ...metaOf(s), people: ['으뜸이', '서정이'], cash: [{ id: 'c1', person: '서정이', code: 'MAD', amount: 500, ts: 0, note: '' }],
    trips: [{ id: 'trip1', name: '모로코', code: 'MAD' }, { id: 't2', name: '일본', code: 'JPY' }], travlog: { rates: { USD: 1359 }, at: '2026-09-26' } };
  assert.equal(applyRemote(s, { meta, meta_rev: 9, items: [] }).metaApplied, false);
  const r = applyRemote(s, { meta, meta_rev: 11, items: [] });
  assert.equal(r.metaApplied, true);
  assert.equal(s.sync.metaRev, 11);
  assert.equal(s.trips[0].name, '모로코');
  assert.equal(s.trips.length, 2);
  assert.equal(s.cash[0].amount, 500);
  assert.equal(s.travlog.rates.USD, 1359);
});
