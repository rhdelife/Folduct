import { useEffect, useId, useRef, useState } from "react";
import { vasePaths, type VaseBand } from "../art/vases";
import { faceColors, faceColorVar } from "../domain/face";
import { defaultCell, dotSizes, fitBand, type RoomMark } from "../domain/halftone";
import type { RoomFace } from "../domain/model";
import { cutoutFromFile, renderMark } from "../gateways/markImage";
import { deleteRoomMark, getRoomMark, setRoomMark } from "../storage/db";

// 목 높이. 어느 화병이든 입구에서 이만큼 칠하면 몸통의 층과 겹치지 않아요(끝까지 찬 때만 층 위로 덮습니다).
const neckHeight = 30;
// 오브제 안에 파일 형식 층을 채울지. 끄면 오브제가 방 색 하나로만 보입니다.
const markShowsLayers = true;

// 한 번 읽은 오브제는 화면마다 다시 읽지 않습니다. stamp가 바뀌면 새로 읽어요.
const marks = new Map<string, { stamp: number; mark: RoomMark | null }>();

function useRoomMark(roomId: string | undefined, stamp: number | undefined): RoomMark | null {
  const key = roomId && stamp ? roomId : null;
  const cached = key ? marks.get(key) : undefined;
  const [, loaded] = useState(0);
  useEffect(() => {
    if (!key || !stamp || cached?.stamp === stamp) return;
    let live = true;
    getRoomMark(key).then(
      (mark) => {
        marks.set(key, { stamp, mark });
        if (live) loaded((count) => count + 1);
      },
      // 못 읽으면 화병으로 보여 줍니다.
      (error: unknown) => console.error(error),
    );
    return () => {
      live = false;
    };
  }, [key, stamp, cached?.stamp]);
  return cached?.stamp === stamp ? (cached?.mark ?? null) : null;
}

type Art = { face: RoomFace; bands: VaseBand[]; className?: string; viewBox: string };

