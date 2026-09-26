/**
 * 두 폰 동기화. Supabase RPC travlog_sync 하나로 올리고(rev 가 큰 쪽이 이김) 방 전체를 받아 합친다.
 * 순수 함수(metaOf·buildPush·applyRemote)는 node 테스트 대상, callSync 만 네트워크.
 *
 * 규칙
 *  - 항목마다 rev(수정 시각 ms)와 dirty(아직 서버에 안 올라감). 서버는 rev 가 더 클 때만 덮어씀
 *  - 삭제는 tombstones 에 {id, rev} 로 남겨 올림. 상대 폰은 그 rev 이하의 항목을 지움
 *  - 사람·지갑·수동 환율·여행 목록 같은 메타는 통째로 metaRev 가 큰 쪽이 이김
 */

export const SUPABASE_URL = 'https://ccxhqakbmfgnqmdacdps.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_ZVXS8yXokuAL-x6UstHIFw_x1XC5oJn';
const CODE_RE = /^[A-Z0-9]{6,12}$/;

/**
 * 방 코드 6자(헷갈리는 0·O·1·I 제외).
 * @param {() => number} [rnd]
 * @returns {string}
 */
export function newRoomCode(rnd = Math.random) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i += 1) s += chars[Math.floor(rnd() * chars.length) % chars.length];
  return s;
}

/**
 * @param {string} s
 * @returns {string} 대문자 정리. 형식이 아니면 ''
 */
export function normalizeCode(s) {
  const c = String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return CODE_RE.test(c) ? c : '';
}

/**
 * 같이 쓰는 메타(항목 제외).
 * @param {object} state
 * @returns {object}
 */
export function metaOf(state) {
  return {
    people: [...state.people], initials: [...(state.initials || [])], ratio: [...state.ratio],
    trips: state.trips.map((t) => ({ id: t.id, name: t.name, code: t.code })),
    cash: (state.cash || []).map((c) => ({ ...c })),
    manual: { krw: { ...(state.manual?.krw || {}) }, usdCross: { ...(state.manual?.usdCross || {}) } },
    travlog: { rates: { ...(state.travlog?.rates || {}) }, at: state.travlog?.at || null },
  };
}

/**
 * 항목을 서버 형식으로. dirty·rev 는 빼고 trip 을 넣음.
 * @param {object} it
 * @param {string} tripId
 * @returns {object}
 */
function itemData(it, tripId) {
  const { dirty, rev, ...rest } = it;
  return { ...rest, trip: tripId };
}

/**
 * 올릴 것 모으기. all=true 면 전부(처음 방 만들 때), 아니면 dirty 인 항목과 삭제 기록만.
 * rev 가 없는 항목은 now 로 찍음.
 * @param {object} state
 * @param {{all?:boolean, now?:number}} [opts]
 * @returns {{meta:object, meta_rev:number, items:Array<{id:string, data?:object, rev:number, deleted:boolean}>}}
 */
export function buildPush(state, opts = {}) {
  const now = opts.now ?? Date.now();
  const items = [];
  for (const t of state.trips) {
    for (const it of t.items) {
      if (!Number.isFinite(it.rev)) { it.rev = now; it.dirty = true; }
      if (opts.all || it.dirty) items.push({ id: it.id, data: itemData(it, t.id), rev: it.rev, deleted: false });
    }
  }
  for (const tb of state.tombstones || []) items.push({ id: tb.id, data: {}, rev: tb.rev, deleted: true });
  return { meta: metaOf(state), meta_rev: state.sync.metaRev || 0, items };
}

/**
 * 서버가 돌려준 방 내용을 로컬에 합침. state 를 직접 고치고 무엇이 바뀌었는지 돌려줌.
 * @param {object} state
 * @param {{meta?:object, meta_rev?:number, items?:Array<{id:string, data:object, rev:number, deleted:boolean}>}} remote
 * @returns {{added:number, updated:number, removed:number, metaApplied:boolean}}
 */
