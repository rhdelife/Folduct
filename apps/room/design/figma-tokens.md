# Folduct 디자인 토큰 → Figma

`src/styles.css`와 `src/art/palette.ts`에서 자동으로 뽑은 값이에요(코드가 기준). 토큰을 바꾸면 `node apps/room/scripts/export-figma-tokens.mjs`로 다시 만드세요.

## 가져오는 방법
1. **Tokens Studio 플러그인**(무료): `figma-tokens.json`을 불러온 뒤 *Create variables*와 *Create styles*를 누르면 색·숫자는 Variables로, 글자·그림자는 Styles로 만들어져요.
2. 플러그인 없이 손으로: 아래 표대로 Variables 컬렉션 3개(Color, Size, Type)와 Text·Effect·Paint style을 만드세요.

| 종류 | Figma에서 | 컬렉션/스타일 |
| --- | --- | --- |
| 색(중립·라이트박스·상태·파일 형식) | Variables (color) | **Color** |
| 간격·모서리·글자 크기·줄 높이·레이아웃·컨트롤 높이 | Variables (number) | **Size** |
| 글꼴 | Variables (string) | **Type** |
| 글자 묶음 | Text styles | Heading/*, Body/*, Label/SM, Meta/XS, Tag/2XS |
| 그림자 | Effect styles | Shadow/1~3 |
| 라이트박스 그라데이션 | Paint style | Lightbox |
| 움직임(시간·곡선) | 변수로 못 넣어요 | Prototype 설정에 참고 |

## 규칙 (디자인 시스템 요약)
- 색은 **파일 형식**에만 써요. 상태(오래됨·용량 한도)는 판과 지도 위에서 잉크 + 굵은 글자로만, 패널·배너에서만 상태 색을 써요.
- 파일 오브제는 불투명한 종이예요. 비치거나 겹쳐 곱하지 않아요.
- `ink-faint`는 선·눈금 전용이고 글자에는 쓰지 않아요.
- 화면 크기 기준: 데스크톱 기본 창 1280×840, 최소 창 720×520, 휴대폰 375. 720보다 좁으면 한 줄로 쌓여요.
- 그레인은 코드(SVG 노이즈 4%)라 Figma에서는 비슷한 노이즈 레이어로만 흉내 내세요.

## 색 · 중립
| 토큰 | 값 | 설명 |
| --- | --- | --- |
| `color/neutral/bg` | `#f6f6f3` |  |
| `color/neutral/ground` | `#efefec` |  |
| `color/neutral/surface` | `#ffffff` |  |
| `color/neutral/surface-sunken` | `#f4f1ea` |  |
| `color/neutral/surface-hover` | `#f2eee6` |  |
| `color/neutral/surface-selected` | `#ebe6dc` |  |
| `color/neutral/ink` | `#171717` |  |
| `color/neutral/ink-caption` | `#555555` |  |
| `color/neutral/ink-caption-soft` | `#6b6b6b` |  |
| `color/neutral/ink-hover` | `#34312d` |  |
| `color/neutral/ink-pressed` | `#0d0c0b` |  |
| `color/neutral/ink-soft` | `#66635d` |  |
| `color/neutral/ink-faint` | `#a29d95` |  |
| `color/neutral/line` | `#e6e2db` |  |
| `color/neutral/line-strong` | `#d2ccc2` |  |
| `color/neutral/on-ink` | `#ffffff` |  |
| `color/neutral/on-ink-hover` | `#ffffff1f` |  |
| `color/neutral/on-ink-press` | `#ffffff33` |  |
| `color/neutral/brand` | `#171717` |  |
| `color/neutral/stitch` | `#1b1a1838` |  |
| `color/neutral/halo` | `{color.lightbox.2}` |  |
| `color/neutral/ink-wash` | `#1b1a180f` |  |
| `color/neutral/face-1` | `#1d3557` |  |
| `color/neutral/face-2` | `#2f5d50` |  |
| `color/neutral/face-3` | `#7a2e3a` |  |
| `color/neutral/face-4` | `#5b3a6e` |  |
| `color/neutral/face-5` | `#7a5a1f` |  |
| `color/neutral/face-6` | `#1f5f6b` |  |
| `color/neutral/face-7` | `#8a4b2a` |  |
| `color/neutral/face-8` | `#3f3f46` |  |
| `color/neutral/line-ground` | `#d8d8d2` |  |

## 색 · 라이트박스
| 토큰 | 값 | 설명 |
| --- | --- | --- |
| `color/lightbox/1` | `#f9f9f7` |  |
| `color/lightbox/2` | `#f6f6f3` |  |
| `color/lightbox/3` | `#f0f0ed` |  |
| `color/lightbox/gradient` | `radial-gradient(ellipse at 50% 45%, #f9f9f7 0%, #f6f6f3 66%, #f0f0ed 100%)` | Figma 변수로는 못 넣어요. Paint style(원형 그라데이션)로 만드세요. |

## 색 · 상태 (패널·배너·글자 전용)
| 토큰 | 값 | 설명 |
| --- | --- | --- |
| `color/status/danger` | `#b42318` |  |
| `color/status/danger-bg` | `#fdeeec` |  |
| `color/status/caution` | `#8f5600` |  |
| `color/status/caution-bg` | `#fdf4ea` |  |
| `color/status/ok` | `#276a56` |  |
| `color/status/ok-bg` | `#f1f8f5` |  |

## 색 · 파일 형식
| 묶음 | 채움 (fill) | 테두리 (edge) | 형식 |
| --- | --- | --- | --- |
| 이미지 | `#e5bb4d` | `#8e6e1a` | image |
| 글·코드 | `#5f9b6d` | `#3b5f4d` | text |
| 영상 | `#2a64ad` | `#123f80` | video |
| PDF·문서 | `#c9553f` | `#8d2d1e` | pdf, office |
| 발표 | `#2b9a95` | `#1b6763` | slides |
| 표 | `#dd8b47` | `#a35a22` | table |
| 소리 | `#8371c0` | `#54438e` | audio |
| 디자인 | `#c95b93` | `#863a62` | design |
| 압축 | `#98743f` | `#6b4d29` | archive |
| 기타 | `#a5a5a1` | `#6e6e6a` | unknown |
| 정리 상자 | `#5f6670` | `#5f6670` | 상자 |

## 글자
| 토큰 | 값 | 설명 |
| --- | --- | --- |
| `font/sans` | `Pretendard, -apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Malgun Gothic, system-ui, sans-serif` |  |
| `font/mono` | `ui-monospace, SF Mono, Menlo, monospace` |  |
| `fontWeight/regular` | `400` |  |
| `fontWeight/medium` | `500` |  |
| `fontWeight/semibold` | `600` |  |
| `fontWeight/bold` | `700` |  |
| `fontWeight/heavy` | `800` |  |
| `size/text/2xs` | `11px` |  |
| `size/text/xs` | `12px` |  |
| `size/text/sm` | `13px` |  |
| `size/text/base` | `14px` |  |
| `size/text/md` | `16px` |  |
| `size/text/lg` | `18px` |  |
| `size/text/caption` | `20px` |  |
| `size/text/xl` | `22px` |  |
| `size/text/2xl` | `28px` |  |
| `size/lineHeight/2xs` | `1.35` | 글자 크기의 배수. Figma에서는 % (×100)로 넣으세요. |
| `size/lineHeight/xs` | `1.4` | 글자 크기의 배수. Figma에서는 % (×100)로 넣으세요. |
| `size/lineHeight/sm` | `1.45` | 글자 크기의 배수. Figma에서는 % (×100)로 넣으세요. |
| `size/lineHeight/base` | `1.5` | 글자 크기의 배수. Figma에서는 % (×100)로 넣으세요. |
| `size/lineHeight/md` | `1.5` | 글자 크기의 배수. Figma에서는 % (×100)로 넣으세요. |
| `size/lineHeight/lg` | `1.35` | 글자 크기의 배수. Figma에서는 % (×100)로 넣으세요. |
| `size/lineHeight/caption` | `1.2` | 글자 크기의 배수. Figma에서는 % (×100)로 넣으세요. |
| `size/lineHeight/xl` | `1.25` | 글자 크기의 배수. Figma에서는 % (×100)로 넣으세요. |
| `size/lineHeight/2xl` | `1.15` | 글자 크기의 배수. Figma에서는 % (×100)로 넣으세요. |

### Text styles
| 이름 | 크기 | 줄 높이 | 굵기 | 쓰는 곳 |
| --- | --- | --- | --- | --- |
| Heading/2XL | 28px | 1.15 | 700 | 방 이름, 페이지 제목 |
| Heading/XL | 22px | 1.25 | 700 | 패널 제목 |
| Heading/LG | 18px | 1.35 | 700 | 섹션 제목, 대화창 제목 |
| Body/MD | 16px | 1.5 | 400 | 큰 본문 |
| Body/Base | 14px | 1.5 | 400 | 기본 본문 |
| Label/SM | 13px | 1.45 | 600 | 버튼, 탭, 목록 제목 |
| Meta/XS | 12px | 1.4 | 500 | 보조 정보, 경로, 날짜 |
| Tag/2XS | 11px | 1.35 | 700 | 방 안 물건 이름표 |

## 간격 · 모서리 · 레이아웃
| 토큰 | 값 | 설명 |
| --- | --- | --- |
| `size/space/1` | `4px` |  |
| `size/space/2` | `8px` |  |
| `size/space/3` | `12px` |  |
| `size/space/4` | `16px` |  |
| `size/space/5` | `20px` |  |
| `size/space/6` | `24px` |  |
| `size/space/8` | `32px` |  |
| `size/space/10` | `40px` |  |
| `size/space/12` | `48px` |  |
| `size/radius/xs` | `4px` |  |
| `size/radius/sm` | `10px` |  |
| `size/radius/md` | `14px` |  |
| `size/radius/lg` | `20px` |  |
| `size/radius/xl` | `24px` |  |
| `size/radius/pill` | `999px` |  |
| `size/radius/sheet` | `32px` |  |
| `size/layout/topbar-h` | `72px` |  |
| `size/layout/chrome-y` | `42px` |  |
| `size/layout/chrome-x` | `40px` |  |
| `size/layout/chrome-reserve` | `300px` |  |
| `size/layout/gap-hair` | `2px` |  |
| `size/layout/menu-w` | `420px` |  |
| `size/layout/content-max` | `1440px` |  |
| `size/layout/rail-min` | `280px` |  |
| `size/layout/rail-max` | `360px` |  |
| `size/layout/gutter` | `24px` |  |
| `size/layout/thing-image-h` | `240px` |  |
| `size/control/sm` | `28px` |  |
| `size/control/md` | `32px` |  |
| `size/control/lg` | `44px` |  |

## 그림자
| 토큰 | 값 | 설명 |
| --- | --- | --- |
| `shadow/1` | `[object Object], [object Object]` | Figma에서는 Effect style(그림자 2겹)로 만드세요. |
| `shadow/2` | `[object Object], [object Object]` | Figma에서는 Effect style(그림자 2겹)로 만드세요. |
| `shadow/3` | `[object Object], [object Object]` | Figma에서는 Effect style(그림자 2겹)로 만드세요. |

## 움직임
| 토큰 | 값 | 설명 |
| --- | --- | --- |
| `motion/dur-1` | `120ms` |  |
| `motion/dur-2` | `200ms` |  |
| `motion/dur-3` | `320ms` |  |
| `motion/ease-standard` | `0.2, 0, 0, 1` |  |
| `motion/ease-settle` | `0.22, 1, 0.36, 1` |  |
| `motion/ease-fan` | `0.2, 0.8, 0.2, 1` |  |
| `motion/ease-spring` | `0.3, 1.4, 0.5, 1` |  |
| `motion/ease-glide` | `0.45, 0, 0.2, 1` |  |
| `motion/dur-focus` | `1000ms` |  |
| `motion/ease-suck` | `0.6, 0, 0.9, 0.5` |  |
| `motion/dur-drawer` | `640ms` |  |
| `motion/ease-drawer` | `0.32, 0.72, 0, 1` |  |

## 장면
집 화면 장면들이 쓰는 값이에요. 색은 `color`, 나머지는 `other`로 넣었어요.

| 토큰 | 값 | 설명 |
| --- | --- | --- |
| `scene/sheet-backdrop` | `rgb(27 26 24 / 0.35)` |  |
| `scene/sheet-backdrop-soft` | `rgb(27 26 24 / 0.18)` |  |
| `scene/topbar-stacked-h` | `100px` |  |
| `scene/topbar-phone-h` | `112px` |  |
| `scene/glass-blur` | `blur(24px) saturate(160%)` |  |
| `scene/glass-bg` | `rgb(255 255 255 / 0.62)` |  |
| `scene/glass-bg-strong` | `rgb(255 255 255 / 0.86)` |  |
| `scene/glass-chip` | `rgb(255 255 255 / 0.56)` |  |
| `scene/glass-chip-hover` | `rgb(255 255 255 / 0.9)` |  |
| `scene/glass-wash` | `rgb(23 23 23 / 0.05)` |  |
| `scene/glass-wash-strong` | `rgb(23 23 23 / 0.09)` |  |
| `scene/glass-dark` | `rgb(23 23 23 / 0.74)` |  |
| `scene/glass-dark-chip` | `rgb(255 255 255 / 0.16)` |  |
| `scene/glass-shadow` | `0 1px 2px rgb(23 23 23 / 0.04), 0 12px 40px rgb(23 23 23 / 0.1), inset 0 1px 0 rgb(255 255 255 / 0.7)` |  |
| `scene/glass-chip-shadow` | `0 1px 2px rgb(23 23 23 / 0.07)` |  |
| `scene/button-bg` | `rgb(23 23 23 / 0.07)` |  |
| `scene/button-bg-hover` | `rgb(23 23 23 / 0.11)` |  |
| `scene/button-bg-pressed` | `rgb(23 23 23 / 0.16)` |  |
| `scene/z-intro` | `8000` |  |
| `scene/intro-vase` | `min(40dvh, 56vw)` |  |
| `scene/intro-foot` | `136px` |  |
| `scene/intro-paper-scale` | `1` |  |
| `scene/intro-fly` | `900ms` |  |
| `scene/intro-stagger` | `110ms` |  |
| `scene/intro-fill` | `2000ms` |  |
| `scene/intro-leave` | `900ms` |  |
| `scene/hero-type` | `max(2.22vw, 3vh)` |  |
| `scene/hero-layer-z` | `40` |  |
| `scene/hero-tip-z` | `50` |  |
| `scene/shelf-card-max` | `160px` |  |
| `scene/shelf-cover` | `64px` |  |
| `scene/shelf-cover-narrow` | `44px` |  |
| `scene/pet-w` | `216px` |  |
| `scene/pet-vase` | `104px` |  |
| `scene/pet-list-h` | `168px` |  |
| `scene/cal-number` | `44px` |  |
| `scene/cal-dot` | `5px` |  |
| `scene/cal-gap` | `2px` |  |
| `scene/cal-w` | `217px` |  |
| `scene/room-head-duct` | `56px` |  |
| `scene/weekly-w` | `min(55vw, 760px)` |  |
| `scene/weekly-shadow` | `0 1px 2px rgb(27 26 24 / 0.05), 0 16px 40px rgb(27 26 24 / 0.06)` |  |
| `scene/hairline` | `0.5px` |  |
| `scene/hue-red` | `#e5484d` |  |
| `scene/hue-orange` | `#f5822a` |  |
| `scene/hue-yellow` | `#f5c518` |  |
| `scene/hue-green` | `#3fa35b` |  |
| `scene/hue-blue` | `#3b82f6` |  |
| `scene/hue-purple` | `#8b5cf6` |  |
| `scene/hue-pink` | `#ec6fa8` |  |
| `scene/hue-brown` | `#8b5e3c` |  |
| `scene/hue-white` | `#ffffff` |  |
| `scene/hue-gray` | `#9a9a96` |  |
| `scene/hue-black` | `#1c1c1c` |  |
| `scene/empty-text` | `max(var(--text-md), var(--hero-type))` |  |
| `scene/punch-col` | `30px` |  |
| `scene/rank-num-file` | `88px` |  |
| `scene/rank-num-room` | `124px` |  |
| `scene/menu-scrim` | `rgb(27 26 24 / 0.1)` |  |
| `scene/room-tab-1` | `#ecece8` |  |
| `scene/room-tab-2` | `#e3e3df` |  |
| `scene/room-tab-3` | `#dadad6` |  |
| `scene/float-shade` | `rgb(23 23 23 / 0.16)` |  |
| `scene/room-line` | `#dcdcda` |  |
| `scene/room-line-strong` | `#c8c8c6` |  |
| `scene/room-hover` | `#efefec` |  |
| `scene/room-selected` | `#e6e6e3` |  |
| `scene/room-tab` | `var(--room-tab-3)` |  |
| `scene/room-tab-h` | `36px` |  |
| `scene/room-slope` | `42px` |  |
| `scene/room-step` | `20px` |  |
| `scene/room-radius` | `7px` |  |
| `scene/room-chip` | `2px` |  |
| `scene/room-sheet-tab` | `160px` |  |
| `scene/room-hair` | `1px` |  |

## 참고
- 오른쪽 레일 너비는 280px~360px(창 너비의 26%)예요.
