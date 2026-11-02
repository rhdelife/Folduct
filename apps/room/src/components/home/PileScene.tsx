import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ObjectShape } from "../../art/ObjectShape";
import { boxFolderName } from "../../domain/care";
import { kindGroups, type KindGroup } from "../../domain/home";
import { formatBytes } from "../../domain/model";
import { pileSheets } from "../../domain/pile";
import { hash } from "../../domain/sky";
import { CardboardBox } from "../RoomScene";
import { range, scenes, smooth, stops, useEngine, useScene, useSceneGate, type SceneProps } from "./engine";

const home = stops[4];
const scene = scenes[4];
const listed = 40;
const rowIcon = 20;
const sheetSize = 72;
// 맨 위 종이에만 이름을 찍습니다. 아래 종이까지 찍으면 글자가 겹쳐 지저분해요.
const noName = Number.POSITIVE_INFINITY;

// 상자 안 파일이 실제로 어디 있는지 알려 줍니다. 샘플처럼 폴더를 못 옮기는 방은 Folduct 안에서만 상자에 들어가요.
function BoxNote({ group }: { group: KindGroup }) {
  if (group.top.length === 0) return <p className="pile-note">상자가 비어 있어요. 주간 정리를 하면 오래된 파일이 여기로 와요.</p>;
  if (group.top.every((file) => file.thing.box?.state === "virtual")) return <p className="pile-note">Folduct 안에서만 넣어 뒀어요. 폴더의 파일은 그대로예요.</p>;
  return <p className="pile-note">방 폴더의 <span className="path">{boxFolderName}</span>에 옮겨 뒀어요. 지운 게 아니에요.</p>;
}

function FileList({ group, actions }: { group: KindGroup; actions: SceneProps["actions"] }) {
  const rest = group.count - group.top.length;
  return (
    <div className="pile-list" role="group" aria-label={`${group.label} 파일`} data-own-wheel>
      <header className="pile-list-head">
        <strong>{group.label}</strong>
        <span>{group.count}개{group.count > 0 && ` · ${formatBytes(group.bytes)}`}</span>
      </header>
      {group.box && <BoxNote group={group} />}
      {!group.box && group.count === 0 && <p className="pile-note">아직 파일이 없어요.</p>}
      {group.top.length > 0 && (
        <ul className="pile-files" key={group.label}>
          {group.top.map((file, at) => (
            <li key={file.thing.id} style={{ "--at": Math.min(at, 12) } as CSSProperties}>
              <button type="button" title={file.thing.path} onClick={() => actions.focusThing(file.room.id, file.thing.id)}>
                <ObjectShape kind={file.thing.kind} size={rowIcon} />
                <span className="pile-file-name">{file.thing.name}</span>
                <span className="pile-file-room">{file.room.name}</span>
                <span className="pile-file-size">{formatBytes(file.thing.size)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {rest > 0 && <p className="pile-note">그 밖에 {rest}개 더 있어요.</p>}
      {group.box && <button type="button" className="pile-sweep" onClick={actions.openSweep}>주간 정리</button>}
    </div>
  );
}

// 형식마다 파일 종이가 한 더미씩 쌓입니다. 화병은 방 하나만 뜻해서 여기에는 쓰지 않아요. 더미를 고르면 옆에 그 파일들이 놓입니다.
export function PileScene({ rooms, now, actions }: SceneProps) {
  const gate = useSceneGate(4);
  const engine = useEngine();
  const groups = useMemo(() => kindGroups(rooms, now, listed), [rooms, now]);
  const kinds = groups.filter((group) => !group.box);
  const box = groups.find((group) => group.box)!;
  const piles = useMemo(() => pileSheets(kinds), [groups]);
  const [picked, setPicked] = useState<string | null>(null);
  // 도착하면 종이가 내려앉습니다. 화면 밖으로 나가야 비워서, 떠나는 동안 더미가 사라지지 않아요.
  const [filled, setFilled] = useState(() => engine.pos >= home - 8);
  const stage = useRef<HTMLDivElement>(null);

  useScene((pos) => {
    const rise = smooth(range(pos, scene.show[0], home));
    stage.current!.style.transform = rise < 1 ? `translate3d(0, ${(1 - rise) * 100}dvh, 0)` : "none";
    if (pos >= home - 8) setFilled(true);
    else if (pos < scene.show[0]) setFilled(false);
  });

  // 고른 더미가 없으면 가장 큰 더미를 보여 줘, 누르지 않아도 파일이 보입니다. 더미가 사라지면 다시 가장 큰 더미로 돌아가요.
  const fallback = piles.length > 0 ? kinds[piles[0].at] : box;
  const current = groups.find((group) => group.label === picked && (group.box || group.count > 0)) ?? fallback;
  useEffect(() => {
    if (picked !== null && current.label !== picked) setPicked(null);
  }, [picked, current]);

  return (
    <section className="scene scene-pile" aria-label="형식별 파일" {...gate}>
      <div className="pile-stage" ref={stage}>
        <div className="pile-row" data-filled={filled} data-own-wheel>
          {piles.map(({ at, sheets }, order) => {
            const group = kinds[at];
            // 큰 파일이 맨 위에 오도록 아래부터 쌓습니다.
            const stack = group.top.slice(0, sheets).reverse();
            return (
              <button key={group.label} type="button" className={`pile${group === current ? "" : " is-dim"}`} aria-pressed={group === current} onClick={() => setPicked(group.label)}>
                <span className="pile-stack" aria-hidden="true">
                  {stack.map((file, level) => (
                    <span key={file.thing.id} className="pile-sheet" style={{ "--level": level, "--turn": Math.min(order * 2 + level, 20), "--dx": hash(file.thing.id, 32) - 0.5, "--rot": (hash(file.thing.id, 31) - 0.5) * 14 } as CSSProperties}>
                      <ObjectShape kind={file.thing.kind} size={sheetSize} seed={file.thing.id} name={file.thing.name} nameFrom={level === stack.length - 1 ? undefined : noName} />
                    </span>
                  ))}
                </span>
                <b className="pile-name">{group.label}</b>
                <span className="pile-size">{group.count}개 · {formatBytes(group.bytes)}</span>
              </button>
            );
          })}
          <button type="button" className={`pile pile-box${current.box ? "" : " is-dim"}`} aria-pressed={current.box} onClick={() => setPicked(box.label)}>
            <span className="pile-stack" aria-hidden="true">
              <span className="pile-box-art"><CardboardBox things={box.top.map((file) => file.thing)} /></span>
            </span>
            <b className="pile-name">{box.label}</b>
            <span className="pile-size">{box.count}개{box.count > 0 && ` · ${formatBytes(box.bytes)}`}</span>
          </button>
        </div>
        <FileList group={current} actions={actions} />
      </div>
    </section>
  );
}
