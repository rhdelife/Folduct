# Folduct 데스크톱 앱 배포 체크리스트

대상: `apps/room` (Tauri 2, 버전 0.1.0). 2026-11-04 기준이에요.
표시: **확인함**은 이 Mac에서 실제로 돌려 본 것, **미검증**은 아직 아무도 확인하지 못한 것이에요.

## 먼저 알아 둘 것

- 코드는 `redesign` 브랜치에 커밋돼 있지만 원격 저장소가 없어요. 서명·공증·배포는 아직 하지 않았어요.
- 지금 만든 `.app`과 `.dmg`는 Apple Silicon 전용이고 임시 서명(ad-hoc)이에요. 다른 Mac에서 받으면 Gatekeeper가 막으니 **배포하면 안 돼요**.
- 배포 빌드는 배포 직전의 커밋으로 새로 만들어 주세요.
- `tauri.conf.json`의 `signingIdentity: "-"`로 번들 전체를 임시 서명해요. 2026-11-04 빌드에서 `codesign --verify --deep --strict`를 통과했고, Gatekeeper(`spctl`)는 공증 전이라 거절해요. 2번의 Developer ID 환경 변수가 이 값을 대신할 것으로 보지만 미검증이에요.
- 다른 컴퓨터에서 실행해 본 적은 아직 없어요. 4번을 새 macOS 계정과 다른 Mac에서 해 주세요.

## 1. 확인함 (이 Mac, macOS 26.6 / Apple Silicon)

단위 테스트를 뺀 나머지 줄은 2026-11-03에 기능을 줄이고 플로팅 화병을 넣기 전의 결과예요. 배포 빌드에서 다시 확인해 주세요.

| 항목 | 결과 | 어떻게 |
| --- | --- | --- |
| 프로덕션 빌드 | 성공. `Folduct.app` 14.19 MiB, `Folduct_0.1.0_aarch64.dmg` 5.35 MiB | `CI=true npx tauri build` |
| 글꼴·에셋 오프라인 번들 | Pretendard가 실행 파일에 포함되고 `loaded` 상태. 소스에 외부 주소 없음 | 실제 앱 안 프로브, 소스 grep |
| CSP 적용 | 앱 위반 0건. 집·방 화면, 인트로 첫 화면(약 10초), IPC, 커스텀 명령 동작 | 실제 Tauri 앱 + WKWebView 프로브 |
| CSP가 실제로 막는지 | 인라인 스크립트, eval, 외부 fetch 모두 차단 | 같은 프로브의 대조 실험 |
| 미리보기 형식과 CSP | blob SVG(안의 스크립트는 실행 안 됨), data 이미지, ImageBitmap, blob 소리, blob PDF iframe 로드 | 같은 프로브. 실제 `FileViewer` 창을 띄운 건 아니에요 |
| 범위 밖 경로 거절 | 실제 IPC로 `last_used_dates`를 불러 `고른 폴더 밖의 경로예요.` 확인 | 같은 프로브 + `cargo test` |
| 단위 테스트 | `npm test` 18개 파일 261개 통과, `cargo test` 6개 통과 | 2026-11-04, 커밋 `3422a76` |
| 메타데이터 | Info.plist에 버전 0.1.0, 분류 productivity, 최소 macOS 13.0, 폴더 권한 문구 5종 | `plutil -p` |
| 라이선스 번들 | `Contents/Resources`에 `THIRD-PARTY-LICENSES.txt`, `LICENSE-Pretendard.txt` | 번들 내용 확인 |
| npm 취약점 | 배포 의존성 0건. 개발 도구 vite 7.3.6에 high 1건(개발 서버 한정) | `npm audit` |
| 크로스 플랫폼 의존성 해석 | Windows·리눅스 대상 트리가 잠금 파일로 풀림(컴파일은 아님) | `cargo tree --target` |

프로브의 한계: 인트로를 켠 채 끝까지 도는 프로브는 60초 안에 결과가 오지 않았어요. 인트로만 짧게 본 프로브는 정상(위반 0, ‘정리 시작’ 대기)이었지만, 긴 프로브가 멈춘 원인은 **못 찾았어요**. 창이 가려진 상태 때문일 수 있어요. 첫 실행 확인(4번)에서 꼭 눌러 봐 주세요.

