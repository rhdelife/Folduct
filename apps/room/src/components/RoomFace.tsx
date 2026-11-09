/// <reference types="vite/client" />
import { useMemo, type CSSProperties, type RefObject } from "react";
import { drawPose, drawRoom, ductLayers, ductShapeCount, ductSilhouetteUnder, faceCell, faceFrames, type DuctDrawing, type DuctFaceSlot, type DuctGroup, type DuctPiece, type DuctPose, type FaceExpr } from "../art/duct";
import faceSheet from "../art/duct-faces.png";
import { faceColors, faceColorVar } from "../domain/face";
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

function DuctArt({ drawing, className, foot, paper, band, expr, faceRef, body }: { drawing: DuctDrawing; className?: string; foot?: string; paper?: string; band?: string; expr?: FaceExpr; faceRef?: RefObject<SVGRectElement | null>; body?: BodyAct | null }) {
  const classes = [className, body && `frodo-${body}`].filter(Boolean).join(" ") || undefined;
  // band가 있으면 색 주름을 한 묶음으로 둡니다. 묶음 전체를 한 번에 가려야 받침부터 끊김 없이 차올라요.
  const bands = band ? drawing.items.filter((item): item is DuctPiece => "tone" in item && item.tone === "layer") : [];
  return (
    <svg className={classes} viewBox={drawing.viewBox} aria-hidden="true" focusable="false" style={{ "--duct-foot": foot, "--duct-paper": paper } as CSSProperties}>
      {drawing.items.map((item, at) =>
        "parts" in item ? (
          <g key={at} transform={item.transform} className={item.part ? `duct-part-${item.part}` : item.rib === undefined ? undefined : "duct-rib"} style={groupStyle(item)}>
            {item.parts.map((part, inner) => ("face" in part ? <FaceSprite key={inner} slot={part.face} expr={expr ?? "base"} faceRef={faceRef} /> : <Piece key={inner} piece={part} band={band} />))}
          </g>
        ) : item === bands[0] ? (
          <g key={at} className={band}>
            {bands.map((piece, inner) => <Piece key={inner} piece={piece} />)}
          </g>
        ) : bands.includes(item) ? null : (
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
  const drawing = useMemo(() => drawPose(pose, { px, layers: ductLayers(parts), live }), [pose, px, key, live]); // eslint-disable-line react-hooks/exhaustive-deps
  const { faceRef, expr, body } = useFrodo(actor, mood);
  return <DuctArt drawing={drawing} className={className} foot={foot} paper={paper} band={band} expr={expr} faceRef={faceRef} body={body} />;
}

const pickerPx = 64;

// 방 설정의 얼굴 고르기. 고른 칸은 굵은 테두리로 보여 줍니다.
export function FacePicker({ face, onChange }: { face: RoomFace; onChange: (face: RoomFace) => void }) {
  return (
    <fieldset className="face-picker">
      <legend>방 얼굴</legend>
      <div className="face-options" role="group" aria-label="주름관 모양">
        {Array.from({ length: ductShapeCount }, (_, shape) => (
          <button key={shape} type="button" className="face-option" aria-label={`모양 ${shape + 1}`} aria-pressed={face.shape === shape} onClick={() => onChange({ ...face, shape })}>
            <RoomFaceArt face={{ ...face, shape }} px={pickerPx} className="face-art" />
          </button>
        ))}
      </div>
      <div className="face-options" role="group" aria-label="방 색">
        {faceColors.map((name, color) => (
          <button key={name} type="button" className="face-option" aria-label={name} title={name} aria-pressed={face.color === color} onClick={() => onChange({ ...face, color })}>
            <span className="face-swatch" style={{ background: faceColorVar(color) }} />
          </button>
        ))}
      </div>
    </fieldset>
  );
}
