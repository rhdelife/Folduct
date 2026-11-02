# Folduct · 방 (apps/room)

작업 폴더마다 방 하나. 파일은 이름이 적힌 종이 오브제가 되고, 색은 파일 형식(이미지 노랑 · 글·코드 초록 · 영상 파랑 · PDF·문서·발표 빨강 · 표 주황 · 소리 보라 · 디자인 자홍 · 압축 갈색 · 기타 회색)을, 크기는 파일 용량(1KB 0.7배 → 1GB 2배, 로그 눈금)을 따릅니다. 색 규칙은 `src/art/palette.ts`에서 바꿉니다. 방은 그림이 아니라 개념으로만 남습니다(빛을 받는 하얀 판 + 점선 테두리).
손대지 않은 물건은 기울고 쓰러지며, 일주일에 한 번 `_Folduct 정리상자` 폴더로 같이 치웁니다. 지우지는 않습니다.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # vitest
npm run build
npm run tauri dev    # 데스크톱 앱으로 띄우기
npm run tauri build  # 배포용 빌드
```

배포 절차와 확인 상태는 [docs/release-checklist.md](../../docs/release-checklist.md), 변경 기록은 [CHANGELOG.md](CHANGELOG.md)에 있어요. 의존성을 바꾸면 `node scripts/gen-licenses.mjs`로 라이선스 고지(`src-tauri/THIRD-PARTY-LICENSES.txt`)를 다시 만듭니다.

- 데스크톱 앱은 인터넷에 접속하지 않습니다(CSP로 막아 둠). 기록은 앱의 WebView IndexedDB에 남습니다.
- 운영체제마다 다른 경로·오류 번호·화면 말은 `src/domain/platform.ts` 한곳에 있습니다. 파일의 마지막 사용 시각은 macOS Spotlight에서만 읽고, 다른 OS에서는 ‘모름’으로 둡니다.

- 저장: 이 브라우저의 IndexedDB(`folduct-room`)에만. 파일 내용은 저장하지 않습니다.
- 여러 폴더를 한 번에: 아래 명령으로 목록 파일을 만든 뒤, 집 화면의 **📦 가져오기**로 고릅니다. 같은 폴더를 다시 가져오면 새 방 대신 그 방을 다시 봅니다(메모·자리 유지). 60일 넘게 고친 파일이 없는 폴더는 ‘완료된 프로젝트’로 들어옵니다.
  ```bash
  node apps/room/scripts/scan-folders.mjs --out ~/Downloads/folduct-rooms.json ~/프로젝트1 ~/프로젝트2
  ```
  가져온 방은 보기 전용입니다. 방 안 **폴더 연결**을 한 번 누르면 실제 파일 이동(정리 상자)과 다시 보기를 쓸 수 있습니다.
- 파일 열기: 방 안 물건을 두 번 누르거나 ‘파일 열기’를 누르면 앱 안 보기 창에서 이미지·영상·소리·PDF·글/코드를 봅니다. 폴더가 아직 연결되지 않은 방은 그 자리에서 ‘폴더 연결하고 열기’로 폴더를 고르고, 권한이 풀린 방은 같은 클릭에서 크롬에 읽기 권한을 다시 묻습니다(‘방문할 때마다 허용’을 고르면 다음부터 묻지 않음). 그 밖의 형식(PPT·PSD·ZIP 등)은 경로 복사로 원래 앱에서 엽니다.
- 폴더 접근: 권한을 다시 묻는 건 브라우저뿐이고, 데스크톱은 폴더를 고를 때 받은 접근과 macOS 권한(시스템 설정 > 개인정보 보호 및 보안 > 파일 및 폴더)을 따릅니다. 접근이 있는 방은 들어올 때와 접근을 허용한 직후 폴더를 자동으로 다시 읽어 목록을 맞추고, 못 읽으면 배너로 알리며 목록과 메모는 그대로 둡니다.
- 완료된 프로젝트: 화병이나 메뉴의 방 줄을 오른쪽 클릭(메뉴 키, Shift+F10)하거나 방 패널·방 설정에서 옮깁니다. 실제 폴더는 그대로입니다. 기울기·주간 정리·용량 경고가 멈추고, 지도에서 빠져 메뉴의 ‘완료된 프로젝트’ 목록에 모입니다.
- 실제 파일 이동은 Chrome·Edge(폴더 고르기 + `move()`)에서만. 다른 브라우저와 샘플 방은 Folduct 안에서만 상자에 넣습니다.
- 폴더에 하는 변경은 `src/gateways/mover.ts`의 상자 안팎 이동뿐입니다(`removeEntry`·`createWritable` 미사용, 테스트로 확인).

| 폴더 | 내용 |
| --- | --- |
| `src/domain` | 방치 판정·물건 크기·방 용량·다시 보기 합치기(`care.ts`), 방 판 좌표(`plane.ts`), 가져오기(`importFile.ts`) |
| `src/gateways` | 폴더 고르기·읽기·권한(`folder.ts`), 상자 이동(`mover.ts`) |
| `src/storage` | IndexedDB(`db.ts`), 주간 정리·제자리로·복구(`box.ts`), 샘플 방 |
| `src/art` | 파일 종류별 실루엣 오브제(`ObjectShape`), 프로젝트 색 |
| `src/domain/sky.ts` | 집 화면 프로젝트 지도 배치: 진행 중인 방만 놓기, 파일 거리(오래 손대지 않을수록 바깥으로), 최근 14일 작업량 |
| `src/pages`, `src/components` | 집(프로젝트 지도 `SkyMap` + 순위·추이 `SkyPanel`), 방, 서랍(물건·선반·정리 상자·방 설정), 새 방·주간 정리 창 |
