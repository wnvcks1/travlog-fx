/**
 * 트래블로그(하나카드) 지갑 통화 테이블.
 *
 * travlog 값: 'always' 상시 무료환전 4종 / 'event' 2026-12-31 까지 무료환전 이벤트 /
 * 'none' 트래블로그 미지원(USD 지갑에서 마스터카드 환율로 결제).
 * unit 은 하나은행 고시 단위(엔·루피아·동은 100 단위 고시). rates.json 에 unit 이 있으면 그쪽이 우선.
 * spread099 는 환급 시 매매기준율×(1−0.99%) 로 계산되는 통화(하나카드 안내 기준, 확신 80%).
 *
 * 목록 출처: 하나카드 트래블로그 안내(2026-09 웹검색)에서 확인된 51종 + SAR·KWD·BHD·ZAR·BRL 5종 추정(확신 60%).
 * 58종 중 2종은 미확인이라 테이블은 56종. 하나머니 앱 통화 목록과 대조해 틀리면 여기만 고치면 됨.
 */

/** @typedef {{code:string,name:string,sym:string,dec:number,unit:number,travlog:'always'|'event'|'none',spread099?:boolean,ceilDisplay?:boolean,defaultPay?:'cash'|'card'}} Currency */

/** @type {Currency[]} */
export const CURRENCIES = [
  // 상시 무료환전
  { code: 'USD', name: '미국 달러', sym: '$', dec: 2, unit: 1, travlog: 'always' },
  { code: 'JPY', name: '일본 엔', sym: '¥', dec: 0, unit: 100, travlog: 'always' },
  { code: 'EUR', name: '유로', sym: '€', dec: 2, unit: 1, travlog: 'always' },
  { code: 'GBP', name: '영국 파운드', sym: '£', dec: 2, unit: 1, travlog: 'always' },
  // 이벤트 무료환전 (2026-12-31 까지)
  { code: 'CAD', name: '캐나다 달러', sym: 'C$', dec: 2, unit: 1, travlog: 'event' },
  // defaultPay: 여행 결제 기본이 '자동'일 때 이 통화 항목은 현금(Chan: 중국 2026-10-05, 멕시코 2026-10-16)
  { code: 'CNY', name: '중국 위안', sym: '¥', dec: 2, unit: 1, travlog: 'event', defaultPay: 'cash' },
  { code: 'SGD', name: '싱가포르 달러', sym: 'S$', dec: 2, unit: 1, travlog: 'event' },
  { code: 'AUD', name: '호주 달러', sym: 'A$', dec: 2, unit: 1, travlog: 'event' },
  { code: 'VND', name: '베트남 동', sym: '₫', dec: 0, unit: 100, travlog: 'event' },
  { code: 'HKD', name: '홍콩 달러', sym: 'HK$', dec: 2, unit: 1, travlog: 'event' },
  { code: 'THB', name: '태국 바트', sym: '฿', dec: 2, unit: 1, travlog: 'event' },
  { code: 'CHF', name: '스위스 프랑', sym: 'Fr', dec: 2, unit: 1, travlog: 'event' },
  { code: 'PHP', name: '필리핀 페소', sym: '₱', dec: 2, unit: 1, travlog: 'event' },
  { code: 'SEK', name: '스웨덴 크로나', sym: 'kr', dec: 2, unit: 1, travlog: 'event' },
  { code: 'IDR', name: '인도네시아 루피아', sym: 'Rp', dec: 0, unit: 100, travlog: 'event' },
  { code: 'NZD', name: '뉴질랜드 달러', sym: 'NZ$', dec: 2, unit: 1, travlog: 'event' },
  { code: 'HUF', name: '헝가리 포린트', sym: 'Ft', dec: 0, unit: 1, travlog: 'event' },
  { code: 'CZK', name: '체코 코루나', sym: 'Kč', dec: 2, unit: 1, travlog: 'event' },
  { code: 'NOK', name: '노르웨이 크로네', sym: 'kr', dec: 2, unit: 1, travlog: 'event' },
  { code: 'TWD', name: '대만 달러', sym: 'NT$', dec: 0, unit: 1, travlog: 'event', spread099: true },
  { code: 'DKK', name: '덴마크 크로네', sym: 'kr', dec: 2, unit: 1, travlog: 'event' },
  { code: 'MYR', name: '말레이시아 링깃', sym: 'RM', dec: 2, unit: 1, travlog: 'event' },
  // 멕시코도 현금 기본(Chan 2026-10-16)
  { code: 'MXN', name: '멕시코 페소', sym: 'MX$', dec: 2, unit: 1, travlog: 'event', defaultPay: 'cash' },
  { code: 'AED', name: '아랍에미리트 디르함', sym: 'AED', dec: 2, unit: 1, travlog: 'event' },
  { code: 'TRY', name: '튀르키예 리라', sym: '₺', dec: 2, unit: 1, travlog: 'event' },
  { code: 'PLN', name: '폴란드 즈워티', sym: 'zł', dec: 2, unit: 1, travlog: 'event' },
  { code: 'SAR', name: '사우디 리얄', sym: 'SAR', dec: 2, unit: 1, travlog: 'event' },
  { code: 'KWD', name: '쿠웨이트 디나르', sym: 'KD', dec: 3, unit: 1, travlog: 'event' },
  { code: 'BHD', name: '바레인 디나르', sym: 'BD', dec: 3, unit: 1, travlog: 'event' },
  { code: 'ZAR', name: '남아공 랜드', sym: 'R', dec: 2, unit: 1, travlog: 'event' },
  { code: 'BRL', name: '브라질 헤알', sym: 'R$', dec: 2, unit: 1, travlog: 'event' },
  // 별도 환급환율(스프레드 0.99%) 통화
  { code: 'MOP', name: '마카오 파타카', sym: 'MOP$', dec: 2, unit: 1, travlog: 'event', spread099: true },
  { code: 'MNT', name: '몽골 투그릭', sym: '₮', dec: 0, unit: 1, travlog: 'event', spread099: true },
  { code: 'MMK', name: '미얀마 짯', sym: 'K', dec: 0, unit: 1, travlog: 'event', spread099: true },
  { code: 'ILS', name: '이스라엘 셰켈', sym: '₪', dec: 2, unit: 1, travlog: 'event', spread099: true },
  { code: 'EGP', name: '이집트 파운드', sym: 'E£', dec: 2, unit: 1, travlog: 'event', spread099: true },
  { code: 'INR', name: '인도 루피', sym: '₹', dec: 0, unit: 1, travlog: 'event', spread099: true },
  { code: 'QAR', name: '카타르 리얄', sym: 'QR', dec: 2, unit: 1, travlog: 'event', spread099: true },
  { code: 'KHR', name: '캄보디아 리엘', sym: '៛', dec: 0, unit: 100, travlog: 'event', spread099: true },
  { code: 'KES', name: '케냐 실링', sym: 'KSh', dec: 0, unit: 1, travlog: 'event', spread099: true },
  { code: 'FJD', name: '피지 달러', sym: 'FJ$', dec: 2, unit: 1, travlog: 'event', spread099: true },
  { code: 'NPR', name: '네팔 루피', sym: 'Rs', dec: 0, unit: 1, travlog: 'event', spread099: true },
  { code: 'RON', name: '루마니아 레우', sym: 'lei', dec: 2, unit: 1, travlog: 'event', spread099: true },
  { code: 'BDT', name: '방글라데시 타카', sym: '৳', dec: 0, unit: 1, travlog: 'event', spread099: true },
  { code: 'BND', name: '브루나이 달러', sym: 'B$', dec: 2, unit: 1, travlog: 'event', spread099: true },
  { code: 'LKR', name: '스리랑카 루피', sym: 'Rs', dec: 0, unit: 1, travlog: 'event', spread099: true },
  { code: 'JOD', name: '요르단 디나르', sym: 'JD', dec: 3, unit: 1, travlog: 'event', spread099: true },
  { code: 'UZS', name: '우즈베키스탄 숨', sym: 'soʻm', dec: 0, unit: 100, travlog: 'event', spread099: true },
  { code: 'CLP', name: '칠레 페소', sym: 'CLP$', dec: 0, unit: 1, travlog: 'event', spread099: true },
  { code: 'KZT', name: '카자흐스탄 텡게', sym: '₸', dec: 0, unit: 1, travlog: 'event', spread099: true },
  { code: 'COP', name: '콜롬비아 페소', sym: 'COL$', dec: 0, unit: 1, travlog: 'event', spread099: true },
  { code: 'TZS', name: '탄자니아 실링', sym: 'TSh', dec: 0, unit: 1, travlog: 'event', spread099: true },
  { code: 'PKR', name: '파키스탄 루피', sym: 'Rs', dec: 0, unit: 1, travlog: 'event', spread099: true },
  { code: 'DZD', name: '알제리 디나르', sym: 'DA', dec: 2, unit: 1, travlog: 'event', spread099: true },
  { code: 'ETB', name: '에티오피아 비르', sym: 'Br', dec: 2, unit: 1, travlog: 'event', spread099: true },
  { code: 'OMR', name: '오만 리얄', sym: 'OMR', dec: 3, unit: 1, travlog: 'event', spread099: true },
  // 트래블로그 미지원 — USD 지갑 결제. 여행지 통화라 표시용으로 넣음
  // ceilDisplay: 정산 내역에서 소수점을 올림한 정수로 보여 줌(97.6 → 98). 계산은 원래 값 그대로
  { code: 'MAD', name: '모로코 디르함', sym: 'DH', dec: 2, unit: 1, travlog: 'none', ceilDisplay: true },
  // 나라 이름 검색용(2026-10-20). 트래블로그 미지원 → USD 지갑 결제, 환율은 er-api 의 USD 교차
  { code: 'ARS', name: '아르헨티나 페소', sym: '$', dec: 2, unit: 1, travlog: 'none' },
  { code: 'PEN', name: '페루 솔', sym: 'S/', dec: 2, unit: 1, travlog: 'none' },
  { code: 'BOB', name: '볼리비아 볼리비아노', sym: 'Bs', dec: 2, unit: 1, travlog: 'none' },
  { code: 'UYU', name: '우루과이 페소', sym: '$U', dec: 2, unit: 1, travlog: 'none' },
  { code: 'PYG', name: '파라과이 과라니', sym: '₲', dec: 0, unit: 1, travlog: 'none' },
  { code: 'CRC', name: '코스타리카 콜론', sym: '₡', dec: 0, unit: 1, travlog: 'none' },
  { code: 'GTQ', name: '과테말라 케찰', sym: 'Q', dec: 2, unit: 1, travlog: 'none' },
  { code: 'DOP', name: '도미니카공화국 페소', sym: 'RD$', dec: 2, unit: 1, travlog: 'none' },
  { code: 'CUP', name: '쿠바 페소', sym: '$', dec: 2, unit: 1, travlog: 'none' },
  { code: 'JMD', name: '자메이카 달러', sym: 'J$', dec: 2, unit: 1, travlog: 'none' },
  { code: 'ISK', name: '아이슬란드 크로나', sym: 'kr', dec: 0, unit: 1, travlog: 'none' },
  { code: 'RSD', name: '세르비아 디나르', sym: 'дин', dec: 2, unit: 1, travlog: 'none' },
  { code: 'BAM', name: '보스니아 마르크', sym: 'KM', dec: 2, unit: 1, travlog: 'none' },
  { code: 'MKD', name: '북마케도니아 데나르', sym: 'ден', dec: 2, unit: 1, travlog: 'none' },
  { code: 'ALL', name: '알바니아 레크', sym: 'L', dec: 2, unit: 1, travlog: 'none' },
  { code: 'GEL', name: '조지아 라리', sym: '₾', dec: 2, unit: 1, travlog: 'none' },
  { code: 'AMD', name: '아르메니아 드람', sym: '֏', dec: 0, unit: 1, travlog: 'none' },
  { code: 'AZN', name: '아제르바이잔 마나트', sym: '₼', dec: 2, unit: 1, travlog: 'none' },
  { code: 'UAH', name: '우크라이나 흐리우냐', sym: '₴', dec: 2, unit: 1, travlog: 'none' },
  { code: 'RUB', name: '러시아 루블', sym: '₽', dec: 2, unit: 1, travlog: 'none' },
  { code: 'KGS', name: '키르기스스탄 솜', sym: 'сом', dec: 2, unit: 1, travlog: 'none' },
  { code: 'LAK', name: '라오스 킵', sym: '₭', dec: 0, unit: 1, travlog: 'none' },
  { code: 'MVR', name: '몰디브 루피야', sym: 'Rf', dec: 2, unit: 1, travlog: 'none' },
  { code: 'MUR', name: '모리셔스 루피', sym: '₨', dec: 2, unit: 1, travlog: 'none' },
  { code: 'SCR', name: '세이셸 루피', sym: '₨', dec: 2, unit: 1, travlog: 'none' },
  { code: 'NGN', name: '나이지리아 나이라', sym: '₦', dec: 2, unit: 1, travlog: 'none' },
  { code: 'GHS', name: '가나 세디', sym: '₵', dec: 2, unit: 1, travlog: 'none' },
  { code: 'TND', name: '튀니지 디나르', sym: 'DT', dec: 2, unit: 1, travlog: 'none' },
  { code: 'XPF', name: '프랑스령 폴리네시아 프랑', sym: '₣', dec: 0, unit: 1, travlog: 'none' },
  { code: 'KRW', name: '한국 원', sym: '₩', dec: 0, unit: 1, travlog: 'none' },
];