### 출시 준비 때 고친 것

- **보안**: CSP를 켰고(`csp: null`이었어요), 코드에서 쓰지 않는 `dialog:allow-message` 권한을 뺐어요.
- **저장 기록이 망가졌을 때**: 망가진 방 기록 하나가 집 화면 전체를 막던 문제를 고쳤어요. 읽을 수 없는 방은 지우지 않고 건너뛰고, 그릴 수 없는 물건과 현관 줄은 빼요.
- **저장소가 답하지 않을 때**: IndexedDB가 멈추면 빈 화면에 갇히던 것을 10초 뒤 실패로 돌려 ‘다시 시도’가 나오게 했어요.
- **옮기기 실패 문구**: 데스크톱의 권한 오류가 ‘옮기지 못했어요’로만 나오던 것을 이유별 문구로 바꿨어요.
- **Windows·리눅스 대비**: 아래 3번을 보세요.
- **배포 기본**: 버전을 `package.json` 하나로 모으고(`Cargo.toml`은 테스트로 검사), 설치 형식·설명·분류·라이선스 고지·`CHANGELOG.md`를 넣었어요.

## 2. macOS 배포: 직접 해 주세요

순서대로 진행하면 돼요.

1. **Apple Developer Program 가입**(유료, 본인 계정). 이후 Xcode > Settings > Accounts에서 **Developer ID Application** 인증서를 만들어요.
2. 인증서 이름을 확인해요. `security find-identity -v -p codesigning`
3. Apple ID용 앱 암호를 appleid.apple.com에서 만들어요. 값은 저장소에 넣지 말고 환경 변수로만 써요.
   ```bash
   export APPLE_SIGNING_IDENTITY="Developer ID Application: <이름> (<TEAM_ID>)"
   export APPLE_ID="<Apple ID>"
   export APPLE_PASSWORD="<앱 암호>"
   export APPLE_TEAM_ID="<TEAM_ID>"
   ```
4. Intel Mac까지 지원할지 정해요. 지금 Rust는 Homebrew 설치본이라 `aarch64-apple-darwin` 대상만 있어요. 유니버설 빌드를 하려면 rustup이 필요해요.
   ```bash
   rustup target add x86_64-apple-darwin aarch64-apple-darwin
   cd apps/room && npx tauri build --target universal-apple-darwin
   ```
   Apple Silicon만 낼 거면 `cd apps/room && npx tauri build` 면 돼요. `CI=true`가 없으면 DMG 단계에서 Finder 자동화 권한을 물을 수 있어요.
5. 결과를 확인해요. **전부 미검증이에요.**
   ```bash
   B=src-tauri/target/release/bundle
   codesign -dv --verbose=4 $B/macos/Folduct.app
   spctl -a -vvv -t install $B/macos/Folduct.app
   xcrun stapler validate $B/dmg/Folduct_0.1.0_aarch64.dmg
   ```
6. 공증이 통과한 DMG를 **다른 Mac**에 받아 4번 QA를 해요.

## 3. Windows·리눅스

### 코드에 넣은 것 (단위 테스트까지만 확인, 실제 동작은 전부 미검증)

