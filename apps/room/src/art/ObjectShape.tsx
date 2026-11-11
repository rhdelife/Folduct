import { Fragment, useId, type ReactNode } from "react";
import type { Kind } from "../domain/model";
import { usePicture } from "../storage/pictures";
import { makePen, type DuctPiece } from "./duct";
import { kindColors, kindTones, tonesFrom, type PaperTones } from "./palette";
import { paperArts, quad, type PaperArt, type Slot } from "./paperArts";

// 파일 하나 = 형식별 색 종이 한 장. 면은 형식 색으로 칠하고, 선은 프로도와 같은 펜으로 흔들리게 긋습니다.
// 기울기는 그리는 쪽에서 줍니다. 여기서는 똑바로 그려요.
export { paperArts, type PaperArt };

function hashOf(seed: string) {
  let hash = 2166136261;
  for (let at = 0; at < seed.length; at += 1) hash = Math.imul(hash ^ seed.charCodeAt(at), 16777619);
  return hash >>> 0;
}

export const pickArt = (kind: Kind, seed?: string) => paperArts[kind][seed ? hashOf(seed) % paperArts[kind].length : 0];

// 화면에서 잰 펜 굵기(px). 프로도처럼 작을수록 종이에 비해 굵게 그어야 뭉개지지 않아요.
export const paperWeight = (px: number) => (px >= 100 ? 2.4 : px >= 56 ? 2 : px >= 36 ? 1.8 : 1.5);

// 펜 선은 계산이 무거워 그림·굵기별로 한 번만 만듭니다. 굵기는 0.25, 점 간격은 0.5 단위로 묶어 종류를 줄여요.
// 점 간격은 화면 2.5px쯤이라, 작은 종이일수록 길 데이터가 짧아요. 작게 그릴 때 빼는 잔선은 아예 만들지 않아요.
// shortcut: 가장 오래된 것부터 버리는 단순한 상한이에요. 그림 종류가 크게 늘면 크기별 미리 계산으로 바꿔요.
const inkCache = new Map<string, DuctPiece[][]>();
const inkCacheLimit = 600;
function inked(key: string, art: PaperArt, width: number, perPixel: number, full: boolean): DuctPiece[][] {
  const step = Math.max(0.25, Math.round(width * 4) / 4);
  const sample = Math.max(2.6, Math.round(perPixel * 3.5 * 2) / 2);
  const id = `${key}:${step}:${sample}:${full ? 1 : 0}`;
  let pieces = inkCache.get(id);
  if (!pieces) {
    const pen = makePen(hashOf(key) % 89, sample);
    pieces = art.parts.map((part) => ("pen" in part && (full || !part.detail) ? pen(part.d, step * part.pen) : []));
    if (inkCache.size >= inkCacheLimit) inkCache.delete(inkCache.keys().next().value!);
    inkCache.set(id, pieces);
  }
  return pieces;
}