/** @type {Record<string, Currency>} */
export const BY_CODE = Object.fromEntries(CURRENCIES.map((c) => [c.code, c]));

/**
 * 통화 → [ISO 3166 나라 코드, 짧은 나라 이름]. 환율 탭 통화 버튼 아래 "🇲🇽 멕시코" 표시용.
 * 유로는 EU 깃발, XPF 는 프랑스령 폴리네시아(PF). 버튼 폭 때문에 긴 이름은 줄임(도미니카, 보스니아).
 */
const COUNTRY = {
  USD: ['US', '미국'], JPY: ['JP', '일본'], EUR: ['EU', '유럽'], GBP: ['GB', '영국'], CAD: ['CA', '캐나다'],
  CNY: ['CN', '중국'], SGD: ['SG', '싱가포르'], AUD: ['AU', '호주'], VND: ['VN', '베트남'], HKD: ['HK', '홍콩'],
  THB: ['TH', '태국'], CHF: ['CH', '스위스'], PHP: ['PH', '필리핀'], SEK: ['SE', '스웨덴'], IDR: ['ID', '인도네시아'],
  NZD: ['NZ', '뉴질랜드'], HUF: ['HU', '헝가리'], CZK: ['CZ', '체코'], NOK: ['NO', '노르웨이'], TWD: ['TW', '대만'],
  DKK: ['DK', '덴마크'], MYR: ['MY', '말레이시아'], MXN: ['MX', '멕시코'], AED: ['AE', '아랍에미리트'], TRY: ['TR', '튀르키예'],
  PLN: ['PL', '폴란드'], SAR: ['SA', '사우디'], KWD: ['KW', '쿠웨이트'], BHD: ['BH', '바레인'], ZAR: ['ZA', '남아공'],
  BRL: ['BR', '브라질'], MOP: ['MO', '마카오'], MNT: ['MN', '몽골'], MMK: ['MM', '미얀마'], ILS: ['IL', '이스라엘'],
  EGP: ['EG', '이집트'], INR: ['IN', '인도'], QAR: ['QA', '카타르'], KHR: ['KH', '캄보디아'], KES: ['KE', '케냐'],
  FJD: ['FJ', '피지'], NPR: ['NP', '네팔'], RON: ['RO', '루마니아'], BDT: ['BD', '방글라데시'], BND: ['BN', '브루나이'],
  LKR: ['LK', '스리랑카'], JOD: ['JO', '요르단'], UZS: ['UZ', '우즈베키스탄'], CLP: ['CL', '칠레'], KZT: ['KZ', '카자흐스탄'],
  COP: ['CO', '콜롬비아'], TZS: ['TZ', '탄자니아'], PKR: ['PK', '파키스탄'], DZD: ['DZ', '알제리'], ETB: ['ET', '에티오피아'],
  OMR: ['OM', '오만'], MAD: ['MA', '모로코'], ARS: ['AR', '아르헨티나'], PEN: ['PE', '페루'], BOB: ['BO', '볼리비아'],
  UYU: ['UY', '우루과이'], PYG: ['PY', '파라과이'], CRC: ['CR', '코스타리카'], GTQ: ['GT', '과테말라'], DOP: ['DO', '도미니카'],
  CUP: ['CU', '쿠바'], JMD: ['JM', '자메이카'], ISK: ['IS', '아이슬란드'], RSD: ['RS', '세르비아'], BAM: ['BA', '보스니아'],
  MKD: ['MK', '북마케도니아'], ALL: ['AL', '알바니아'], GEL: ['GE', '조지아'], AMD: ['AM', '아르메니아'], AZN: ['AZ', '아제르바이잔'],
  UAH: ['UA', '우크라이나'], RUB: ['RU', '러시아'], KGS: ['KG', '키르기스스탄'], LAK: ['LA', '라오스'], MVR: ['MV', '몰디브'],
  MUR: ['MU', '모리셔스'], SCR: ['SC', '세이셸'], NGN: ['NG', '나이지리아'], GHS: ['GH', '가나'], TND: ['TN', '튀니지'],
  XPF: ['PF', '폴리네시아'], KRW: ['KR', '한국'],
};

