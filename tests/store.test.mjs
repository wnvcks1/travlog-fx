import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, mergeState, FIXED_CROSS } from '../store.js';

const saved = (extra = {}) => ({
  version: 1, people: ['주찬', '서정'], ratio: [1, 1],
  trips: [{ id: 't', name: '모로코', code: 'MAD', items: [] }], activeTrip: 't',
  manual: { krw: {}, usdCross: {} }, ...extra,
});

test('기본 상태에 USD 1 = 9.2 MAD 고정값이 들어 있음', () => {
  const d = defaultState();
  assert.equal(d.manual.usdCross.MAD, 9.2);
  assert.equal(FIXED_CROSS.MAD, 9.2);
  assert.equal(d.migrated.mad92, true);
});

test('옛 저장본(고정값 없음)은 한 번만 9.2 를 채움', () => {
  const s = mergeState(defaultState(), saved());
  assert.equal(s.manual.usdCross.MAD, 9.2);
  assert.equal(s.migrated.mad92, true);
});

test('사용자가 지운 뒤에는 다시 넣지 않고, 직접 넣은 값은 유지', () => {
  const deleted = mergeState(defaultState(), saved({ migrated: { mad92: true } }));
  assert.equal(deleted.manual.usdCross.MAD, undefined);
  const own = mergeState(defaultState(), saved({ manual: { krw: {}, usdCross: { MAD: 9.5 } } }));
  assert.equal(own.manual.usdCross.MAD, 9.5);
});
