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

test('기본 이름은 으뜸·서정, 메모 초성은 ㅈ·ㅅ', () => {
  const d = defaultState();
  assert.deepEqual(d.people, ['으뜸', '서정']);
  assert.deepEqual(d.initials, ['ㅈ', 'ㅅ']);
});

test('옛 기본 이름(나·동행) 저장본은 으뜸·서정으로 바꾸고 내역의 낸 사람도 바꿈', () => {
  const s = mergeState(defaultState(), saved({
    people: ['나', '동행'],
    trips: [{ id: 't', name: '모로코', code: 'MAD', items: [{ id: 'a', payer: '동행', forWho: '나', amount: 1, code: 'MAD', krw: 147 }] }],
  }));
  assert.deepEqual(s.people, ['으뜸', '서정']);
  assert.equal(s.trips[0].items[0].payer, '서정');
  assert.equal(s.trips[0].items[0].forWho, '으뜸');
  assert.deepEqual(s.initials, ['ㅈ', 'ㅅ']);
  assert.equal(s.migrated.names2, true);
});

test('사용자가 정한 이름은 그대로. 초성 없으면 이름 첫 글자 초성', () => {
  const s = mergeState(defaultState(), saved({ people: ['주찬', '서정'] }));
  assert.deepEqual(s.people, ['주찬', '서정']);
  assert.deepEqual(s.initials, ['ㅈ', 'ㅅ']);
  const t = mergeState(defaultState(), saved({ people: ['민수', '서정'], initials: ['', 'ㅅ'] }));
  assert.deepEqual(t.initials, ['ㅁ', 'ㅅ']);
});