/**
 * 통화의 국기 이모지와 나라 이름. 표에 없는 통화(er-api 에서만 오는 것)는 null.
 * @param {string} code ISO 4217
 * @returns {{flag:string,name:string}|null}
 */
export function countryOf(code) {
  const c = COUNTRY[code];
  if (!c) return null;
  // 국기 이모지 = 나라 코드 두 글자를 regional indicator 문자로 바꾼 것(MX → 🇲 🇽)
  const flag = String.fromCodePoint(...[...c[0]].map((ch) => 0x1F1E6 + ch.charCodeAt(0) - 65));
  return { flag, name: c[1] };
}

/** 트래블로그 지갑 통화 개수(KRW·MAD 제외). 공식 58종 중 확인·추정 56종. */
export const TRAVLOG_COUNT = CURRENCIES.filter((c) => c.travlog !== 'none').length;

export const DEFAULT_FAVORITES = ['MAD', 'EUR', 'USD', 'KRW', 'CAD', 'JPY'];

/**
 * 통화 정보를 돌려줌. 테이블에 없는 코드(er-api 에서만 오는 통화)는 기본값으로 만들어 줌.
 * @param {string} code ISO 4217
 * @returns {Currency}
 */
/**
 * 코드·이름·나라·도시로 통화 찾기. "CNY", "위안", "중국", "상하이 여행", "엔" → 코드. 모르면 null.
 * 순서: 코드 → 통화 이름 정확히 → 도시·나라 별칭 → 테이블의 나라 이름 → 화폐 단위 이름.
 * @param {string} text
 * @returns {string|null}
 */
