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
| 글자 묶음 | Text styles | Display, Heading/*, Body/*, Label/SM, Meta/XS, Tag/2XS |
| 그림자 | Effect styles | Shadow/1~3 |
| 라이트박스 그라데이션 | Paint style | Lightbox |
| 움직임(시간·곡선) | 변수로 못 넣어요 | Prototype 설정에 참고 |

## 규칙 (디자인 시스템 요약)
- 색은 **파일 형식**에만 써요. 상태(기울어짐·쓰러짐·용량 한도)는 판과 지도 위에서 잉크 + 굵은 글자로만, 패널·배너에서만 상태 색을 써요.
- 파일 오브제는 채움색 **불투명도 34% + Multiply**, 테두리와 점선은 edge 색이에요.
- `ink-faint`는 선·눈금 전용이고 글자에는 쓰지 않아요.
- 화면 크기 기준: 데스크톱 기본 창 1280×840, 최소 창 720×520, 휴대폰 375. 720보다 좁으면 한 줄로 쌓여요.
- 그레인과 비네팅은 코드(SVG 노이즈 16% Multiply + 가장자리 갈색 12%)라 Figma에서는 비슷한 노이즈 레이어로만 흉내 내세요.

## 색 · 중립
| 토큰 | 값 | 설명 |
| --- | --- | --- |
| `color/neutral/bg` | `#f3efe6` |  |
| `color/neutral/page-glow` | `#fffcf5` |  |
| `color/neutral/surface` | `#ffffff` |  |
| `color/neutral/surface-sunken` | `#f4f1ea` |  |
| `color/neutral/surface-hover` | `#f2eee6` |  |
| `color/neutral/surface-selected` | `#ebe6dc` |  |
| `color/neutral/ink` | `#1b1a18` |  |
| `color/neutral/ink-hover` | `#34312d` |  |
| `color/neutral/ink-pressed` | `#0d0c0b` |  |
| `color/neutral/ink-soft` | `#5a554f` |  |
| `color/neutral/ink-faint` | `#a29d95` |  |
| `color/neutral/line` | `#e6e2db` |  |
| `color/neutral/line-strong` | `#d2ccc2` |  |
| `color/neutral/on-ink` | `#ffffff` |  |
| `color/neutral/stitch` | `#1b1a1838` |  |
| `color/neutral/halo` | `{color.lightbox.2}` |  |
| `color/neutral/vignette` | `#5c40241f` |  |
| `color/neutral/ink-wash` | `#1b1a180f` |  |

## 색 · 라이트박스
| 토큰 | 값 | 설명 |
| --- | --- | --- |
| `color/lightbox/1` | `#fffcf6` |  |
| `color/lightbox/2` | `#f7f3ea` |  |
| `color/lightbox/3` | `#ede7db` |  |
| `color/lightbox/gradient` | `radial-gradient(ellipse at 50% 45%, #fffcf6 0%, #f7f3ea 66%, #ede7db 100%)` | Figma 변수로는 못 넣어요. Paint style(원형 그라데이션)로 만드세요. |

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
| 이미지 | `#e3b015` | `#9d7b16` | image |
| 글·코드 | `#3f9f50` | `#3b904a` | text |
| 영상 | `#3d6fd3` | `#3d6fd3` | video |
| PDF·문서·발표 | `#e04a3a` | `#e04a3a` | pdf, office |
| 표 | `#ec8a2e` | `#b86e28` | table |
| 소리 | `#8a5cd6` | `#8a5cd6` | audio |
| 디자인 | `#d4479b` | `#d4479b` | design |
| 압축 | `#8d6a45` | `#8d6a45` | archive |
| 기타 | `#8b9098` | `#7b7f86` | unknown |
| 정리 상자 | `#5f6670` | `#5f6670` | 상자 |

## 글자
| 토큰 | 값 | 설명 |
| --- | --- | --- |
| `font/sans` | `-apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Malgun Gothic, Noto Sans KR, system-ui, sans-serif` |  |
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
| `size/text/xl` | `22px` |  |
| `size/text/2xl` | `28px` |  |
| `size/text/display-min` | `32px` |  |
| `size/text/display-max` | `52px` |  |
| `size/lineHeight/2xs` | `1.35` | 글자 크기의 배수. Figma에서는 % (×100)로 넣으세요. |
| `size/lineHeight/xs` | `1.4` | 글자 크기의 배수. Figma에서는 % (×100)로 넣으세요. |
| `size/lineHeight/sm` | `1.45` | 글자 크기의 배수. Figma에서는 % (×100)로 넣으세요. |
| `size/lineHeight/base` | `1.5` | 글자 크기의 배수. Figma에서는 % (×100)로 넣으세요. |
| `size/lineHeight/md` | `1.5` | 글자 크기의 배수. Figma에서는 % (×100)로 넣으세요. |
| `size/lineHeight/lg` | `1.35` | 글자 크기의 배수. Figma에서는 % (×100)로 넣으세요. |
| `size/lineHeight/xl` | `1.25` | 글자 크기의 배수. Figma에서는 % (×100)로 넣으세요. |
| `size/lineHeight/2xl` | `1.15` | 글자 크기의 배수. Figma에서는 % (×100)로 넣으세요. |
| `size/lineHeight/display` | `1.05` | 글자 크기의 배수. Figma에서는 % (×100)로 넣으세요. |

### Text styles
| 이름 | 크기 | 줄 높이 | 굵기 | 쓰는 곳 |
| --- | --- | --- | --- | --- |
| Display | 52px | 1.05 | 800 | 집 화면 큰 제목 (데스크톱 52px, 좁으면 32px까지) |
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
| `size/radius/sm` | `8px` |  |
| `size/radius/md` | `12px` |  |
| `size/radius/lg` | `16px` |  |
| `size/radius/xl` | `24px` |  |
| `size/radius/pill` | `999px` |  |
| `size/layout/content-max` | `1440px` |  |
| `size/layout/rail-min` | `280px` |  |
| `size/layout/rail-max` | `360px` |  |
| `size/layout/gutter` | `24px` |  |
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
| `motion/ease-spring` | `0.3, 1.4, 0.5, 1` |  |

## 참고
- --text-display은 화면 너비에 따라 32px~52px로 변해요(1280 창에서 약 44px).
- 오른쪽 레일 너비는 280px~360px(창 너비의 26%)예요.
