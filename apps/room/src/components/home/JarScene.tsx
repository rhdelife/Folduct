import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ObjectShape } from "../../art/ObjectShape";
import { vasePaths } from "../../art/vases";
import { boxFolderName } from "../../domain/care";
import { kindGroups, type KindGroup } from "../../domain/home";
import { jarLayers } from "../../domain/jar";
import { formatBytes } from "../../domain/model";
import { range, scenes, smooth, stops, useEngine, useScene, useSceneGate, type SceneProps } from "./engine";

const home = stops[4];
const scene = scenes[4];
const listed = 40;
const rowIcon = 20;
// 둥근 몸통이 넓어 층이 잘 보이는 화병.
const jarShape = vasePaths[7];

// 상자 안 파일이 실제로 어디 있는지 알려 줍니다. 샘플처럼 폴더를 못 옮기는 방은 Folduct 안에서만 상자에 들어가요.
function BoxNote({ group }: { group: KindGroup }) {
  if (group.top.length === 0) return <p className="jar-note">상자가 비어 있어요. 주간 정리를 하면 쓰러진 파일이 여기로 와요.</p>;
  if (group.top.every((file) => file.thing.box?.state === "virtual")) return <p className="jar-note">Folduct 안에서만 넣어 뒀어요. 폴더의 파일은 그대로예요.</p>;
  return <p className="jar-note">방 폴더의 <span className="path">{boxFolderName}</span>에 옮겨 뒀어요. 지운 게 아니에요.</p>;
}

function FileList({ group, actions }: { group: KindGroup; actions: SceneProps["actions"] }) {
  const rest = group.count - group.top.length;
  return (
    <div className="jar-list" role="group" aria-label={`${group.label} 파일`} data-own-wheel>
      <header className="jar-list-head">
        <strong>{group.label}</strong>
        <span>{group.count}개{group.count > 0 && ` · ${formatBytes(group.bytes)}`}</span>
      </header>
      {group.box && <BoxNote group={group} />}
      {!group.box && group.count === 0 && <p className="jar-note">아직 파일이 없어요.</p>}
      {group.top.length > 0 && (
        <ul className="jar-rows" key={group.label}>
          {group.top.map((file, at) => (
            <li key={file.thing.id} style={{ "--at": Math.min(at, 12) } as CSSProperties}>
              <button type="button" title={file.thing.path} onClick={() => actions.focusThing(file.room.id, file.thing.id)}>
                <ObjectShape kind={file.thing.kind} size={rowIcon} />
                <span className="jar-row-name">{file.thing.name}</span>
                <span className="jar-row-room">{file.room.name}</span>
                <span className="jar-row-size">{formatBytes(file.thing.size)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {rest > 0 && <p className="jar-note">그 밖에 {rest}개 더 있어요.</p>}
      {group.box && <button type="button" className="jar-sweep" onClick={actions.openSweep}>주간 정리</button>}
    </div>
  );
}

// 내 파일 전체가 큰 화병 하나에 형식별 층으로 쌓여 있습니다. 층을 고르면 옆에 그 파일들이 놓이고, 화병 받침이 정리 상자예요.
export function JarScene({ rooms, now, actions }: SceneProps) {
  const gate = useSceneGate(4);
  const engine = useEngine();
  const groups = useMemo(() => kindGroups(rooms, now, listed), [rooms, now]);
  const kinds = groups.filter((group) => !group.box);
  const box = groups.find((group) => group.box)!;
  const layers = useMemo(() => jarLayers(kinds), [groups]);
  const [picked, setPicked] = useState<string | null>(null);
  // 도착하면 아래부터 차오릅니다. 화면 밖으로 나가야 비워서, 떠나는 동안 층이 사라지지 않아요.
  const [filled, setFilled] = useState(() => engine.pos >= home - 8);
  const stage = useRef<HTMLDivElement>(null);

  useScene((pos) => {
    const rise = smooth(range(pos, scene.show[0], home));
    stage.current!.style.transform = rise < 1 ? `translate3d(0, ${(1 - rise) * 100}dvh, 0)` : "none";
    if (pos >= home - 8) setFilled(true);
    else if (pos < scene.show[0]) setFilled(false);
  });

  // 고른 층이 없으면 가장 큰 층을 보여 줘, 누르지 않아도 파일이 보입니다. 층이 사라지면 다시 가장 큰 층으로 돌아가요.
  const fallback = layers.length > 0 ? kinds[layers[0].at] : box;
  const current = groups.find((group) => group.label === picked && (group.box || group.count > 0)) ?? fallback;
  useEffect(() => {
    if (picked !== null && current.label !== picked) setPicked(null);
  }, [picked, current]);

  return (
    <section className="scene scene-jar" aria-label="형식별 파일" {...gate}>
      <div className="jar-stage" ref={stage}>
        <div className="jar-figure">
          <svg className="jar-art" viewBox="-92 -102 212 202" aria-hidden="true" focusable="false" data-filled={filled}>
            <defs><clipPath id="jar-clip"><path d={jarShape} /></clipPath></defs>
            {layers.map(({ at, y, height }) => <line key={kinds[at].label} className={`jar-lead${kinds[at] === current ? " on" : ""}`} x1="0" x2="120" y1={y + height / 2} y2={y + height / 2} />)}
            <path className="jar-glass" d={jarShape} />
            <g clipPath="url(#jar-clip)">
              {layers.map(({ at, y, height }, turn) => (
                <g key={kinds[at].label} className={current.box || kinds[at] === current ? "jar-band" : "jar-band is-dim"}>
                  <rect className="jar-layer" style={{ "--turn": turn } as CSSProperties} x="-92" y={y} width="184" height={height + 0.5} fill={kinds[at].color} onClick={() => setPicked(kinds[at].label)} />
                </g>
              ))}
            </g>
            <path className="jar-edge" d={jarShape} />
          </svg>
          <div className="jar-labels">
            {layers.map(({ at, y, height }) => {
              const group = kinds[at];
              return (
                <button key={group.label} type="button" className="jar-label" style={{ "--y": (y + height / 2 + 102) / 202 } as CSSProperties} aria-pressed={group === current} onClick={() => setPicked(group.label)}>
                  <b>{group.label}</b>
                  <span>{group.count}개 · {formatBytes(group.bytes)}</span>
                </button>
              );
            })}
          </div>
          <button type="button" className="jar-box" aria-pressed={current.box} onClick={() => setPicked(box.label)}>
            <b>{box.label}</b>
            <span>{box.count}개{box.count > 0 && ` · ${formatBytes(box.bytes)}`}</span>
          </button>
        </div>
        <FileList group={current} actions={actions} />
      </div>
    </section>
  );
}
