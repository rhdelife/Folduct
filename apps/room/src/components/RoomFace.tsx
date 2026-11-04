import { useMemo, type CSSProperties } from "react";
import { drawPose, drawRoom, ductLayers, ductShapeCount, type DuctDrawing, type DuctPiece, type DuctPose } from "../art/duct";
import { faceColors, faceColorVar } from "../domain/face";
import type { RoomFace } from "../domain/model";

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

function DuctArt({ drawing, className, foot, paper, band }: { drawing: DuctDrawing; className?: string; foot?: string; paper?: string; band?: string }) {
  return (
    <svg className={className} viewBox={drawing.viewBox} aria-hidden="true" focusable="false" style={{ "--duct-foot": foot, "--duct-paper": paper } as CSSProperties}>
      {drawing.items.map((item, at) =>
        "parts" in item ? (
          <g key={at} transform={item.transform} className={item.rib === undefined ? undefined : "duct-rib"} style={item.rib === undefined ? undefined : ({ "--rib": item.rib } as CSSProperties)}>
            {item.parts.map((part, inner) => <Piece key={inner} piece={part} band={band} />)}
          </g>
        ) : (
          <Piece key={at} piece={item} band={band} />
        ),
      )}
    </svg>
  );
}

const partsKey = (parts: Parts) => parts.map((part) => `${part.label}:${part.size}`).join();

// 방은 어디서나 이 그림입니다. 모양과 받침 색은 프로젝트, 길이는 용량, 주름 색은 파일 형식을 뜻해요. px는 그림이 차지하는 폭입니다.
export function RoomFaceArt({ face, parts = [], length = 0.7, px, className }: { face: RoomFace; parts?: Parts; length?: number; px: number; className?: string }) {
  const key = partsKey(parts);
  const level = Math.round(length * 50) / 50;
  // 부모가 다시 그려져도 같은 값이면 선을 다시 만들지 않습니다.
  const drawing = useMemo(() => drawRoom(face.shape, level, { px, layers: ductLayers(parts) }), [face.shape, level, px, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return <DuctArt drawing={drawing} className={className} foot={faceColorVar(face.color)} />;
}

// 플로팅 창과 인트로의 자세. 창 안에서는 표준 자세에 그 방의 색만 입혀요. 자세를 모양마다 그리면 56가지가 됩니다.
export function PoseArt({ pose, parts = [], px, foot, paper, band, className }: { pose: DuctPose; parts?: Parts; px: number; foot?: string; paper?: string; band?: string; className?: string }) {
  const key = partsKey(parts);
  const drawing = useMemo(() => drawPose(pose, { px, layers: ductLayers(parts) }), [pose, px, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return <DuctArt drawing={drawing} className={className} foot={foot} paper={paper} band={band} />;
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
