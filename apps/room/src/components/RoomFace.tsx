import { useId } from "react";
import { vasePaths, type VaseBand } from "../art/vases";
import { faceColors, faceColorVar } from "../domain/face";
import type { RoomFace } from "../domain/model";

// 목 높이. 어느 화병이든 입구에서 이만큼 칠하면 몸통의 층과 겹치지 않아요(끝까지 찬 때만 층 위로 덮습니다).
const neckHeight = 30;

// 방은 어디서나 이 그림입니다. 모양과 색은 프로젝트, 안쪽 층은 파일 형식을 뜻해요.
export function RoomFaceArt({ face, bands = [], className, viewBox = "-100 -100 200 200", glass = "vase-body", band = "vase-band", line = "vase-line" }: {
  face: RoomFace;
  bands?: VaseBand[];
  className?: string;
  viewBox?: string;
  glass?: string;
  band?: string;
  line?: string;
}) {
  // WebKit은 크기 0인 다른 svg의 clipPath를 따라가지 못해 화병마다 둡니다.
  const clip = useId();
  const path = vasePaths[face.shape];
  return (
    <svg className={className} viewBox={viewBox} aria-hidden="true" focusable="false">
      <clipPath id={clip}><path d={path} /></clipPath>
      <path className={glass} d={path} />
      <g clipPath={`url(#${clip})`}>
        {bands.map((item) => <rect key={item.label} className={band} x={-100} y={item.y} width={200} height={item.height} fill={item.color} />)}
        <rect className="vase-neck" x={-100} y={-100} width={200} height={neckHeight} style={{ fill: faceColorVar(face.color) }} />
      </g>
      <path className={line} d={path} />
    </svg>
  );
}

// 방 설정의 얼굴 고르기. 고른 칸은 굵은 테두리로 보여 줍니다.
export function FacePicker({ face, onChange }: { face: RoomFace; onChange: (face: RoomFace) => void }) {
  return (
    <fieldset className="face-picker">
      <legend>방 얼굴</legend>
      <div className="face-options" role="group" aria-label="화병 모양">
        {vasePaths.map((_, shape) => (
          <button key={shape} type="button" className="face-option" aria-label={`모양 ${shape + 1}`} aria-pressed={face.shape === shape} onClick={() => onChange({ ...face, shape })}>
            <RoomFaceArt face={{ ...face, shape }} className="face-art" />
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
