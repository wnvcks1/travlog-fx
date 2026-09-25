/**
 * localStorage 저장소. 실패해도 앱은 떠야 하므로 모든 접근을 try/catch 로 감쌈.
 */
import { DEFAULT_FAVORITES } from './currencies.js';

const KEY = 'travlog.v1';

/** @returns {object} 새 기본 상태 */
export function defaultState() {
  return {
    version: 1,
    people: ['나', '동행'],
    ratio: [1, 1],
    favorites: [...DEFAULT_FAVORITES],
    manual: { krw: {}, usdCross: {} },
    trips: [{ id: 'trip1', name: '여행 1', code: 'MAD', items: [] }],
    activeTrip: 'trip1',
    ratesCache: null,
    settings: { refundFeePct: 1, staleHours: 24 },
    ui: { tab: 'fx', code: 'MAD' },
  };
}

/**
 * 저장된 상태를 읽고 기본값과 얕게 합침(새 필드가 생겨도 깨지지 않게).
 * @returns {object}
 */
export function loadState() {
  const base = defaultState();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return base;
    return mergeState(base, saved);
  } catch {
    return base;
  }
}

/**
 * @param {object} base
 * @param {object} saved
 * @returns {object}
 */
export function mergeState(base, saved) {
  const out = { ...base, ...saved };
  out.manual = { krw: { ...(saved.manual?.krw || {}) }, usdCross: { ...(saved.manual?.usdCross || {}) } };
  out.settings = { ...base.settings, ...(saved.settings || {}) };
  out.ui = { ...base.ui, ...(saved.ui || {}) };
  if (!Array.isArray(out.trips) || out.trips.length === 0) out.trips = base.trips;
  if (!Array.isArray(out.people) || out.people.length < 2) out.people = base.people;
  if (!Array.isArray(out.ratio) || out.ratio.length !== out.people.length) out.ratio = out.people.map(() => 1);
  if (!out.trips.some((t) => t.id === out.activeTrip)) out.activeTrip = out.trips[0].id;
  return out;
}

/**
 * @param {object} state
 * @returns {boolean} 저장 성공 여부
 */
export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/**
 * 내보내기용 JSON 문자열(환율 캐시는 뺌).
 * @param {object} state
 * @returns {string}
 */
export function exportJson(state) {
  const { ratesCache, ...rest } = state;
  return JSON.stringify({ ...rest, exportedAt: new Date().toISOString() }, null, 2);
}

/**
 * 가져오기. 형식이 아니면 throw.
 * @param {string} text
 * @returns {object}
 */
export function importJson(text) {
  const obj = JSON.parse(text);
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.trips)) throw new TypeError('트래블로그 내보내기 파일이 아님');
  return mergeState(defaultState(), obj);
}