function VaseArt({ face, bands, className, viewBox, glass, band, line }: Art & { glass: string; band: string; line: string }) {
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

// 오브제: 실루엣 종이 위에 망점을 찍습니다. 점은 방 색이고, 찬 만큼 아래부터 파일 형식 색으로 물듭니다. 작은 크기에서는 점이 뭉개져 실루엣만 칠해요.
function MarkArt({ face, mark, bands, compact, className, viewBox }: Art & { mark: RoomMark; compact: boolean }) {
  const id = useId();
  const color = faceColorVar(face.color);
  const box = { x: -100, y: -100, width: 200, height: 200 };
  return (
    <svg className={className} viewBox={viewBox} aria-hidden="true" focusable="false">
      <mask id={`${id}p`} maskUnits="userSpaceOnUse" {...box}><image href={mark.silhouette} {...box} /></mask>
      {compact ? (
        <rect {...box} mask={`url(#${id}p)`} style={{ fill: color }} />
      ) : (
        <>
          <mask id={`${id}i`} maskUnits="userSpaceOnUse" {...box}><image href={mark.dots} {...box} /></mask>
          <rect className="mark-paper" {...box} mask={`url(#${id}p)`} />
          <g className="mark-ink" mask={`url(#${id}i)`}>
            <rect {...box} style={{ fill: color }} />
            {markShowsLayers && bands.map((item) => {
              const fitted = fitBand(item, mark.height);
              return <rect key={item.label} x={-100} y={fitted.y} width={200} height={fitted.height} fill={item.color} />;
            })}
          </g>
        </>
      )}
    </svg>
  );
}

// 방은 어디서나 이 그림입니다. 모양과 색은 프로젝트, 안쪽 층은 파일 형식과 찬 정도를 뜻해요. 이미지를 넣은 방은 화병 자리에 오브제가 놓입니다.
export function RoomFaceArt({ face, roomId, compact = false, bands = [], className, viewBox = "-100 -100 200 200", glass = "vase-body", band = "vase-band", line = "vase-line" }: {
  face: RoomFace;
  roomId?: string;
  compact?: boolean;
  bands?: VaseBand[];
  className?: string;
  viewBox?: string;
  glass?: string;
  band?: string;
  line?: string;
}) {
  const mark = useRoomMark(roomId, face.mark);
  if (mark) return <MarkArt face={face} mark={mark} bands={bands} compact={compact} className={className} viewBox={viewBox} />;
  return <VaseArt face={face} bands={bands} className={className} viewBox={viewBox} glass={glass} band={band} line={line} />;
}

// 방 설정의 얼굴 고르기. 고른 칸은 굵은 테두리로 보여 줍니다.
export function FacePicker({ roomId, face, bands, onChange }: { roomId: string; face: RoomFace; bands: VaseBand[]; onChange: (face: RoomFace) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<{ source: string; cell: number } | null>(null);

  useEffect(() => {
    if (!face.mark) return setSource(null);
    let live = true;
    getRoomMark(roomId).then((mark) => live && mark && setSource({ source: mark.source, cell: mark.cell }), (reason: unknown) => console.error(reason));
    return () => {
      live = false;
    };
  }, [roomId, face.mark]);

  async function apply(next: string, cell: number) {
    const mark = await renderMark(next, cell);
    await setRoomMark(roomId, mark);
    const stamp = Date.now();
    marks.set(roomId, { stamp, mark });
    onChange({ ...face, mark: stamp });
  }

  async function take(picked: File) {
    setBusy(true);
    setError(null);
    try {
      const cutout = await cutoutFromFile(picked);
      if (cutout.ok) await apply(cutout.source, defaultCell);
      else setError(cutout.error);
    } catch (reason) {
      console.error(reason);
      setError("이미지를 저장하지 못했어요. 저장 공간을 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setError(null);
    try {
      await deleteRoomMark(roomId);
      marks.delete(roomId);
      const { mark: _, ...vase } = face;
      onChange(vase);
    } catch (reason) {
      console.error(reason);
      setError("되돌리지 못했어요. 잠시 뒤 다시 해 주세요.");
    }
  }

  // 사진 앱에서 복사한 피사체를 그대로 붙여 넣습니다. 글자를 쓰는 칸의 붙여넣기는 건드리지 않아요.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if ((event.target as Element | null)?.closest?.("input, textarea, [contenteditable]")) return;
      const image = [...(event.clipboardData?.files ?? [])].find((item) => item.type.startsWith("image/"));
      if (!image) return;
      event.preventDefault();
      void take(image);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

  return (
    <fieldset className="face-picker">
      <legend>방 얼굴</legend>
      {face.mark ? (
        <div className="mark-preview">
          <RoomFaceArt face={face} roomId={roomId} bands={bands} className="mark-preview-art" />
          <div className="mark-actions">
            <div className="seg" role="radiogroup" aria-label="점 굵기">
              {dotSizes.map((size) => (
                <label key={size.cell}>
                  <input type="radio" name={`mark-cell-${roomId}`} checked={source?.cell === size.cell} disabled={busy || !source} onChange={() => source && void apply(source.source, size.cell).catch((reason: unknown) => { console.error(reason); setError("이미지를 저장하지 못했어요. 저장 공간을 확인해 주세요."); })} />
                  {size.label}
                </label>
              ))}
            </div>
            <button type="button" className="quiet" onClick={() => void remove()}>화병으로 되돌리기</button>
          </div>
        </div>
      ) : (
        <div className="face-options" role="group" aria-label="화병 모양">
          {vasePaths.map((_, shape) => (
            <button key={shape} type="button" className="face-option" aria-label={`모양 ${shape + 1}`} aria-pressed={face.shape === shape} onClick={() => onChange({ ...face, shape })}>
              <RoomFaceArt face={{ ...face, shape, mark: undefined }} className="face-art" />
            </button>
          ))}
        </div>
      )}
      <div className="face-options" role="group" aria-label="방 색">
        {faceColors.map((name, color) => (
          <button key={name} type="button" className="face-option" aria-label={name} title={name} aria-pressed={face.color === color} onClick={() => onChange({ ...face, color })}>
            <span className="face-swatch" style={{ background: faceColorVar(color) }} />
          </button>
        ))}
      </div>
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const picked = event.target.files?.[0];
          event.target.value = "";
          if (picked) void take(picked);
        }}
      />
      <button type="button" className="mark-add" disabled={busy} onClick={() => file.current?.click()}>{busy ? "만드는 중…" : face.mark ? "다른 이미지 넣기" : "이미지 넣기"}</button>
      <small className="soft">배경이 투명한 이미지를 넣으면 망점 오브제로 바꿔요. 사진 앱에서 피사체를 복사해 붙여 넣어도 돼요.</small>
      {error && <p className="error" role="alert">{error}</p>}
    </fieldset>
  );
}