// 글자 폭 어림값(em). DOM을 재지 않아 움직이는 동안 레이아웃이 일어나지 않고, 테스트에서도 그대로 돕니다.
function charWidth(char: string, mono?: boolean) {
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(char) || char.length > 1) return 1;
  // Pretendard에서 잰 값(한글 0.86, 밑줄 0.44)에 조금 여유를 뒀어요.
  if (/\p{Script=Hangul}/u.test(char)) return 0.88;
  if (mono) return 0.62;
  if (/[_-]/.test(char)) return 0.45;
  if (/[.,:;'|!ijlI ]/.test(char)) return 0.32;
  if (/[WM@%]/.test(char)) return 1;
  if (/[A-Zmw#&]/.test(char)) return 0.76;
  return 0.58;
}

const widthOf = (chars: string[], mono?: boolean) => chars.reduce((sum, char) => sum + charWidth(char, mono), 0);

const ellipsisWidth = 0.8;

function middleCut(chars: string[], em: number, mono?: boolean) {
  // 어림값이 실제보다 조금 넉넉하고 슬롯 옆에 종이 여백이 있어서, 5%쯤 넘치는 것까지는 들어간다고 봅니다.
  const fits = em * 1.05;
  if (widthOf(chars, mono) <= fits) return chars.join("");
  const room = fits - ellipsisWidth;
  const dot = chars.lastIndexOf(".");
  const ending = dot > 0 ? chars.slice(dot + 1) : [];
  // 확장자는 앞 두 글자와 함께 들어갈 때만 통째로 남겨요. 못 들어가면 앞만 남깁니다. '표…psd'보다 '표지후…'가 읽히고, 형식은 색과 모양이 말해요.
  const headOnly = ending.length > 0 && widthOf(ending, mono) + widthOf(chars.slice(0, 2), mono) > room;
  const extension = headOnly ? [] : ending;
  const head: string[] = [];
  const extra: string[] = [];
  let [from, to, used] = [0, ending.length ? dot - 1 : chars.length - 1, widthOf(extension, mono)];
  while (from <= to) {
    // 첫 글자를 담은 뒤로는 앞쪽을 뒤쪽의 세 배쯤 담습니다. 이름은 앞이 더 잘 읽혀요.
    const takeTail = !headOnly && head.length > 0 && widthOf(extra, mono) + charWidth(chars[to], mono) <= widthOf(head, mono) / 3;
    const char = takeTail ? chars[to] : chars[from];
    // 점은 확장자 앞에 글자가 붙을 때만 찍히니 폭도 그때 셉니다.
    used += charWidth(char, mono) + (takeTail && !extra.length && extension.length ? charWidth(".", mono) : 0);
    if (used > room) break;
    if (takeTail) { extra.unshift(char); to -= 1; } else { head.push(char); from += 1; }
  }
  return `${head.join("")}…${extra.join("")}${extra.length && extension.length ? "." : ""}${extension.join("")}`;
}

// 이름을 슬롯 폭(em)에 맞춰 줄로 나눕니다. 넘치는 마지막 줄은 가운데를 줄여 확장자가 남아요. macOS 파일 이름의 풀어쓴 한글(NFD)은 먼저 모읍니다.
export function fitName(name: string, em: number, lines = 1, mono?: boolean): string[] {
  // 글자 단위로 끊어야 이모지 묶음이나 국기가 반쪽 나지 않아요.
  let rest = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(name.normalize("NFC").trim()), (part) => part.segment);
  const out: string[] = [];
  while (out.length < lines - 1 && widthOf(rest, mono) > em) {
    let count = 0;
    let used = 0;
    while (count < rest.length && used + charWidth(rest[count], mono) <= em) {
      used += charWidth(rest[count], mono);
      count += 1;
    }
    let cut = count;
    const extension = rest.lastIndexOf(".");
    // 확장자는 쪼개지 않고 통째로 다음 줄로 넘깁니다. 그 밖에는 공백·구분자에서 끊어요.
    if (extension > 0 && extension < count) cut = extension;
    else for (let at = count; at > count / 2; at -= 1) {
      if (/[\s_-]/.test(rest[at - 1])) { cut = at; break; }
    }
    if (cut === 0) cut = 1;
    out.push(rest.slice(0, cut).join("").trim());
    rest = rest.slice(cut);
  }
  out.push(middleCut(rest, em, mono));
  return out;
}

function PrintedName({ slot, name, tones, unit, id }: { slot: Slot; name: string; tones: PaperTones; unit: number; id: string }) {
  const style = { fontFamily: slot.mono ? "var(--font-mono)" : "var(--font-sans)", fontWeight: 500 };
  const fill = tones[slot.fill];
  if (slot.arc) {
    return (
      <>
        <path id={id} d={slot.arc} fill="none" />
        <text fontSize={unit} fill={fill} style={style} textAnchor="middle">
          <textPath href={`#${id}`} startOffset="50%">{fitName(name, slot.w / unit, 1, slot.mono)[0]}</textPath>
        </text>
      </>
    );
  }
  const leading = unit * 1.24;
  const printed = fitName(name, slot.w / unit, Math.max(1, Math.floor(slot.h / leading)), slot.mono);
  const top = slot.center ? slot.y + (slot.h - printed.length * leading) / 2 + unit * 1.02 : slot.y + unit * 0.92;
  return (
    <text fontSize={unit} fill={fill} style={style} textAnchor={slot.center ? "middle" : "start"}>
      {printed.map((text, at) => <tspan key={at} x={slot.center ? slot.x + slot.w / 2 : slot.x} y={top + at * leading}>{text}</tspan>)}
    </text>
  );
}

// 사용자가 고른 그림을 그 형식 색 종이에 끼웁니다. 종이 크기는 원래 그림과 같아서 부르는 쪽 자리 계산이 그대로예요.
// 이름을 찍을 때는 아래 띠를 비워 두고, 그 띠가 새 이름 칸이 됩니다. 테두리는 같은 펜으로 그어요.
function pictureArt(art: PaperArt, band: number): { art: PaperArt; frame: { x: number; y: number; w: number; h: number } } {
  const edge = 6;
  const margin = edge + Math.round(Math.min(art.w, art.h) * 0.06);
  const slot: Slot = { x: margin, y: art.h - band, w: art.w - margin * 2, h: Math.max(0, band - margin / 2), fill: "ink", on: "pale", center: true };
  const frame = { x: margin, y: margin, w: art.w - margin * 2, h: art.h - margin - (band || margin) };
  const paper = quad(edge, edge, art.w - edge * 2, art.h - edge * 2);
  const parts: PaperArt["parts"] = [{ d: paper, fill: "pale" }, { d: paper, pen: 1 }, { d: quad(frame.x, frame.y, frame.w, frame.h, 0.6), pen: 0.6 }];
  return { art: { id: `${art.id}+${Math.round(band)}`, w: art.w, h: art.h, slot, parts }, frame };
}

function Parts({ art, inkKey, paint, full, width, perPixel, after }: { art: PaperArt; inkKey: string; paint: PaperTones; full: boolean; width: number; perPixel: number; after?: (at: number) => ReactNode }) {
  const ink = inked(inkKey, art, width, perPixel, full);
  return (
    <>
      {art.parts.map((part, at) =>
        "fill" in part ? (
          <Fragment key={at}>
            <path d={part.d} fill={paint[part.fill]} />
            {after?.(at)}
          </Fragment>
        ) : full || !part.detail ? (
          // 잉크는 프로도와 같은 --ink. 색 선은 그 형식의 단을 씁니다.
          <g key={at} style={{ fill: part.tone ? paint[part.tone] : "var(--ink)" }}>
            {ink[at].map((piece, line) => <path key={line} d={piece.d} fillRule={piece.even ? "evenodd" : undefined} />)}
          </g>
        ) : null,
      )}
    </>
  );
}

export function ObjectShape({ kind, color, size, name, seed, nameFrom = 56, picture }: { kind: Kind; color?: string; size: number; name?: string; seed?: string; nameFrom?: number; picture?: string | null }) {
  const id = useId();
  const stored = usePicture(seed);
  const pictureUrl = picture === undefined ? stored : picture ?? undefined;
  const base = pickArt(kind, seed);
  const tones = color && color !== kindColors[kind] ? tonesFrom(color) : kindTones[kind];
  const full = Boolean(name) && size >= 40;
  // 작은 모양은 판 위에서 잘 보이도록 한 단 진하게 칠하고, 늘 정사각형 칸에 넣어 부르는 쪽 자리 계산을 그대로 둡니다.
  const side = Math.max(base.w, base.h);
  const paint = full ? tones : { pale: tones.soft, soft: tones.color, color: tones.edge, edge: tones.edge, ink: tones.ink };
  const perPixel = (full ? base.w : side) / size;
  const unit = Math.max(8.5, 5.7 + size * 0.05) * perPixel;
  const named = full && Boolean(name) && size >= nameFrom;
  // 세로로 긴 종이는 이름 두 줄, 가로로 긴 종이는 한 줄. 그림이 종이의 절반 아래로 줄지 않게 띠는 40%까지만.
  const band = named ? Math.min(base.h * 0.4, unit * 1.24 * (base.h > base.w ? 2 : 1) + Math.max(unit * 0.6, 6)) : 0;
  const pictured = pictureUrl ? pictureArt(base, band) : null;
  const art = pictured?.art ?? base;
  const frame = pictured?.frame;
  return (
    <svg
      className="object"
      viewBox={full ? `0 0 ${art.w} ${art.h}` : `${(art.w - side) / 2} ${(art.h - side) / 2} ${side} ${side}`}
      width={size}
      height={full ? size * (art.h / art.w) : size}
      aria-hidden="true"
    >
      <Parts
        art={art}
        inkKey={`${kind}/${art.id}`}
        paint={paint}
        full={full}
        width={paperWeight(size) * perPixel}
        perPixel={perPixel}
        after={frame && ((at) => at === 0 && <image href={pictureUrl} x={frame.x} y={frame.y} width={frame.w} height={frame.h} preserveAspectRatio="xMidYMid slice" />)}
      />
      {/* 가장 작아도 8.5px, 56 위로는 종이보다 천천히 커져 글자가 서류처럼 작게 남습니다. */}
      {named && name && <PrintedName slot={art.slot} name={name} tones={tones} unit={unit} id={id} />}
    </svg>
  );
}