- 경로: `src/domain/platform.ts`로 모았어요. 대화상자가 준 경로(`C:\`, `D:\`, `\\서버\공유`)의 구분자를 그대로 쓰고, 드라이브 뿌리의 폴더 이름도 처리해요. 유닉스에서 `\`는 이름의 일부로 둬요.
- 경로 안전: Windows 폴더 안에서는 `CON`·`NUL` 같은 예약 이름, 끝의 점·공백, `C:foo`, `a.txt:숨김` 같은 이름을 거절해요. 읽기·열기·옮기기 모두 같은 길로 지나가요. Rust 쪽 스코프 검사는 그대로예요.
- 덮어쓰지 않기: 대소문자만 다른 파일은 Windows 디스크가 ‘있음’으로 답하므로 `(2)` 이름을 받아요. 이 동작은 대소문자를 가리지 않는 가짜 디스크로만 테스트했어요.
- 같은 폴더 판단: Windows는 대소문자와 구분자를 가리지 않아요.
- 오류 번호: OS별 표로 나눴어요. Windows 5(권한), 2·3·21·53·67(없음), 17(다른 드라이브), 32·33(사용 중). 유닉스 1·13, 2, 18, 16·26. 유닉스의 17(이미 있음)과 5(입출력)는 잘못 읽지 않아요. 번호가 없을 때만 글을 봐요.
- 화면 말: Finder → 파일 탐색기·파일 관리자, 권한 안내도 OS별로 바꿨어요. OS는 웹뷰 UA로 판단해요.
- 시스템 항목 제외: `$RECYCLE.BIN`, `System Volume Information`, `Thumbs.db`, `desktop.ini`, `lost+found`.
- 마지막 사용 시각: macOS에서만 읽어요. 다른 OS는 `/usr/bin/mdls`가 없어 ‘모름’(null)이 되고, 앱은 수정 시각으로 판단해요.
- 열기·위치 보기: `tauri-plugin-opener`가 세 OS를 모두 지원해요(소스 확인, 동작 미검증).
- 리눅스 PDF: WebKitGTK에는 PDF 보기가 없어, 빈 칸 대신 기본 앱으로 여는 안내를 보여 줘요.
- 번들: `targets`에 `app, dmg, nsis, deb, appimage`를 넣었어요. 각 OS는 자기 형식만 만들어요(macOS에서 app과 dmg만 나오는 것은 확인). NSIS 언어는 한국어·영어예요.
- Rust 테스트: 유닉스 전용 권한 API를 쓰는 부분을 `#[cfg(unix)]`로 분리했어요. Windows 컴파일은 **못 해 봤어요**. 이 Mac에는 Windows 대상도 rustup도 없어요.

### Windows에서 빌드·테스트

Windows 10/11 x64에 Node 20 이상, Rust(MSVC), Visual Studio Build Tools(‘C++를 사용한 데스크톱 개발’)를 설치해요.

```powershell
cd apps\room
npm ci
npm test
cd src-tauri; cargo test; cd ..
npm run tauri build
# 결과: src-tauri\target\release\bundle\nsis\Folduct_0.1.0_x64-setup.exe
```

배포하려면 코드 서명이 필요해요. 없으면 SmartScreen이 경고해요. 인증서(OV/EV 또는 Azure Trusted Signing)는 직접 정해 주세요.

### 리눅스에서 빌드·테스트

Ubuntu 22.04 이상 기준이에요.

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
cd apps/room
npm ci && npm test
(cd src-tauri && cargo test)
npm run tauri build
# 결과: src-tauri/target/release/bundle/deb/*.deb, bundle/appimage/*.AppImage
```

### CI 제안 (추가하지 않았어요)

`.github/workflows/`에 넣으면 세 OS에서 테스트와 빌드를 돌려요. 서명 없이 산출물만 만들어요.

```yaml
name: desktop
on: [push, pull_request]
jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, windows-latest, ubuntu-22.04]
    runs-on: ${{ matrix.os }}
    defaults:
      run:
        working-directory: apps/room
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - uses: dtolnay/rust-toolchain@stable
      - if: runner.os == 'Linux'
        run: sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
      - run: npm ci
      - run: npm test
      - run: cargo test
        working-directory: apps/room/src-tauri
      - run: npm run tauri build
      - uses: actions/upload-artifact@v4
        with:
          name: bundle-${{ matrix.os }}
          path: |
            apps/room/src-tauri/target/release/bundle/dmg/*.dmg
            apps/room/src-tauri/target/release/bundle/nsis/*.exe
            apps/room/src-tauri/target/release/bundle/deb/*.deb
            apps/room/src-tauri/target/release/bundle/appimage/*.AppImage
```

GitHub Actions의 리눅스 빌드에서 AppImage가 추가 패키지를 요구할 수 있어요(미검증).

### 웹뷰 차이: 코드를 읽고 찾은 위험 (전부 미검증)

| 위험 | 어디 | 확인 방법 |
| --- | --- | --- |
| `crypto.randomUUID`는 보안 컨텍스트에서만 동작해요. `http://tauri.localhost`(Windows), `tauri://localhost`(리눅스)에서 되는지 봐야 해요 | `newId` | 새 방 만들기 |
| Windows 기본 출처(`http://tauri.localhost`)를 나중에 https로 바꾸면 저장 기록을 잃어요. `useHttpsScheme`는 첫 Windows 출시 전에 정해 주세요 | `tauri.conf.json` | 결정 필요 |
| WebKitGTK 합성 문제(화면 깜빡임, 일부 GPU에서 빈 화면) | `translate3d`, `will-change`, `backdrop-filter` | 집 화면 전환, 대화상자 |
| WebKitGTK 2.40 미만은 container query 미지원. 오래된 배포판에서 지도 배치가 깨질 수 있어요 | `.sky-stage` | Ubuntu 22.04, Debian 12 |
| 영상·소리 코덱: WebView2는 HEVC가 안 될 수 있고, WebKitGTK는 GStreamer 플러그인이 필요해요. 실패하면 안내로 넘어가요 | `FileViewer` | mov, m4a, flac |
| HEIC: 미리보기가 안 되면 숨기거나 안내로 넘어가요 | `FileViewer`, `ThingImage` | heic 파일 |
| Windows는 스크롤바가 항상 자리를 차지해 폭 계산이 달라질 수 있어요 | `styles.css` 서랍·대화상자 | 720px 창 |
| 마우스 휠은 한 칸의 값이 트랙패드와 크게 달라요. 집 화면 움직임이 튈 수 있어요 | `home/engine.ts` | 휠 마우스 |
| 256자 넘는 긴 경로: 상자 폴더 이름만큼 경로가 길어져요. 실패하면 파일은 그대로 있어요 | `mover.ts` | 깊은 폴더 |
| WebView2가 없는 Windows 10: 설치기가 인터넷에서 받아요 | NSIS | 오프라인 PC |
| Windows 정션: Rust 표준상 심볼릭 링크로 잡혀 건너뛰는 것으로 알고 있어요. 실기기로 확인이 필요해요 | `pathSource` | 정션 폴더 |

## 4. 실기기 QA: 아직 아무도 안 해 본 흐름 (전부 미검증)

새 계정이나 다른 기기에서 공증된 빌드로 해 주세요.

- [ ] 첫 실행: Gatekeeper 통과, 인트로의 ‘정리 시작’과 ‘건너뛰기’, 빈 집 화면, 샘플 방 띄우기와 치우기
- [ ] macOS 권한 창: 데스크톱·문서·다운로드 폴더를 고를 때 창이 뜨고, 문구가 맞는지. 거절했을 때 배너와 안내
- [ ] 진짜 폴더로 방 만들기, 다시 읽기, 앱을 껐다 켜도 폴더 접근이 유지되는지
- [ ] 현관: 실제 폴더 문서를 방으로 옮기기, 되돌리기, 같은 이름이 있을 때 `(2)`
- [ ] 주간 정리: 상자로 옮기기, 제자리로, 옮기는 중 강제 종료 뒤 복구
- [ ] 플로팅 창: 실제 다운로드 폴더에서 넣기와 되돌리기, 모두 넣기, 끝낼 때 정리 제안, 앱을 다시 켠 뒤 멈춤 상태, Dock으로 메인 창 다시 열기
- [ ] 작업 일력: 저장된 시간이 화면과 맞는지, 앱을 껐다 켜도 남는지
- [ ] 다른 디스크 간 이동 실패 문구, 외장 드라이브를 뺀 뒤 ‘폴더를 찾지 못했어요’, 폴더를 옮긴 뒤 ‘폴더 다시 고르기’
- [ ] 파일 보기: 실제 이미지·SVG·영상·소리·PDF·글 파일. 실제 `FileViewer`의 CSP 동작
- [ ] 저장 공간이 가득 찼을 때 오류 문구(코드만 읽었어요)
- [ ] 메뉴의 ‘Folduct에 관하여’, 창 최소 크기, 확대·축소 단축키
- [ ] 375 / 720 / 1280 폭 확인. 데스크톱 창의 최소 폭은 720이라 375는 브라우저에서 봐요
- [ ] Windows·리눅스: 위 전부 + 3번 위험 표

## 5. 정해 주셔야 할 것

1. **배포 경로**: 직접 DMG만 낼지, Mac App Store도 낼지. App Store는 샌드박스가 필요해 폴더 접근 방식을 바꿔야 해요.
2. **업데이트**: 지금은 자동 업데이트가 없어요. 넣으려면 `tauri-plugin-updater`(새 의존성, 승인 필요), 서명 키, 배포 주소가 필요해요. 없으면 사용자가 새 DMG를 직접 받아야 해요.
3. **개인정보 안내**: 아래 초안을 다듬어 공개해 주세요. 법률 검토는 하지 않았어요.
   > Folduct는 인터넷에 접속하지 않고, 어떤 정보도 밖으로 보내지 않아요. 파일 이름·크기·자리·메모와 작업 시간은 이 컴퓨터의 앱 저장소에만 남고, 파일 내용은 저장하지 않아요. 파일은 지우지 않으며, 정리 상자 안팎과 현관에서 방으로만 옮겨요. macOS에서는 파일의 마지막 사용 시각을 Spotlight에서 읽어요. 앱을 지워도 저장 기록은 남을 수 있어요.
4. **문의 창구**: 이메일이나 페이지 주소를 정해 주세요. 지금 앱에는 문의 경로가 없어요.
5. **저작권 표기**: `tauri.conf.json`의 `bundle.copyright`와 Windows `publisher`가 비어 있어요. 표기할 이름을 정해 넣어 주세요.
6. **앱 식별자**: `com.folduct.room`을 쓰는 도메인이 본인 것인지 확인해 주세요. 출시 후에 바꾸면 저장 기록을 잃어요.

## 6. 제안만 한 것 (승인 필요)

- `vite`를 7.3.7 이상으로 올리기: `npm audit`의 high 1건 해소. 개발 서버 문제라 앱에는 들어가지 않아요.
- `cargo install cargo-audit` 후 `cargo audit`: 설치되어 있지 않아 Rust 쪽 취약점 검사는 **미검증**이에요.
- 앱 안에서 라이선스 보기: 지금은 앱 번들 안의 파일로만 있어요. 메뉴에 넣으려면 화면 작업이 필요해요.

## 7. 알려진 위험

- **이름 충돌 경합**: 확인과 이름 바꾸기 사이에 다른 앱이 같은 이름을 만들면 덮어쓸 수 있어요. macOS와 리눅스의 rename, Windows의 Rust `fs::rename` 모두 대상을 대체하기 때문이에요. 틈은 짧지만 ‘덮어쓰지 않기’ 약속의 유일한 구멍이에요. 고치려면 Rust에 OS별 배타적 이동 명령이 필요해요(`renamex_np`, `renameat2`, `MoveFileExW`).
- **기본 앱으로 열기**: 폴더 안의 `.command`, `.exe`, `.bat`, `.desktop` 같은 실행 파일도 사용자가 누르면 실행돼요. 탐색기에서 두 번 누르는 것과 같아요. 막을지 정해 주세요.
- **라이선스**: 448개 패키지 모두 허용적 라이선스이고, MPL-2.0 패키지(`cssparser`, `selectors` 등)는 수정 없이 씁니다. 36개 패키지는 배포본에 라이선스 파일이 없어 SPDX 표기만 적었어요(`objc2` 등). MIT는 원문 고지를 요구하므로 필요하면 원문을 보강해 주세요. 법률 검토는 하지 않았어요.
- **스코프 파일 손상**: `.persisted-scope`가 망가지면 폴더 접근이 비고, 방에서 권한 배너와 ‘폴더 다시 고르기’가 나올 거예요(플러그인 소스와 앱 코드만 읽었어요).
- **개발 모드 CSP**: `tauri dev`는 개발 서버에서 바로 읽으므로 CSP가 걸리지 않을 것으로 보지만, 돌려 보지는 않았어요. 스타일이 깨지면 `app.security.devCsp`를 추가해 주세요.

## 다시 확인하는 법

```bash
cd apps/room
npm test && npm run build
(cd src-tauri && cargo test)
node scripts/gen-licenses.mjs   # 의존성을 바꿨을 때
```
