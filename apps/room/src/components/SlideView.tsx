import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { droppedTags, pxLengths, safeImageSource, slideAttributes, slideTags, slideWidth } from "../domain/slides";

// Quick Look 발표 HTML을 안전한 태그만 새로 만들어 옮겨요. 스크립트·링크·이벤트 속성은 만들지 않고, 그림은 data URL만, 인라인 스타일은 CSSOM(style.cssText)으로 넣어요.
function rebuild(from: Node, into: Node) {
  for (const child of Array.from(from.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      into.appendChild(document.createTextNode(child.textContent ?? ""));
      continue;
    }
    if (!(child instanceof Element)) continue;
    const tag = child.tagName.toLowerCase();
    if (droppedTags.has(tag)) continue;
    if (!slideTags.has(tag)) {
      rebuild(child, into);
      continue;
    }
    const src = child.getAttribute("src");
    if (tag === "img" && !safeImageSource(src)) continue;
    const el = document.createElement(tag);
    for (const { name, value } of Array.from(child.attributes)) if (slideAttributes.has(name.toLowerCase())) el.setAttribute(name, value);
    if (el instanceof HTMLImageElement && src) {
      el.src = src;
      el.alt = "";
    }
    const style = child.getAttribute("style");
    if (style) el.style.cssText = pxLengths(style);
    rebuild(child, el);
    into.appendChild(el);
  }
}

// 발표 슬라이드를 위에서 아래로. 앱 CSP가 인라인 <style>을 막아서, 슬라이드 CSS는 그림자 DOM에 CSSStyleSheet로 붙여요(앱 스타일과도 섞이지 않아요).
// 슬라이드 폭(보통 976)을 상자 폭에 맞춰 zoom으로 줄여요.
export function SlideView({ html, title }: { html: string; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const width = useMemo(() => slideWidth(html), [html]);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => el.clientWidth > 0 && setScale(Math.min(1, el.clientWidth / width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [width]);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const css = Array.from(doc.querySelectorAll("style"), (style) => style.textContent ?? "").join("\n");
    const root = el.shadowRoot ?? el.attachShadow({ mode: "open" });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`${pxLengths(css)}\n:host { display: block; } .slides { display: grid; gap: var(--space-2); padding: var(--space-2) 0; font-family: var(--font-sans); }`);
    root.adoptedStyleSheets = [sheet];
    const stage = document.createElement("div");
    stage.className = "slides";
    rebuild(doc.body, stage);
    root.replaceChildren(stage);
  }, [html]);
  return (
    <div ref={box} className="slide-view" role="document" aria-label={`${title} 슬라이드`}>
      <div ref={host} style={{ width, zoom: scale }} />
    </div>
  );
}
