# Folduct

작업 폴더마다 방 하나. 파일은 반투명 천 오브제(서도호 Specimen 무드), 색은 파일 형식, 크기는 용량.

## 범위
- 작업 대상은 apps/room 만. apps/web, apps/server 는 읽기만 하고 고치거나 지우지 않는다.
- 스택: React 19 + TypeScript + Vite + Tauri 2. CSS는 apps/room/src/styles.css 하나(클래스 + CSS 변수).
- 새 의존성(UI 라이브러리, Tailwind, 아이콘 팩 등)은 물어본 뒤에만 추가한다.

## 디자인 규칙
- 색·글자 크기·간격·모서리·그림자는 styles.css :root 토큰만 쓴다. 헥스·px 직접 입력 금지.
- 새 토큰이 필요하면 :root 에 추가하고 `node apps/room/scripts/export-figma-tokens.mjs` 로 apps/room/design/ 을 다시 만든다.
- 색은 파일 형식에만 쓴다(apps/room/src/art/palette.ts). 상태는 잉크·굵은 글자·모양으로, 상태 색은 패널·배너에만.
- --ink-faint 는 선·눈금 전용. 글자 대비는 4.5:1 이상.
- 화면 폭 375 / 720 / 1280 에서 깨지지 않아야 한다.
- UI 문구는 한국어 해요체, 짧게.

## 안전 규칙
- 사용자 폴더에 하는 변경은 apps/room/src/gateways/mover.ts 의 상자 안팎 이동뿐. 파일 삭제·덮어쓰기 코드 금지.
- IndexedDB 스키마를 바꾸면 기존 데이터 이전 코드와 테스트를 함께 만든다.

## 일하는 방식
- 한 번에 한 화면 또는 한 버그. 요청하지 않은 파일은 고치지 않는다.
- 큰 변경 전에는 고칠 파일과 계획을 먼저 보여주고 승인을 받는다.
- 끝내기 전에 apps/room 에서 `npm test` 와 `npm run build` 를 돌리고, 화면 변경은 내장 브라우저(folduct-room, 5174) 스크린샷으로 확인한다.
- 확인 못 한 것은 "미검증"이라고 쓴다. 통과라고 하지 않는다.
- 커밋은 내가 요청할 때만. 메시지는 한국어 한 줄 + 무엇을 왜.
