# Folduct · 방 (apps/room)

새 파일은 제자리로, 안 쓰는 파일은 상자로. 작업 폴더마다 방이 하나 있고, 방은 떠 있는 화병으로 보여요. 파일을 지우거나 덮어쓰지 않아요.

제품 범위와 기능 규칙은 [Folduct PRD · 기능 명세서](https://claude.ai/artifact/JtmFE8ZHreUfffXoXurjpT)에 있어요. 변경 기록은 [CHANGELOG.md](CHANGELOG.md), 배포 절차와 확인 상태는 [docs/release-checklist.md](../../docs/release-checklist.md)에 있어요.

```bash
npm install
npm run dev -- --port 5174   # 브라우저로 화면 확인
npm test                     # vitest
npm run build                # 타입 검사와 빌드
npm run tauri dev            # 데스크톱 앱으로 띄우기
npx tauri build --bundles app  # src-tauri/target/release/bundle/macos/Folduct.app
(cd src-tauri && cargo test)   # 폴더 권한 테스트
```

의존성을 바꾸면 `node scripts/gen-licenses.mjs`로 라이선스 고지(`src-tauri/THIRD-PARTY-LICENSES.txt`)를 다시 만들어요. `styles.css`의 `:root` 토큰을 바꾸면 `node scripts/export-figma-tokens.mjs`로 `design/`을 다시 만들어요.

## 기능

- **현관**: 환경설정이나 플로팅 화병에서 등록한 폴더에 새로 생긴 파일을 첫 화면 위쪽에 모아요. 고른 방 폴더로 옮기고 되돌릴 수 있어요.
- **주간 정리**: 오래 안 쓴 파일을 일주일에 한 번 보여 주고, 고른 파일만 방 폴더 안 `_Folduct 정리상자`로 옮겨요. 방의 정리 상자 탭에서 제자리로 돌릴 수 있어요.
- **플로팅 화병**: 어느 창 위에나 떠서 작업의 시작, 멈춤, 끝을 정해요. 작업 중 들어온 새 파일을 물어보고, 끝내면 그 방의 정리를 제안해요.
- **작업 일력**: 올해 작업 시간을 첫 화면 구석에 보여 줘요.
- **방 화면**: 물건을 판에 놓고, 선반, 정리 상자, 방 설정을 서랍 탭에서 다뤄요. 파일은 앱 안에서 보거나 기본 앱으로 열어요.

그림의 뜻은 고정이에요. 색은 파일 형식(`src/art/palette.ts`), 물건 크기는 파일 용량(로그 눈금, 1KB 0.7배 → 1GB 2배), 화병 크기는 방 합계 용량, 화병 모양과 목 색은 방을 구분하는 얼굴이에요.

## 저장과 폴더 접근

- 데스크톱 앱은 인터넷에 접속하지 않아요(CSP로 막아 둠). 기록은 앱의 WebView IndexedDB(`folduct-room`)에만 남고, 파일 내용은 저장하지 않아요.
- 폴더에 하는 변경은 `src/gateways/mover.ts`의 두 가지 이동뿐이에요. 상자 안팎 이동, 그리고 현관 파일을 방 폴더로 옮기는 이동과 그 되돌리기예요.
- 접근은 사용자가 고른 폴더로 제한돼요. 데스크톱은 macOS 권한(시스템 설정 > 개인정보 보호 및 보안 > 파일 및 폴더)도 따라요.
- 방을 열 때 폴더를 다시 읽어 목록을 맞춰요. 못 읽으면 배너로 알리고 목록은 그대로 둬요. 다 읽지 못한 경우(파일 1,000개, 깊이 10단계 초과) 못 본 파일을 ‘파일 없음’으로 바꾸지 않아요.
- 파일의 마지막 사용 시각은 macOS Spotlight에서만 읽고, 다른 OS에서는 ‘모름’으로 둬요. OS마다 다른 경로·오류 번호·화면 말은 `src/domain/platform.ts`에 모았어요.

## 브라우저에서 실행할 때

화면 확인용으로 브라우저에서도 돌아가요. 현관과 플로팅 화병은 데스크톱 전용이에요.

- 실제 파일 이동은 Chrome·Edge(폴더 고르기 + `move()`)에서만 돼요. 다른 브라우저와 샘플 방은 Folduct 안에서만 상자에 넣어요.
- 여러 폴더를 한 번에 방으로 만들려면 아래 명령으로 목록 파일을 만든 뒤 메뉴의 **목록 파일 가져오기**로 골라요. 데스크톱에서는 새 방 창의 **상위 폴더에서 여러 개 고르기**를 써요.
  ```bash
  node apps/room/scripts/scan-folders.mjs --out ~/Downloads/folduct-rooms.json ~/프로젝트1 ~/프로젝트2
  ```

## 코드 위치

| 폴더 | 내용 |
| --- | --- |
| `src/domain` | 화면·저장소와 무관한 규칙. 오래됨 판정과 스캔 합치기(`care.ts`), 현관(`doorstep.ts`), 작업 상태(`session.ts`), 작업 시간(`worklog.ts`), 방 얼굴(`face.ts`), 첫 화면 배치(`sky.ts`, `heroLayout.ts`) |
| `src/gateways` | 폴더 읽기·권한(`folder.ts`), 이동(`mover.ts`), 데스크톱 연결(`native.ts`) |
| `src/storage` | IndexedDB(`db.ts`), 주간 정리·제자리로·복구(`box.ts`), 현관 이동(`doorstep.ts`), 샘플 방 |
| `src/art` | 파일 형식 색, 종이 오브제, 화병 모양 |
| `src/pages`, `src/components` | 집(`Home`), 방(`RoomPage`), 플로팅 화병(`Pet`), 정리·새 방·환경설정 창 |
| `src-tauri` | 창, 권한(`capabilities/`), Spotlight 읽기와 범위 검사(`src/lib.rs`) |

`SkyMap`, `star` 같은 이름은 예전 밤하늘 디자인에서 남은 것이에요. 지금 화면은 화병과 종이예요.
