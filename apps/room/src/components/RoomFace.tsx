/// <reference types="vite/client" />
import { useMemo, type CSSProperties, type RefObject } from "react";
import { drawPose, drawRoom, drawStack, ductLayers, ductSilhouetteUnder, faceCell, faceFrames, type DuctDrawing, type DuctFaceSlot, type DuctGroup, type DuctPiece, type DuctPose, type DuctTone, type FaceExpr } from "../art/duct";
import faceSheet from "../art/duct-faces.png";
import { faceColorVar } from "../domain/face";
import type { RoomFace } from "../domain/model";
import { useFrodo, type BodyAct } from "./useFrodo";

type Parts = { label: string; color: string; size: number }[];

function Piece({ piece, band }: { piece: DuctPiece; band?: string }) {
  const layer = piece.tone === "layer";
  return (
    <path
      className={layer && band ? `duct-layer ${band}` : `duct-${piece.tone}`}
      d={piece.d}
      fill={piece.color}
      fillRule={piece.even ? "evenodd" : undefined}
      style={layer ? ({ "--i": piece.i, "--n": piece.n } as CSSProperties) : undefined}
    />
  );
}

// 표정 시트에서 한 칸만 내다봅니다. 칸을 옮겨도 그림은 다시 그리지 않아요.
function FaceSprite({ slot: [x, y, rx, ry], expr, faceRef }: { slot: DuctFaceSlot["face"]; expr: FaceExpr; faceRef?: RefObject<SVGRectElement | null> }) {
  const at = faceFrames.indexOf(expr);
  return (
    <>
      {/* 안쪽 svg의 상자는 시트 전체 폭으로 잡혀요. 얼굴 자리는 이 투명한 네모로 잽니다. */}
      <rect ref={faceRef} x={x - rx} y={y - ry} width={rx * 2} height={ry * 2} fill="none" />
      <svg className="duct-face" aria-hidden="true" x={x - rx} y={y - ry} width={rx * 2} height={ry * 2} viewBox={`${at * faceCell.width} 0 ${faceCell.width} ${faceCell.height}`} preserveAspectRatio="none">
        <image href={faceSheet} width={faceCell.width * faceFrames.length} height={faceCell.height} />
      </svg>
    </>
  );
}

function DuctArt({ drawing, className, foot, paper, band, expr, faceRef, body }: { drawing: DuctDrawing; className?: string; foot?: string; paper?: string; band?: string; expr?: FaceExpr; faceRef?: RefObject<Element | null>; body?: BodyAct | null }) {
  const classes = [className, body && `frodo-${body}`].filter(Boolean).join(" ") || undefined;
  return (
    <svg className={classes} viewBox={drawing.viewBox} aria-hidden="true" focusable="false" style={{ "--duct-foot": foot, "--duct-paper": paper } as CSSProperties}>
      {drawing.items.map((item, at) =>
        "parts" in item ? (
          <g key={at} transform={item.transform} className={item.part ? `duct-part-${item.part}` : item.rib === undefined ? undefined : "duct-rib"} style={groupStyle(item)}>
            {item.parts.map((part, inner) => ("face" in part ? <FaceSprite key={inner} slot={part.face} expr={expr ?? "base"} faceRef={faceRef as RefObject<SVGRectElement | null>} /> : <Piece key={inner} piece={part} band={band} />))}
          </g>
        ) : (
          <Piece key={at} piece={item} band={band} />
        ),
      )}
    </svg>
  );
}

// 머리는 목을 축으로 움직입니다. 안쪽 svg 때문에 크기를 믿을 수 없어 축을 그림 좌표로 줘요.
function groupStyle(item: DuctGroup): CSSProperties | undefined {
  if (item.rib !== undefined) return { "--rib": item.rib } as CSSProperties;
  const slot = item.part === "head" && item.parts.find((part): part is DuctFaceSlot => "face" in part);
  return slot ? { transformBox: "view-box", transformOrigin: `${slot.face[0]}px ${slot.face[1] + slot.face[3]}px` } : undefined;
}

const partsKey = (parts: Parts) => parts.map((part) => `${part.label}:${part.size}`).join();

// 방은 어디서나 이 그림입니다. 모양과 받침 색은 프로젝트, 길이는 용량, 주름 색은 파일 형식을 뜻해요. px는 그림이 차지하는 폭입니다.
// actor를 주면 살아 움직입니다. mood는 신호가 없을 때의 표정이에요.
export function RoomFaceArt({ face, parts = [], length = 0.7, px, className, actor, mood = "base" }: { face: RoomFace; parts?: Parts; length?: number; px: number; className?: string; actor?: string; mood?: FaceExpr }) {
  const key = partsKey(parts);
  const level = Math.round(length * 50) / 50;
  const live = Boolean(actor) && px >= ductSilhouetteUnder;
  // 부모가 다시 그려져도 같은 값이면 선을 다시 만들지 않습니다.
  const drawing = useMemo(() => drawRoom(face.shape, level, { px, layers: ductLayers(parts), live }), [face.shape, level, px, key, live]); // eslint-disable-line react-hooks/exhaustive-deps
  const { faceRef, expr, body } = useFrodo(live ? actor : undefined, mood);
  return <DuctArt drawing={drawing} className={className} foot={faceColorVar(face.color)} expr={expr} faceRef={faceRef} body={body} />;
}

