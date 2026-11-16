/**
 * 정산 항목 카테고리. 내용(desc)의 낱말로 자동 분류하고, 사람이 고른 값(item.cat)이 있으면 그게 우선.
 *
 * 규칙은 위에서부터 처음 맞는 것(Chan 내역 290여 건으로 맞춤, 2026-11-16). 순서가 곧 우선순위:
 * "버스 취소 수수료" → 수수료, "호텔 버스" → 교통, "과자 쇼핑" → 쇼핑, "마트 음료수" → 마트,
 * "닭고기타진 + 음료" → 식사(식사가 간식보다 먼저).
 */

/** @typedef {{id:string, name:string, icon:string}} Category */

/** @type {Category[]} 화면에 보이는 순서 */
export const CATEGORIES = [
  { id: 'meal', name: '식사', icon: '🍽️' },
  { id: 'snack', name: '간식·음료', icon: '🧋' },
  { id: 'transport', name: '교통', icon: '🚕' },
  { id: 'stay', name: '숙소', icon: '🏨' },
  { id: 'tour', name: '관광·체험', icon: '🎟️' },
  { id: 'shop', name: '쇼핑', icon: '🛍️' },
  { id: 'mart', name: '마트·생활', icon: '🛒' },
  { id: 'phone', name: '통신', icon: '📱' },
  { id: 'fee', name: '수수료·팁', icon: '💸' },
  { id: 'etc', name: '기타', icon: '📦' },
];

/** @type {Record<string, Category>} */
export const CAT_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

// 한 글자 낱말은 앞뒤가 한글이 아닐 때만(동굴의 '굴', 동물원의 '물' 제외)
const word = (w) => `(?<![가-힣])${w}(?![가-힣])`;

/** @type {Array<[string, RegExp]>} */
const RULES = [
  ['fee', /수수료|atm|팁/],
  ['phone', /심카드|유심|이심|esim|데이터|로밍/],
  ['transport', /버스|택시|지하철|기차|철도|셔틀|교통|트램|페리|비행기|항공|우버|uber|디디|didi|그랩|메트로|metro|렌터카|렌트카|주유|flix/],
  ['stay', /숙소|숙박|호텔|hotel|호스텔|hostel|에어비앤비|airbnb|리아드|민박|게스트하우스|료칸|\d+\s*박(?!물)/],
  ['tour', /입장|티켓|박물관|미술관|궁전|모스크|성당|사원|동물원|투어|가이드|관광|전망대|공연|극장|체험|하맘|스파(?!게티)|마사지|때밀이|분장|페인트|얼굴|화장(?!실|품)|여행\s*예약/],
  ['shop', /옷|드레스|머리띠|모자|신발|선물|기념품|포스트카드|엽서|쇼핑|지그재그|쿠팡|면세|화장품|향수|비누|스카프|액세서리|귀걸이|목걸이/],
  ['mart', /마트|슈퍼|편의점|세븐일레븐|oxxo|옥소|봉투|수건|스펀지|빨래|세탁|담배|약국|생필품|장보기/],
  ['meal', new RegExp([
    '식사', '식당', '점심', '저녁', '아침', '브런치', '타코', '타진', '쿠스쿠스', '피자', '파스타', '스파게티', '버거', '샌드위치',
    '부리또', '타말', '메누도', '세비체', '포솔레', '엔칠라다', '국수', '라면', '우육면', '라멘', '우동', '마라탕', '마라반', '훠궈',
    '딤섬', '만두', '꼬치', '덮밥', '볶음밥', '솥밥', '죽', '꿔바로우', '마파두부', '가정식', '고기', '곱창', '허파', '생선', '해산물',
    '새우', '오징어', '튀김', '감튀', '달팽이', '두부', '스테이크', '치킨', '닭', word('굴'), word('밥'),
  ].join('|'))],
  ['snack', new RegExp([
    '콜라', '음료', '주스', '스무디', '티(?![가-힣])', '라떼', '치노', '커피', '카페', '우유', '요거트', '아이스크림', '젤라또', '빙수',
    '디저트', '케익', '케이크', '크레페', '추러스', '츄러스', '과자', '사탕', '팝콘', '초콜릿', '빵', '군밤', '고구마', '과일', '망고',
    '바나나', '귤', '멜론', '블루베리', '샤인머스켓', '석류', '딸기', '수박', '포도', '간식', '치즈', '미쉐', '모히또', '맥주',
    word('물'), word('술'),
  ].join('|'))],
];

/**
 * 내용으로 카테고리 추측. 못 맞추면 'etc'.
 * @param {string} desc
 * @returns {string} 카테고리 id
 */
export function guessCategory(desc) {
  const t = String(desc || '').toLowerCase();
  if (!t.trim()) return 'etc';
  for (const [id, re] of RULES) if (re.test(t)) return id;
  return 'etc';
}

/**
 * 항목의 카테고리: 사람이 고른 것(it.cat) → 자동.
 * @param {{desc?:string, cat?:string}} it
 * @returns {string}
 */
export function categoryOf(it) {
  return it.cat && CAT_BY_ID[it.cat] ? it.cat : guessCategory(it.desc);
}

/**
 * 카테고리별 합계(큰 것부터). 비율은 전체 원화 합 대비 %.
 * @param {Array<{desc?:string, cat?:string}>} items
 * @param {(it: object) => number} krwOf 항목 → 원화
 * @returns {Array<Category & {krw:number, n:number, pct:number}>}
 */
export function categoryTotals(items, krwOf) {
  /** @type {Record<string, {krw:number, n:number}>} */
  const acc = {};
  let total = 0;
  for (const it of items) {
    const v = krwOf(it);
    if (!Number.isFinite(v)) throw new RangeError(`원화 환산 실패: ${it.desc || '(내용 없음)'}`);
    const id = categoryOf(it);
    acc[id] = acc[id] || { krw: 0, n: 0 };
    acc[id].krw += v;
    acc[id].n += 1;
    total += v;
  }
  return CATEGORIES.filter((c) => acc[c.id])
    .map((c) => ({ ...c, krw: acc[c.id].krw, n: acc[c.id].n, pct: total > 0 ? (acc[c.id].krw / total) * 100 : 0 }))
    .sort((a, b) => b.krw - a.krw);
}