export function applyRemote(state, remote) {
  const out = { added: 0, updated: 0, removed: 0, metaApplied: false };
  const rMeta = remote?.meta;
  if (rMeta && Number.isFinite(remote.meta_rev) && remote.meta_rev > (state.sync.metaRev || 0) && Array.isArray(rMeta.people)) {
    if (rMeta.people.length >= 2) state.people = [...rMeta.people];
    if (Array.isArray(rMeta.initials) && rMeta.initials.length === state.people.length) state.initials = [...rMeta.initials];
    if (Array.isArray(rMeta.ratio) && rMeta.ratio.length === state.people.length) state.ratio = [...rMeta.ratio];
    for (const rt of Array.isArray(rMeta.trips) ? rMeta.trips : []) {
      const lt = state.trips.find((t) => t.id === rt.id);
      if (lt) { lt.name = rt.name; lt.code = rt.code; } else state.trips.push({ id: rt.id, name: rt.name, code: rt.code, items: [] });
    }
    if (Array.isArray(rMeta.cash)) state.cash = rMeta.cash.map((c) => ({ ...c }));
    if (rMeta.manual) state.manual = { krw: { ...(rMeta.manual.krw || {}) }, usdCross: { ...(rMeta.manual.usdCross || {}) } };
    if (rMeta.travlog) state.travlog = { rates: { ...(rMeta.travlog.rates || {}) }, at: rMeta.travlog.at || null };
    state.sync.metaRev = remote.meta_rev;
    out.metaApplied = true;
  }
  const findLocal = (id) => {
    for (const t of state.trips) { const it = t.items.find((x) => x.id === id); if (it) return { t, it }; }
    return null;
  };
  for (const r of Array.isArray(remote?.items) ? remote.items : []) {
    if (!r || typeof r.id !== 'string') continue;
    const rev = Number(r.rev) || 0;
    const loc = findLocal(r.id);
    if (r.deleted) {
      if (loc && (loc.it.rev || 0) <= rev) { loc.t.items = loc.t.items.filter((x) => x.id !== r.id); out.removed += 1; }
      state.tombstones = (state.tombstones || []).filter((tb) => !(tb.id === r.id && tb.rev <= rev));
      continue;
    }
    const data = r.data && typeof r.data === 'object' ? r.data : {};
    const { trip: tripId, ...fields } = data;
    if (!loc) {
      // 로컬에서 지운 기록이 더 새로우면 되살리지 않음
      const tb = (state.tombstones || []).find((x) => x.id === r.id);
      if (tb && tb.rev >= rev) continue;
      let t = state.trips.find((x) => x.id === tripId);
      if (!t) { t = { id: tripId || `t${rev.toString(36)}`, name: '가져온 여행', code: fields.code || 'USD', items: [] }; state.trips.push(t); }
      t.items.push({ ...fields, id: r.id, rev, dirty: false });
      out.added += 1;
    } else if (rev > (loc.it.rev || 0)) {
      Object.assign(loc.it, fields, { id: r.id, rev, dirty: false });
      if (tripId && loc.t.id !== tripId) {
        const t2 = state.trips.find((x) => x.id === tripId);
        if (t2) { loc.t.items = loc.t.items.filter((x) => x.id !== r.id); t2.items.push(loc.it); }
      }
      out.updated += 1;
    } else if (rev === (loc.it.rev || 0)) {
      loc.it.dirty = false;
    }
  }
  return out;
}

/**
 * RPC 호출. 실패하면 throw.
 * @param {{code:string, meta?:object|null, meta_rev?:number, items?:object[], create?:boolean}} req
 * @param {{fetchFn?:typeof fetch, timeoutMs?:number}} [opts]
 * @returns {Promise<object>}
 */
export async function callSync(req, opts = {}) {
  const f = opts.fetchFn || fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 15000);
  try {
    const res = await f(`${SUPABASE_URL}/rest/v1/rpc/travlog_sync`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({ p_code: req.code, p_meta: req.meta ?? null, p_meta_rev: req.meta_rev ?? 0, p_items: req.items ?? [], p_create: !!req.create }),
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = JSON.parse(text).message || text; } catch { /* 그대로 */ }
      throw new Error(/no room/.test(msg) ? '그 코드의 방이 없음' : `동기화 실패 ${res.status}: ${msg.slice(0, 120)}`);
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}