export function findCurrency(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const up = t.toUpperCase();
  if (/^[A-Z]{3}$/.test(up)) return BY_CODE[up] ? up : null;
  const exact = CURRENCIES.find((c) => c.name === t || c.name.replace(/\s/g, '') === t.replace(/\s/g, ''));
  if (exact) return exact.code;
  for (const [k, code] of PLACE_ALIASES) if (t.includes(k)) return code;
  // 인도네시아가 인도보다 먼저 나오도록 테이블 순서 그대로 봄
  for (const c of CURRENCIES) { const country = c.name.split(' ')[0]; if (c.name.includes(' ') && t.includes(country)) return c.code; }
  for (const [k, code] of UNIT_ALIASES) if (t.includes(k)) return code;
  return null;
}

/**
 * 나라·통화 이름·코드·도시로 통화 목록 검색(가까운 것부터). "멕" → 멕시코 페소, "페소" → 페소 쓰는 나라 전부,
 * "상하이" → 중국 위안. 빈 문자열이면 [].
 * @param {string} q
 * @param {number} [limit]
 * @returns {Currency[]}
 */
export function searchCurrencies(q, limit = 20) {
  const t = String(q || '').trim();
  if (!t) return [];
  const up = t.toUpperCase();
  const ns = t.replace(/\s/g, '');
  /** @type {Array<[number, Currency]>} */
  const scored = [];
  for (const c of CURRENCIES) {
    const name = c.name.replace(/\s/g, '');
    let s = 0;
    if (c.code === up) s = 100;
    else if (name === ns) s = 90;
    else if (c.name.startsWith(t) || name.startsWith(ns)) s = 80;
    else if (name.includes(ns)) s = 60;
    else if (COUNTRY[c.code]?.[1] === ns) s = 85;
    else if (/^[A-Z]{1,3}$/.test(up) && c.code.startsWith(up)) s = 50;
    if (s) scored.push([s, c]);
  }
  const via = findCurrency(t);
  if (via && BY_CODE[via] && !scored.some(([, c]) => c.code === via)) scored.push([70, BY_CODE[via]]);
  return scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name, 'ko')).slice(0, limit).map(([, c]) => c);
}

