# travlog-fx — 트래블로그 환율·여행 정산

하나카드 트래블로그로 여행할 때 쓰는 폰용 웹앱(PWA). 현지 가격을 넣으면 원화·미국달러·캐나다달러(와 여행지 통화)로 바로 보여 주고, 둘이 쓴 돈을 통화 섞어 정산함.

- 환율: 하나은행 고시환율(매매기준율 = 트래블로그 충전가)을 [FXCOD 공개 JSON](https://github.com/bhagyeongc/ExchangeRateData)에서 받음. 없는 통화는 er-api USD 교차환율, 그것도 없으면 수동 입력
- 트래블로그 미지원 통화(모로코 디르함 등)는 USD 지갑 결제 경로(현지 → USD → 원화)로 계산
- 정산 내역은 폰 브라우저 안(localStorage)에만 저장. 서버 없음
- 빌드 없음. `python3 -m http.server` 로 열면 바로 돎. 테스트는 `npm test`

배포: GitHub Actions 가 push·평일 매시간 환율을 받아 GitHub Pages 로 올림. 저장소 Settings → Pages → Source 를 "GitHub Actions" 로 한 번 설정해야 함.
