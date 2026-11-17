// Quick Look이 발표 파일로 만든 HTML(문서 형식 선언 없이 숫자만 쓴 길이: "top:93; width:432")을 지금 화면에서 그대로 그리기 위한 도움 함수예요.
// 화면은 이 HTML을 스크립트 없이 안전한 태그만 골라 다시 만들어요(components/SlideView.tsx).

// 단위 없이 쓰면 옛 방식에서만 px로 읽히는 길이 속성. line-height처럼 단위 없는 숫자가 뜻이 있는 속성은 넣지 않아요.
const lengthProps = "width|height|min-width|min-height|max-width|max-height|top|left|right|bottom|font-size|text-indent|letter-spacing|border-width|margin|margin-top|margin-bottom|margin-left|margin-right|padding|padding-top|padding-bottom|padding-left|padding-right";
const bareLength = new RegExp(`(^|[;{\\s])(${lengthProps})(\\s*:\\s*)(-?\\d*\\.?\\d+)(?=\\s*(?:[;}]|$))`, "g");

export const pxLengths = (css: string): string => css.replace(bareLength, (_, lead: string, prop: string, colon: string, value: string) => `${lead}${prop}${colon}${value}${value === "0" ? "" : "px"}`);

// 슬라이드 폭. Quick Look은 <meta name="viewport" content="width=976"> 로 알려 줘요(슬라이드 960 + 양옆 8). 못 찾으면 그 값이에요.
export function slideWidth(html: string): number {
  const width = Number(/<meta[^>]+name=["']?viewport["']?[^>]*width=(\d+)/i.exec(html)?.[1]);
  return width >= 200 && width <= 4000 ? width : 976;
}

// 그림은 앱이 넣어 준 data URL만 받아요. 바깥 주소나 파일 경로는 불러오지 않아요.
export const safeImageSource = (src: string | null): src is string => src !== null && /^data:image\/(png|jpeg|gif|tiff|bmp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(src);

// 다시 만들 때 남기는 태그와 속성. 나머지 태그는 안의 글만 남기고, 스크립트·링크·폼은 버려요.
export const slideTags = new Set(["div", "p", "span", "br", "b", "i", "u", "s", "sub", "sup", "strong", "em", "img", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "col", "colgroup", "ul", "ol", "li"]);
export const droppedTags = new Set(["script", "style", "noscript", "template", "iframe", "object", "embed", "link", "meta", "title", "form", "input", "button", "textarea", "select", "svg", "math", "video", "audio", "canvas"]);
export const slideAttributes = new Set(["class", "colspan", "rowspan", "width", "height", "cellpadding", "cellspacing", "align", "valign", "alt"]);
