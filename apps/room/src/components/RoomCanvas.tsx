import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ObjectShape } from "../art/ObjectShape";
import { canvasHeight, canvasScale, canvasWidth, clampItem, fileKey, folderKey, folderThings, itemBase, keyFolder, keyThing, listAt, nextSpot, type FolderEntry } from "../domain/canvas";
import { laneOf } from "../domain/care";
import { formatBytes, kindLabels, type CanvasItem, type Room, type Thing } from "../domain/model";
import type { Folder } from "../gateways/native";
import { usePicture } from "../storage/pictures";
import { useThumb } from "../storage/thumbs";
import { Icon } from "./Icon";
import { Meta } from "./Meta";

// 이만큼(화면 px) 움직여야 끌기로 봐요. 그 전에 떼면 누르기예요.
const dragSlop = 4;
const keyStep = 10;
const found = 60;
// 판 배율 하한. 375 폭에서 종이 하나가 손가락으로 집을 만큼(약 70) 보여요.
const boardFloor = 0.6;

type Drag = { key: string; kind: "move" | "size"; x: number; y: number; start: CanvasItem; moved: boolean };

// 방 판: 빈 캔버스예요. '꺼내기'로 필요한 파일·폴더만 골라 놓고, 끌어서 옮기고 모서리로 크기를 바꿔요.
// 판에서 빼도 실제 파일·폴더는 그대로예요(사용자 폴더는 건드리지 않아요). 파일을 누르면 서랍에 띄우고, 폴더를 누르면 꺼내기 목록이 그 폴더를 보여 줘요.
export function RoomCanvas({ room, folder, now, selectedId, onSelect, onOpen, onChange }: { room: Room; folder: Folder | null; now: number; selectedId: string | null; onSelect: (id: string) => void; onOpen: (id: string) => void; onChange: (items: CanvasItem[]) => void }) {
  const items = room.canvas ?? [];
  const byId = useMemo(() => new Map(room.things.map((thing) => [thing.id, thing])), [room.things]);
  // 판 위에 그릴 수 있는 것만: 기록이 사라진 파일·상자로 간 파일은 빼요. 폴더는 안에 파일이 하나도 없으면 빼요.
  const shown = items.filter((item) => {
    const id = keyThing(item.key);
    if (id) return byId.get(id) && !byId.get(id)!.box;
    return folderThings(room.things, keyFolder(item.key)!).length > 0;
  });
  const [picker, setPicker] = useState<{ dir: string } | null>(null);
  const board = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = board.current;
    if (!el) return;
    // 좁은 창에서도 종이가 읽히게 배율은 boardFloor 밑으로 줄이지 않고, 남는 폭은 판 안에서 옆으로 밀어 봐요.
    const measure = () => el.clientWidth > 0 && setScale(Math.max(boardFloor, el.clientWidth / canvasWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // 끄는 동안은 화면에서만 자리를 바꾸고, 손을 떼면 한 번 저장해요.
  const [live, setLive] = useState<CanvasItem | null>(null);
  const drag = useRef<Drag | null>(null);
  const placed = shown.map((item) => (live && live.key === item.key ? live : item));
  const height = canvasHeight(placed);

  // 손댄 것은 맨 뒤로 보내 다른 것 위에 그려지게 해요.
  const save = (next: CanvasItem) => onChange([...items.filter((item) => item.key !== next.key), clampItem(next)]);
  const remove = (key: string) => onChange(items.filter((item) => item.key !== key));
  const add = (key: string) => {
    if (items.some((item) => item.key === key)) return;
    onChange([...items, clampItem({ key, ...nextSpot(items), s: 1 })]);
    // 새로 놓은 것이 보이게 판 아래까지 내려가요.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-canvas-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest" }));
  };

  const down = (event: PointerEvent<HTMLElement>, item: CanvasItem, kind: Drag["kind"]) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { key: item.key, kind, x: event.clientX, y: event.clientY, start: item, moved: false };
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const now = drag.current;
    if (!now) return;
    const dx = event.clientX - now.x;
    const dy = event.clientY - now.y;
    if (!now.moved && Math.hypot(dx, dy) < dragSlop) return;
    now.moved = true;
    const next = now.kind === "move"
      ? { ...now.start, x: now.start.x + dx / scale, y: now.start.y + dy / scale }
      : { ...now.start, s: Math.min(canvasScale.max, Math.max(canvasScale.min, now.start.s + dx / scale / itemBase)) };
    setLive(clampItem(next));
  };
  // 끌었으면 저장하고 true. 끌지 않았으면 false(누르기)예요.
  const up = () => {
    const now = drag.current;
    drag.current = null;
    if (!now?.moved) return false;
    if (live) save(live);
    setLive(null);
    return true;
  };

  const keys = (event: KeyboardEvent<HTMLElement>, item: CanvasItem) => {
    const step = event.shiftKey ? keyStep * 4 : keyStep;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[event.key]) {
      event.preventDefault();
      save({ ...item, x: item.x + moves[event.key][0], y: item.y + moves[event.key][1] });
    } else if (event.key === "+" || event.key === "=" || event.key === "-") {
      event.preventDefault();
      save({ ...item, s: item.s + (event.key === "-" ? -0.1 : 0.1) });
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      remove(item.key);
    }
  };

  const onBoard = new Set(items.map((item) => item.key));
  return (
    <section className="room-canvas" aria-labelledby="room-canvas-title">
      <div className="room-canvas-head">
        <h2 id="room-canvas-title">판 <span className="lane-count">{shown.length}</span></h2>
        <p id="room-canvas-hint" className="sr-only">끌어서 옮기고 모서리로 크기를 바꿔요. 화살표로 옮기고 +·−로 크기, Delete로 판에서 빼요. 실제 파일은 그대로예요.</p>
        <button type="button" className={picker ? "quiet" : "primary"} aria-expanded={picker !== null} aria-controls="room-pick" onClick={() => setPicker(picker ? null : { dir: "" })}>{picker ? "꺼내기 닫기" : "꺼내기"}</button>
      </div>
      {picker && <Picker room={room} now={now} dir={picker.dir} onDir={(dir) => setPicker({ dir })} onBoard={onBoard} onAdd={add} />}
      <div ref={board} className="room-canvas-board" style={{ height: height * scale }}>
        {shown.length === 0 && (
          <p className="room-canvas-empty">
            빈 판이에요. 필요한 파일이나 폴더만 꺼내 놓아 보세요.
            {!picker && <button type="button" onClick={() => setPicker({ dir: "" })}>꺼내기</button>}
          </p>
        )}
        <div className="room-canvas-plane" style={{ width: canvasWidth, height, transform: `scale(${scale})` }}>
          {placed.map((item) => {
            const id = keyThing(item.key);
            const path = keyFolder(item.key);
            const thing = id ? byId.get(id)! : null;
            const label = thing ? thing.name : path!.split("/").pop()!;
            return (
              <div
                key={item.key}
                className={`canvas-item${thing && thing.id === selectedId ? " selected" : ""}${live?.key === item.key ? " moving" : ""}`}
                data-canvas-key={item.key}
                style={{ left: item.x, top: item.y, width: itemBase * item.s }}
                onPointerDown={(event) => down(event, item, "move")}
                onPointerMove={move}
                onPointerUp={(event) => {
                  const wasDrag = up();
                  if (wasDrag || (event.target as Element).closest(".canvas-item-tool")) return;
                  if (thing) onSelect(thing.id);
                  else setPicker({ dir: path! });
                }}
                onPointerCancel={() => {
                  drag.current = null;
                  setLive(null);
                }}
              >
                <button
                  type="button"
                  className="canvas-item-face"
                  aria-describedby="room-canvas-hint"
                  aria-pressed={thing ? thing.id === selectedId : undefined}
                  aria-label={thing ? `${thing.name}, ${kindLabels[thing.kind]}, ${formatBytes(thing.size)}${thing.missing ? ", 파일 없음" : ""}` : `${label} 폴더, 누르면 안을 보여 줘요`}
                  onClick={(event) => {
                    // 마우스는 위 onPointerUp이 맡아요. 여기는 키보드(Enter·Space)일 때만이에요.
                    if (event.detail !== 0) return;
                    if (thing) onSelect(thing.id);
                    else setPicker({ dir: path! });
                  }}
                  onDoubleClick={() => thing && onOpen(thing.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && thing && thing.id === selectedId) {
                      event.preventDefault();
                      onOpen(thing.id);
                      return;
                    }
                    keys(event, item);
                  }}
                >
                  {thing ? <CanvasPaper thing={thing} folder={folder} px={itemBase * item.s} /> : <CanvasFolder things={folderThings(room.things, path!)} name={label} px={itemBase * item.s} />}
                </button>
                <button type="button" className="quiet canvas-item-tool canvas-item-remove" aria-label={`${label} 판에서 빼기`} title="판에서 빼기(파일은 그대로예요)" onPointerDown={(event) => event.stopPropagation()} onClick={() => remove(item.key)}><Icon name="close" size={14} /></button>
                <span className="canvas-item-tool canvas-item-size" aria-hidden="true" onPointerDown={(event) => down(event, item, "size")} />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function CanvasPaper({ thing, folder, px }: { thing: Thing; folder: Folder | null; px: number }) {
  const self = useRef<HTMLSpanElement>(null);
  const own = usePicture(thing.id);
  const thumb = useThumb(self, own ? null : folder, thing);
  return (
    <span ref={self} className={`canvas-art${thing.missing ? " missing" : ""}`}>
      <ObjectShape kind={thing.kind} size={px} name={thing.name} seed={thing.id} picture={own ?? thumb} />
      <span className="lane-meta">{formatBytes(thing.size)}{thing.missing && <em>파일 없음</em>}</span>
    </span>
  );
}

// 폴더: 안의 큰 파일 세 장을 겹쳐 쌓고 맨 위 종이에 폴더 이름을 찍어요.
function CanvasFolder({ things, name, px }: { things: Thing[]; name: string; px: number }) {
  const [top, ...under] = [...things].sort((a, b) => b.size - a.size).slice(0, 3);
  const size = things.reduce((sum, thing) => sum + thing.size, 0);
  return (
    <span className="canvas-art">
      <span className="lane-art">
        {under.map((thing, at) => (
          <span key={thing.id} className={`lane-pile-under lane-pile-under-${at + 1}`} aria-hidden="true"><ObjectShape kind={thing.kind} size={px} seed={thing.id} /></span>
        ))}
        <ObjectShape kind={top.kind} size={px} name={name} seed={top.id} />
      </span>
      <span className="lane-meta"><b>{things.length.toLocaleString("ko-KR")}개</b>{formatBytes(size)}</span>
    </span>
  );
}

// 꺼내기 목록: 방 폴더를 들어가며 보는 작은 탐색기예요. 맨 위에서는 새로 온 파일을 먼저 보여 줘요. 찾으면 방 전체에서 이름·경로로 찾아요.
function Picker({ room, now, dir, onDir, onBoard, onAdd }: { room: Room; now: number; dir: string; onDir: (dir: string) => void; onBoard: Set<string>; onAdd: (key: string) => void }) {
  const [query, setQuery] = useState("");
  const { folders, files } = useMemo(() => listAt(room.things, dir), [room.things, dir]);
  const fresh = useMemo(() => (dir ? [] : room.things.filter((thing) => !thing.box && laneOf(thing, room, now) === "new").sort((a, b) => b.seenAt - a.seenAt).slice(0, 12)), [room, now, dir]);
  const words = query.trim().toLowerCase();
  const hits = words ? room.things.filter((thing) => !thing.box && thing.path.toLowerCase().includes(words)).slice(0, found) : [];
  const parent = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "";
  const fileRow = (thing: Thing) => <PickRow key={thing.id} name={thing.name} meta={[kindLabels[thing.kind], formatBytes(thing.size), thing.path.includes("/") && words ? thing.path.slice(0, thing.path.lastIndexOf("/")) : null]} placed={onBoard.has(fileKey(thing.id))} onAdd={() => onAdd(fileKey(thing.id))} />;
  const folderRow = (entry: FolderEntry) => <PickRow key={entry.path} folder name={entry.name} meta={[`${entry.things.length.toLocaleString("ko-KR")}개`, formatBytes(entry.size)]} placed={onBoard.has(folderKey(entry.path))} onAdd={() => onAdd(folderKey(entry.path))} onEnter={() => onDir(entry.path)} />;
  return (
    <div className="room-pick" id="room-pick" role="region" aria-label="꺼내기">
      <div className="room-pick-head">
        {dir ? (
          <>
            <button type="button" className="quiet" onClick={() => onDir(parent)}><Icon name="chevron" size={14} /> 위로</button>
            <strong title={dir}>{dir}</strong>
            {!onBoard.has(folderKey(dir)) && <button type="button" onClick={() => onAdd(folderKey(dir))}>이 폴더 놓기</button>}
          </>
        ) : (
          <strong>{room.name}</strong>
        )}
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이 방에서 찾기" aria-label="꺼낼 파일을 이름이나 경로로 찾기" />
      </div>
      {words ? (
        <ul className="room-pick-list">{hits.length ? hits.map(fileRow) : <li className="soft">찾는 파일이 없어요.</li>}</ul>
      ) : (
        <>
          {fresh.length > 0 && (
            <>
              <h3>새로 온 파일</h3>
              <ul className="room-pick-list">{fresh.map(fileRow)}</ul>
            </>
          )}
          {folders.length > 0 && (
            <>
              <h3>폴더</h3>
              <ul className="room-pick-list">{folders.map(folderRow)}</ul>
            </>
          )}
          {files.length > 0 && (
            <>
              <h3>파일</h3>
              <ul className="room-pick-list">{files.slice(0, 200).map(fileRow)}</ul>
            </>
          )}
          {folders.length === 0 && files.length === 0 && <p className="soft">여기에는 파일이 없어요.</p>}
        </>
      )}
    </div>
  );
}

function PickRow({ name, meta, placed, folder = false, onAdd, onEnter }: { name: string; meta: (string | null)[]; placed: boolean; folder?: boolean; onAdd: () => void; onEnter?: () => void }) {
  return (
    <li className="room-pick-row">
      {onEnter ? (
        <button type="button" className="quiet room-pick-name" onClick={onEnter} aria-label={`${name} 폴더 안 보기`}><b>{name}/</b><Meta items={meta} /></button>
      ) : (
        <span className="room-pick-name" title={name}><b>{name}</b><Meta items={meta} /></span>
      )}
      <button type="button" disabled={placed} onClick={onAdd} aria-label={placed ? `${name} 판에 있어요` : `${name}${folder ? " 폴더" : ""} 판에 놓기`}>{placed ? "판에 있음" : "놓기"}</button>
    </li>
  );
}
