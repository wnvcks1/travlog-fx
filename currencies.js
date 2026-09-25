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

/** @typedef {{code:string,name:string,sym:string,dec:number,unit:number,travlog:'always'|'event'|'none',spread099?:boolean}} Currency */

/** @type {Currency[]} */
export const CURRENCIES = [
  // 상시 무료환전
  { code: 'USD', name: '미국 달러', sym: '$', dec: 2, unit: 1, travlog: 'always' },
  { code: 'JPY', name: '일본 엔', sym: '¥', dec: 0, unit: 100, travlog: 'always' },
  { code: 'EUR', name: '유로', sym: '€', dec: 2, unit: 1, travlog: 'always' },
  { code: 'GBP', name: '영국 파운드', sym: '£', dec: 2, unit: 1, travlog: 'always' },
  // 이벤트 무료환전 (2026-12-31 까지)
  { code: 'CAD', name: '캐나다 달러', sym: 'C$', dec: 2, unit: 1, travlog: 'event' },
  { code: 'CNY', name: '중국 위안', sym: '¥', dec: 2, unit: 1, travlog: 'event' },
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
  { code: 'MXN', name: '멕시코 페소', sym: 'MX$', dec: 2, unit: 1, travlog: 'event' },
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
  { code: 'MAD', name: '모로코 디르함', sym: 'DH', dec: 2, unit: 1, travlog: 'none' },
  { code: 'KRW', name: '한국 원', sym: '₩', dec: 0, unit: 1, travlog: 'none' },
];

/** @type {Record<string, Currency>} */
export const BY_CODE = Object.fromEntries(CURRENCIES.map((c) => [c.code, c]));

/** 트래블로그 지갑 통화 개수(KRW·MAD 제외). 공식 58종 중 확인·추정 56종. */
export const TRAVLOG_COUNT = CURRENCIES.filter((c) => c.travlog !== 'none').length;

export const DEFAULT_FAVORITES = ['MAD', 'EUR', 'USD', 'KRW', 'CAD', 'JPY'];

/**
 * 통화 정보를 돌려줌. 테이블에 없는 코드(er-api 에서만 오는 통화)는 기본값으로 만들어 줌.
 * @param {string} code ISO 4217
 * @returns {Currency}
 */
export function currencyInfo(code) {
  const c = BY_CODE[code];
  if (c) return c;
  return { code, name: code, sym: '', dec: 2, unit: 1, travlog: 'none' };
}