// 플로팅 창과 인트로, 도우미의 자세. 창 안에서는 표준 자세에 그 방의 색만 입혀요. 자세를 모양마다 그리면 56가지가 됩니다.
export function PoseArt({ pose, parts = [], px, foot, paper, band, className, actor, mood = "base" }: { pose: DuctPose; parts?: Parts; px: number; foot?: string; paper?: string; band?: string; className?: string; actor?: string; mood?: FaceExpr }) {
  const key = partsKey(parts);
  const live = Boolean(actor);
  const flow = Boolean(band);
  const drawing = useMemo(() => drawPose(pose, { px, layers: ductLayers(parts), live, flow }), [pose, px, key, live, flow]); // eslint-disable-line react-hooks/exhaustive-deps
  const { faceRef, expr, body } = useFrodo(actor, mood);
  return <DuctArt drawing={drawing} className={className} foot={foot} paper={paper} band={band} expr={expr} faceRef={faceRef} body={body} />;
}

// 그림을 <img>로 바꿀 때 쓰는 색. <img> 속 SVG에는 화면의 CSS 변수가 닿지 않아 지금 값을 읽어 넣어요.
// shortcut: 그릴 때의 색으로 굳어서, 밝기 설정을 바꾸면 홈을 다시 열 때까지 옛 색이에요. 그게 보이면 테마 바뀜을 듣고 다시 그려요.
const cssColor = (value: string) => {
  const name = value.match(/^var\((--[\w-]+)\)$/)?.[1];
  return name ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : value;
};

function ductImage(drawing: DuctDrawing, foot: string | undefined, withLayers: boolean): string {
  const ink = cssColor("var(--ink)");
  const white = cssColor("var(--surface)");
  const base = foot ? cssColor(foot) : "";
  const fills: Record<DuctTone, string> = { ink, white, foot: base || white, solid: base || ink, paper: white, layer: "" };
  const piece = (part: DuctPiece) => (part.tone === "layer" && !withLayers ? "" : `<path d="${part.d}" fill="${part.tone === "layer" ? part.color : fills[part.tone]}"${part.even ? ' fill-rule="evenodd"' : ""}/>`);
  const body = drawing.items.map((item) => ("parts" in item ? `<g${item.transform ? ` transform="${item.transform}"` : ""}>${item.parts.map((part) => ("face" in part ? "" : piece(part))).join("")}</g>` : piece(item))).join("");
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${drawing.viewBox}">${body}</svg>`)}`;
}

// 홈의 프로도 한 명. 먹은 방 용량만큼 길어진 몸에 그 방 파일 형식 색이 차요. lengths는 먹은 방의 길이(0~1), parts는 그 방의 형식별 용량이에요.
// 앱(WebKit)에서는 손그림 SVG를 다시 그릴 때마다(표정, 몸짓, 색 차오름) 프로도가 깜빡이거나 사라졌어요.
// 그래서 몸은 한 번 그린 <img>로 두고 움직임은 레이어 이동으로만 해요. 표정(눈)만 그 위의 작은 칸에서 바뀌어요.
// 색은 같은 몸에 색을 칠한 두 번째 <img>를 겹치고, 그 칸을 받침에서 위로 걷어 올려 보여 줘요(heroMotion .frodo-fill).
export function StackArt({ lengths, parts = [], px, foot, className, actor, mood = "base" }: { lengths: number[]; parts?: Parts; px: number; foot?: string; className?: string; actor: string; mood?: FaceExpr }) {
  const key = `${lengths.map((length) => Math.round(length * 50)).join("|")}/${partsKey(parts)}`;
  const drawing = useMemo(() => drawStack(lengths, { px, live: true, layers: ductLayers(parts) }), [key, px]); // eslint-disable-line react-hooks/exhaustive-deps
  const plain = useMemo(() => ductImage(drawing, foot, false), [drawing, foot]);
  const colored = useMemo(() => (parts.length ? ductImage(drawing, foot, true) : null), [drawing, foot, parts.length]);
  const { faceRef, expr } = useFrodo(actor, mood);
  const [vx, vy, vw, vh] = drawing.viewBox.split(" ").map(Number);
  const slot = drawing.items.flatMap((item) => ("parts" in item ? item.parts : [])).find((part): part is DuctFaceSlot => "face" in part)?.face;
  const at = Math.max(0, faceFrames.indexOf(expr));
  const layers = drawing.items.filter((item): item is DuctPiece => "tone" in item && item.tone === "layer");
  return (
    <span className={className}>
      <img className="frodo-img" src={plain} alt="" draggable={false} decoding="sync" />
      {colored && (
        <span className="frodo-fill">
          <span className="frodo-fill-in">
            <img className="frodo-img" src={colored} alt="" draggable={false} decoding="sync" />
          </span>
        </span>
      )}
      {slot && (
        <span
          ref={faceRef as RefObject<HTMLSpanElement | null>}
          className="frodo-face"
          style={{
            left: `${((slot[0] - slot[2] - vx) / vw) * 100}%`,
            top: `${((slot[1] - slot[3] - vy) / vh) * 100}%`,
            width: `${((slot[2] * 2) / vw) * 100}%`,
            height: `${((slot[3] * 2) / vh) * 100}%`,
            backgroundImage: `url(${faceSheet})`,
            backgroundSize: `${faceFrames.length * 100}% 100%`,
            backgroundPositionX: `${(at / (faceFrames.length - 1)) * 100}%`,
          }}
        />
      )}
      {/* 색 띠 위를 가리키면 비율을 보여 주려고, 보이지 않는 띠만 따로 둬요. 다시 그릴 일이 없어요. */}
      {layers.length > 0 && (
        <svg className="frodo-hit" viewBox={drawing.viewBox} aria-hidden="true" focusable="false">
          {layers.map((piece, index) => <path key={index} className="feed-band" d={piece.d} fill={piece.color} fillOpacity={0} />)}
        </svg>
      )}
    </span>
  );
}

