import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessCategory, categoryOf, categoryTotals, CATEGORIES, CAT_BY_ID } from '../category.js';

test('guessCategory: 낱말로 분류', () => {
  const cases = {
    meal: ['곱창타코', '타코 3개', '점심 마라탕', '저녁 꿔바로우 마파두부 볶음밥', '아침죽', '우육면', '굴', '스파게티랑 타진', '해산물 식당', '세비체'],
    snack: ['물', '콜라 600ml', '흑당버블티', '눈사람 티', '카푸치노', '오레오 프레프치노', '망고 800g', '빵 + 망고주스 큰거', '치즈케익', '군밤'],
    transport: ['택시', '공항버스', '지하철 카드 구매', '황산북역 기차표', '동굴 내 셔틀', '가는 flix버스', '상하이 교통비', '호텔 버스'],
    stay: ['페즈 숙소 2박', '마라케시 3박', 'CDMX 4박 HOTEL MAX', '2박 숙박'],
    tour: ['모스크 입장료', '입장표', '사막 로컬 투어', '박물관', '가죽공장 가이드비', '하맘', '얼굴페인트', '여행 예약'],
    shop: ['한푸옷', '드레스', '비누 선물', '포스트카드', '과자 쇼핑 2', '쿠팡 풋크림'],
    mart: ['마트', '마트 음료수', '세븐일레븐 수박스무디', '봉투', '빨래', '담배 3보루'],
    phone: ['심카드 11기가', '이심 15일 10기가', '데이터 추가 2gb'],
    fee: ['Atm출금 수수료', '극장 팁', '사진팁', '버스 취소 수수료'],
    etc: ['', '다른것', '화장실', '짐값', '코사미아'],
  };
  for (const [id, list] of Object.entries(cases)) for (const d of list) assert.equal(guessCategory(d), id, `${d} → ${id}`);
});

test('guessCategory: 한 글자 낱말은 단독일 때만(동굴·동물원)', () => {
  assert.equal(guessCategory('동굴'), 'etc');
  assert.equal(guessCategory('동물원입장료'), 'tour');
  assert.equal(guessCategory('물 바나나'), 'snack');
  assert.equal(guessCategory('티켓'), 'tour');
});

test('categoryOf: 사람이 고른 값이 우선, 모르는 값은 무시', () => {
  assert.equal(categoryOf({ desc: '택시', cat: 'tour' }), 'tour');
  assert.equal(categoryOf({ desc: '택시', cat: 'nope' }), 'transport');
  assert.equal(categoryOf({ desc: '택시' }), 'transport');
});

test('categoryTotals: 큰 것부터, 비율 합 100', () => {
  const items = [
    { desc: '타코', krw: 3000 }, { desc: '택시', krw: 5000 }, { desc: '물', krw: 1000 }, { desc: '타코 5개', krw: 6000 }, { desc: '뭔가', krw: 0, cat: 'shop' },
  ];
  const r = categoryTotals(items, (it) => it.krw);
  assert.deepEqual(r.map((c) => [c.id, c.krw, c.n]), [['meal', 9000, 2], ['transport', 5000, 1], ['snack', 1000, 1], ['shop', 0, 1]]);
  assert.ok(Math.abs(r.reduce((a, c) => a + c.pct, 0) - 100) < 1e-9);
  assert.deepEqual(categoryTotals([], (it) => it.krw), []);
  assert.throws(() => categoryTotals([{ desc: 'x' }], () => NaN), RangeError);
  assert.equal(CATEGORIES.length, Object.keys(CAT_BY_ID).length);
});
