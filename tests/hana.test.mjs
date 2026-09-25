import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHanaHtml, buildHanaRates } from '../scripts/hana.mjs';

const fixture = `
<div class="tblWrap"><p class="txt">고시회차 : 2026.09.25 123회차 (14:00:23) 기준</p>
<table class="tblBasic leftNone" summary="환율">
<thead><tr><th rowspan="2">통화</th><th colspan="4">현찰</th><th colspan="2">송금</th><th rowspan="2">매매기준율</th><th rowspan="2">환가료율</th><th rowspan="2">미화환산율</th></tr>
<tr><th>사실 때 환율</th><th>Spread</th><th>파실 때 환율</th><th>Spread</th><th>보내실 때</th><th>받으실 때</th></tr></thead>
<tbody>
<tr><td class="tc"><a href="#" onclick="go('USD')">미국 USD</a></td><td class="tr">1,380.75</td><td class="tr">1.75</td><td class="tr">1,333.25</td><td class="tr">1.75</td><td class="tr">1,370.20</td><td class="tr">1,343.80</td><td class="tr">1,357.00</td><td class="tr">5.38175</td><td class="tr">1.0000</td></tr>
<tr><td class="tc"><a href="#">일본 JPY (100)</a></td><td class="tr">928.16</td><td class="tr">1.75</td><td class="tr">896.24</td><td class="tr">1.75</td><td class="tr">921.14</td><td class="tr">903.26</td><td class="tr">912.20</td><td class="tr">2.0125</td><td class="tr">0.6722</td></tr>
<tr><td class="tc"><a href="#">캐나다 CAD</a></td><td class="tr">1,009.51</td><td class="tr">1.97</td><td class="tr">970.49</td><td class="tr">1.97</td><td class="tr">999.90</td><td class="tr">980.10</td><td class="tr">990.00</td><td class="tr">4.9000</td><td class="tr">0.7295</td></tr>
<tr><td class="tc"><a href="#">인도 INR</a></td><td class="tr">-</td><td class="tr">-</td><td class="tr">-</td><td class="tr">-</td><td class="tr">16.44</td><td class="tr">16.12</td><td class="tr">16.28</td><td class="tr">8.0000</td><td class="tr">0.0120</td></tr>
<tr><td class="tc">합계</td><td>-</td></tr>
</tbody></table></div>`;

test('parseHanaHtml: 통화·단위·매매기준율·송금환율·회차·시각', () => {
  const p = parseHanaHtml(fixture);
  assert.equal(p.rows.length, 4);
  const usd = p.rows.find((r) => r.code === 'USD');
  assert.deepEqual([usd.unit, usd.mid, usd.tts, usd.ttb, usd.cashBuy, usd.cashSell], [1, 1357, 1370.2, 1343.8, 1380.75, 1333.25]);
  const jpy = p.rows.find((r) => r.code === 'JPY');
  assert.equal(jpy.unit, 100);
  assert.equal(jpy.mid, 912.2);
  assert.equal(jpy.name, '일본 JPY');
  const inr = p.rows.find((r) => r.code === 'INR');
  assert.equal(inr.cashBuy, null);
  assert.equal(inr.mid, 16.28);
  assert.equal(p.round, '123회차');
  assert.equal(p.asofText, '2026-09-25T14:00:23+09:00');
  assert.equal(p.headers.length, 2);
  assert.deepEqual(p.skipped, ['합계']);
});

test('parseHanaHtml: 빈 응답·로그인 페이지는 0행', () => {
  const p = parseHanaHtml('<html><body><h1>로그인</h1></body></html>');
  assert.equal(p.rows.length, 0);
  assert.equal(p.round, null);
});

test('buildHanaRates: rates.json 형식과 USD 교차환율', () => {
  const r = buildHanaRates(parseHanaHtml(fixture), '2026-09-25T00:00:00+09:00');
  assert.equal(r.source, 'hana');
  assert.equal(r.asof, '2026-09-25T14:00:23+09:00');
  assert.equal(r.round, '123회차');
  assert.equal(r.rates.JPY.unit, 100);
  assert.equal(r.rates.USD.ttb, 1343.8);
  assert.ok(Math.abs(r.usdCross.JPY - 1357 / 9.122) < 1e-9);
  assert.ok(Math.abs(r.usdCross.CAD - 1357 / 990) < 1e-9);
  assert.equal(r.usdCross.USD, 1);
  assert.throws(() => buildHanaRates({ rows: [{ code: 'JPY', unit: 100, mid: 900 }], round: null, asofText: null }), /USD/);
});