/** 도시·나라 별칭(테이블 이름에 없는 것) */
const PLACE_ALIASES = [
  ['상하이', 'CNY'], ['상해', 'CNY'], ['베이징', 'CNY'], ['북경', 'CNY'], ['광저우', 'CNY'], ['청두', 'CNY'], ['시안', 'CNY'], ['칭다오', 'CNY'], ['장가계', 'CNY'],
  ['도쿄', 'JPY'], ['오사카', 'JPY'], ['교토', 'JPY'], ['후쿠오카', 'JPY'], ['삿포로', 'JPY'], ['나고야', 'JPY'], ['오키나와', 'JPY'], ['다카야마', 'JPY'], ['가나자와', 'JPY'],
  ['타이베이', 'TWD'], ['타이완', 'TWD'], ['방콕', 'THB'], ['치앙마이', 'THB'], ['푸켓', 'THB'],
  ['다낭', 'VND'], ['하노이', 'VND'], ['호치민', 'VND'], ['나트랑', 'VND'], ['푸꾸옥', 'VND'], ['세부', 'PHP'], ['보라카이', 'PHP'], ['발리', 'IDR'],
  ['마라케시', 'MAD'], ['카사블랑카', 'MAD'], ['페즈', 'MAD'], ['토론토', 'CAD'], ['밴쿠버', 'CAD'], ['뉴욕', 'USD'], ['하와이', 'USD'], ['괌', 'USD'], ['사이판', 'USD'],
  ['런던', 'GBP'], ['터키', 'TRY'], ['이스탄불', 'TRY'],
  ['칸쿤', 'MXN'], ['툴룸', 'MXN'], ['플라야델카르멘', 'MXN'], ['과달라하라', 'MXN'], ['오악사카', 'MXN'], ['과나후아토', 'MXN'], ['메리다', 'MXN'],
  ['타히티', 'XPF'], ['폴리네시아', 'XPF'], ['불가리아', 'EUR'], ['리마', 'PEN'], ['쿠스코', 'PEN'], ['부에노스아이레스', 'ARS'], ['트빌리시', 'GEL'], ['레이캬비크', 'ISK'],
  ['파리', 'EUR'], ['프랑스', 'EUR'], ['스페인', 'EUR'], ['이탈리아', 'EUR'], ['독일', 'EUR'], ['포르투갈', 'EUR'], ['그리스', 'EUR'], ['오스트리아', 'EUR'], ['네덜란드', 'EUR'], ['벨기에', 'EUR'], ['크로아티아', 'EUR'], ['유럽', 'EUR'],
];
/** 화폐 단위 이름(나라 없이) */
const UNIT_ALIASES = [['위안', 'CNY'], ['엔', 'JPY'], ['캐달', 'CAD'], ['유로', 'EUR'], ['바트', 'THB'], ['다르함', 'MAD'], ['디르함', 'MAD'], ['페소', 'MXN'], ['파운드', 'GBP'], ['달러', 'USD'], ['불', 'USD']];

export function currencyInfo(code) {
  const c = BY_CODE[code];
  if (c) return c;
  return { code, name: code, sym: '', dec: 2, unit: 1, travlog: 'none' };
}
