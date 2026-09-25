import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLedger, chosung, encodeImport, decodeImport } from '../importer.js';

const notion = `애기랑 나랑 같이 쓴돈
주찬이 낸돈 = ㅈ.     서정이가 낸돈 = ㅅ
ㅈ공항 버스 100
ㅈ카사블랑카 호텔 마제스틱 82.84 +12.4 유로 = 95.24유로 = 152,300원
ㅈ빵 + 망고주스 큰거 = 5 + 22 = 27
ㅈ생선튀김 + 감튀 65
ㅈ마트. 10
ㅈ굴. 15
ㅈ심카드 *554#   ->   4 오른쪽 누르기  : 11기가  160다르함
ㅅ신메르디 가는버스 10
ㅅ민트티 + 망고주스 = 17+23 = 40
ㅅ코사미아. 40
ㅅ우육면. 80
ㅈ모스크 가는버스 10
ㅈ모스크 입장료 283
ㅅ해산물 식당 160
ㅈ마라케시 3박 144000원
ㅈ카사블랑카 역 택시 10
ㅈ카사블랑카에서 마라케시 기차 320
ㅈ사하라 여행 예약 191 달러
ㅅ호텔 버스 8
ㅈ닭고기레몬타진 + 쿠스쿠스+음료 = 55+ 85 +31 =171
ㅈ석류 큰거 2개   70
ㅈ피자 + 꼬치 + 모히또 = 38 + 60 + 40 =138
ㅈ궁전입장료 200
ㅈ입생로랑 박물관 660
ㅅ디저트 50
ㅈ샌드위치 40
ㅈ음료 10
ㅈ버스비 8
ㅅ마트 97.6
ㅈ 스파게티랑 타진 210
ㅅ 우베 + 레드과일 = 50 + 35 = 85 (내가 35주면됌)
ㅈ 바나나 20
ㅈ 달팽이 10
ㅈ 멜로 10
ㅈ 물 7
ㅈ 페즈 숙소 2박 60,000원
ㅈ 사막 로컬 투어 50

ㅈ 2604 다르함 + 356,300원 + 191달러
367900 + 356300 + 259200 = 984000원

ㅅ 526 다르함  = 74300원
토탈 105800원`;

test('chosung', () => {
  assert.equal(chosung('주'), 'ㅈ');
  assert.equal(chosung('서'), 'ㅅ');
  assert.equal(chosung('A'), 'A');
});

test('노션 정산 페이지 파싱: 건수·통화별 합계가 노션 합계와 일치', () => {
  const { items, skipped, warnings } = parseLedger(notion, ['주찬', '서정']);
  const sum = (p, c) => items.filter((i) => i.payer === p && i.code === c).reduce((a, i) => a + i.amount, 0);
  assert.equal(items.length, 37);
  assert.ok(Math.abs(sum('주찬', 'MAD') - 2604) < 1e-9, `ㅈ MAD ${sum('주찬', 'MAD')}`);
  assert.equal(sum('주찬', 'KRW'), 356300);
  assert.equal(sum('주찬', 'USD'), 191);
  // 노션엔 'ㅅ 526 다르함' 이라 적혀 있지만 항목을 더하면 570.6 — 노션 손계산 쪽 오류(44.6 차이)
  assert.ok(Math.abs(sum('서정', 'MAD') - 570.6) < 1e-9, `ㅅ MAD ${sum('서정', 'MAD')}`);
  assert.equal(sum('서정', 'KRW'), 0);
  // 합계 줄·안내 줄은 항목이 아님
  assert.equal(skipped.length, 6);
  assert.ok(skipped.some((l) => l.startsWith('ㅈ 2604')));
  assert.ok(skipped.some((l) => l.startsWith('ㅅ 526')));
  // 괄호 메모는 경고로
  assert.equal(warnings.length, 1);
  const ube = items.find((i) => i.desc.includes('우베'));
  assert.equal(ube.amount, 85);
  assert.equal(ube.note, '내가 35주면됌');
  // 설명 정리
  assert.equal(items[0].desc, '공항 버스');
  assert.equal(items.find((i) => i.code === 'USD').desc, '사하라 여행 예약');
  assert.equal(items.find((i) => i.amount === 152300).code, 'KRW');
  assert.equal(items.find((i) => i.amount === 160).desc.startsWith('심카드'), true);
  assert.equal(items.find((i) => i.amount === 97.6).payer, '서정');
});

test('이름으로 시작하는 줄과 기본 통화 지정', () => {
  const { items } = parseLedger('주찬 라멘 1200엔\n서정 편의점 800', ['주찬', '서정'], 'JPY');
  assert.deepEqual(items.map((i) => [i.payer, i.amount, i.code]), [['주찬', 1200, 'JPY'], ['서정', 800, 'JPY']]);
});

test('encode/decode 왕복 (한글 포함)', () => {
  const p = { v: 1, trip: { name: '모로코', code: 'MAD' }, people: ['주찬', '서정'], items: [{ p: 0, d: '빵 + 망고주스', a: 27, c: 'MAD' }] };
  const s = encodeImport(p);
  assert.ok(/^[A-Za-z0-9_-]+$/.test(s));
  assert.deepEqual(decodeImport(s), p);
  assert.throws(() => decodeImport(encodeImport({ v: 2 })));
});
