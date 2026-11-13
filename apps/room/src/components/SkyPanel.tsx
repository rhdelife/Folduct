import { useEffect, useRef, useState } from "react";
import { shortPath } from "../domain/platform";
import { ObjectShape } from "../art/ObjectShape";
import { ductLength, kindParts } from "../art/duct";
import { RoomFaceArt } from "./RoomFace";
import { laneOf, lastActivity, relativeDay, thingAge } from "../domain/care";
import { formatBytes, type Room } from "../domain/model";
import { roomUsage } from "../domain/care";
import { homeActivity, pickStarThings, progressText, roomActivity, type RoomStat } from "../domain/sky";
import { Capacity } from "./Capacity";
import { roomMenuTriggers, type OpenRoomMenu } from "./ContextMenu";
import { KindMix } from "./KindLegend";
import { MiniRoom } from "./MiniRoom";

// 스크립트로 움직이는 스크롤도 '동작 줄이기'를 따릅니다.
const scrollBehavior = (): ScrollBehavior => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

export function HomeSummary({ rooms, stats, now }: { rooms: Room[]; stats: Map<string, RoomStat>; now: number }) {
  let total = 0;
  let staleFiles = 0;
  for (const { usage, stale } of stats.values()) {
    total += usage.totalBytes;
    staleFiles += stale;
  }
  const active = rooms.filter((item) => !item.care.done).length;
  return (
    <div className="sky-summary">
      <p className="lede">
        {active === 0
          ? "홈에 둔 방이 없어요. 새 방을 만들거나, 뺀 방을 골라 홈에 올릴 수 있어요."
          : "주름관은 방, 색은 파일 형식이에요. 관이 길수록 용량이 커요. 파일은 클수록 크게, 오래 손대지 않을수록 멀리 떠 있어요. 홈에서 뺀 방은 지도에서 빠지고 아래 목록에 모여요."}
      </p>
      <dl>
        <div><dt>홈 / 뺀 방</dt><dd>{active}<small> / {rooms.length - active}</small></dd></div>
        <div><dt>{rooms.some((item) => item.source === "sample") ? "전체 용량 (샘플 포함)" : "전체 용량"}</dt><dd>{formatBytes(total)}</dd></div>
        <div><dt>오래된 파일</dt><dd>{staleFiles}<small>개</small></dd></div>
      </dl>
      <ActivityChart title="최근 14일 · 사용한 방 수" bars={homeActivity(rooms, now)} unit="개 방" />
    </div>
  );
}

// 메뉴 안의 방 목록. 누르면 그 방으로 바로 들어갑니다.
export function RoomRanking({ rooms, stats, now, onOpenRoom, onRoomMenu }: { rooms: Room[]; stats: Map<string, RoomStat>; now: number; onOpenRoom: (id: string) => void; onRoomMenu: OpenRoomMenu }) {
  const [roomSort, setRoomSort] = useState<"size" | "messy">("size");
  const rows = rooms.map((item) => ({ room: item, ...stats.get(item.id)! }));
  rows.sort((a, b) => (roomSort === "size" ? b.usage.totalBytes - a.usage.totalBytes : b.stale - a.stale));
  const activeRows = rows.filter((row) => !row.room.care.done);
  const doneRows = rows.filter((row) => row.room.care.done);
  return (
    <div className="sky-panel-body">
      <header>
        <h2>방 {rooms.length}개</h2>
      </header>
      <div className="sort" role="group" aria-label="정렬">
        <button type="button" aria-pressed={roomSort === "size"} onClick={() => setRoomSort("size")}>용량 순</button>
        <button type="button" aria-pressed={roomSort === "messy"} onClick={() => setRoomSort("messy")}>정리할 것 순</button>
      </div>
      {/* 뺀 방은 아래에 접어 둡니다. 순위 경쟁에서도 빠집니다. 모두 뺐으면 펼쳐 둡니다. */}
      <RoomRows rows={activeRows} now={now} onSelectRoom={onOpenRoom} onRoomMenu={onRoomMenu} />
      {doneRows.length > 0 && (
        <details className="done-group" open={activeRows.length === 0}>
          <summary>홈에서 뺀 방 {doneRows.length}</summary>
          <RoomRows rows={doneRows} now={now} onSelectRoom={onOpenRoom} onRoomMenu={onRoomMenu} />
        </details>
      )}
    </div>
  );
}

export function SkyPanel({
  room,
  stats,
  now,
  focusId,
  onSelectRoom,
  onFocusThing,
  onEnter,
  onToggleDone,
}: {
  room: Room;
  stats: Map<string, RoomStat>;
  now: number;
  focusId: string | null;
  onSelectRoom: (id: string | null) => void;
  onFocusThing: (roomId: string, thingId: string) => void;
  onEnter: (id: string) => void;
  onToggleDone: (id: string) => void;
}) {
  const [thingSort, setThingSort] = useState<"size" | "old">("size");
  const body = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusRow = useRef<HTMLLIElement>(null);

  // 누른 버튼이 사라지면 포커스를 방 이름으로 이어 줍니다. 지도처럼 다른 곳에 포커스가 있으면 빼앗지 않습니다.
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body || body.current?.contains(active)) heading.current?.focus();
  }, [room.id]);

  // 지도에서 파일을 누르면 목록 안에서만 그 줄로 스크롤합니다. 페이지 전체는 움직이지 않습니다.
  useEffect(() => {
    const row = focusRow.current;
    const box = row?.closest<HTMLElement>(".sky-panel");
    if (!row || !box || box.scrollHeight <= box.clientHeight) return;
    const top = row.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    box.scrollTo({ top: top - box.clientHeight / 2, behavior: scrollBehavior() });
  }, [focusId]);

  const things = room.things.filter((thing) => !thing.missing).map((thing) => ({ thing, ...thingAge(thing, room, now) }));
  things.sort((a, b) => (thingSort === "size" ? b.thing.size - a.thing.size : (a.thing.touchedAt === null ? Infinity : lastActivity(a.thing)) - (b.thing.touchedAt === null ? Infinity : lastActivity(b.thing))));
  // 고른 순서로 100개, 그리고 지도에 뜬 파일은 모두 넣어 지도의 별마다 줄이 있게 합니다. 뺀 방은 지도에 없어요.
  const starIds = new Set(room.care.done ? [] : pickStarThings(room, 40).map((thing) => thing.id));
  const listed = things.filter((item, index) => index < 100 || starIds.has(item.thing.id));
  const { stale, progress: roomProgress } = stats.get(room.id)!;
  const progress = progressText(roomProgress, now);
  return (
    <div className="sky-panel-body" ref={body}>
      <header className="room-mode">
        <button type="button" className="link back" onClick={() => onSelectRoom(null)}>← 닫기</button>
        <h2 tabIndex={-1} ref={heading}>{room.name}</h2>
        <p className="soft">{room.source === "sample" ? "샘플 방" : `${room.rootName} 폴더`} · 파일 {room.things.filter((thing) => !thing.box).length}개 · 오래됨 {stale}개</p>
        {room.care.done && <p className="soft">홈에서 뺀 방이라 주간 정리가 쉬어요.</p>}
        <button type="button" className="preview" onClick={() => onEnter(room.id)} aria-label={`${room.name} 방에 들어가기`}>
          <MiniRoom room={room} now={now} />
        </button>
        <Capacity usage={stats.get(room.id)!.usage} />
        {progress && <p className="soft">{progress}</p>}
        <div className="row">
          <button type="button" className="primary enter" onClick={() => onEnter(room.id)}>방에 들어가기</button>
          <button type="button" onClick={() => onToggleDone(room.id)}>{room.care.done ? "홈에 올리기" : "홈에서 빼기"}</button>
        </div>
      </header>
      <div className="rank-head">
        <span>파일</span>
        <div className="sort" role="group" aria-label="정렬">
          <button type="button" aria-pressed={thingSort === "size"} onClick={() => setThingSort("size")}>큰 순</button>
          <button type="button" aria-pressed={thingSort === "old"} onClick={() => setThingSort("old")}>오래 그대로인 순</button>
        </div>
      </div>
      <ol className="rank files">
        {listed.map(({ thing, stale: old, days }) => (
          <li key={thing.id} ref={thing.id === focusId ? focusRow : undefined} className={thing.id === focusId ? "focused" : ""}>
            <button type="button" onClick={() => onFocusThing(room.id, thing.id)}>
              <ObjectShape kind={thing.kind} size={20} seed={thing.id} />
              <span className="rank-name"><strong>{thing.name}</strong><small>{thing.path}</small></span>
              <span className="rank-num">
                <strong>{formatBytes(thing.size)}</strong>
                <small className={old ? "warn" : ""}>
                  {{ box: "정리 상자", new: "새로 왔어요", quiet: `${days}일째 그대로`, use: "요즘 써요" }[laneOf(thing, room, now)]}
                </small>
              </span>
            </button>
          </li>
        ))}
      </ol>
      {things.length > listed.length && <p className="soft">{thingSort === "size" ? "큰 순" : "오래 그대로인 순"}으로 100개{room.care.done ? "" : "와 지도에 뜬 파일"}만 보여요. 나머지는 방에 들어가서 볼 수 있어요.</p>}
      <ActivityChart title="최근 14일 · 사용한 파일 수" bars={roomActivity(room, now)} unit="개" />
    </div>
  );
}

// 방은 어디서나 주름관입니다. 지도와 같은 그림을 줄 높이에 맞춰 작게 그려요.
const rankPx = 24;

export function RankVase({ room, partial }: { room: Room; partial: boolean }) {
  return <RoomFaceArt face={room.face} parts={partial ? [] : kindParts(room.things)} length={ductLength(roomUsage(room).totalBytes)} px={rankPx} className="rank-vase" />;
}

function RoomRows({ rows, now, onSelectRoom, onRoomMenu }: { rows: ({ room: Room } & RoomStat)[]; now: number; onSelectRoom: (id: string) => void; onRoomMenu: OpenRoomMenu }) {
  return (
    <ol className="rank">
      {rows.map(({ room, usage, stale, progress }, index) => (
        <li key={room.id} className={room.care.done ? "done" : ""}>
          <button type="button" data-room-id={room.id} onClick={() => onSelectRoom(room.id)} {...roomMenuTriggers(room.id, onRoomMenu)}>
            <span className="rank-no">{room.care.done ? "–" : index + 1}</span>
            <RankVase room={room} partial={!usage.exact} />
            <span className="rank-name"><strong>{room.name}</strong><small>{room.source === "sample" ? "샘플 방" : room.origin ? shortPath(room.origin) : room.rootName}</small><KindMix things={room.things} /></span>
            <span className="rank-num">
              <strong>{usage.exact ? "" : "최소 "}{formatBytes(usage.totalBytes)}</strong>
              <small className={!room.care.done && stale ? "warn" : ""}>{room.care.done ? "홈에서 뺌" : stale === 0 ? "깨끗함" : `오래됨 ${stale}`}</small>
              {progress.lastActivityAt !== null && <small>마지막 작업 {relativeDay(progress.lastActivityAt, now)}</small>}
            </span>
          </button>
        </li>
      ))}
      {rows.length === 0 && <li className="soft empty-row">진행 중인 방이 없어요.</li>}
    </ol>
  );
}

function ActivityChart({ title, bars, unit }: { title: string; bars: { day: string; value: number; worked?: boolean }[]; unit: string }) {
  const max = Math.max(1, ...bars.map((bar) => bar.value));
  const active = bars.filter((bar) => bar.value > 0 || bar.worked).length;
  const w = 300;
  const h = 84;
  const step = w / bars.length;
  // 색은 글자색(먹)을 따라갑니다. 오늘만 진하게, 나머지 날은 옅게.
  return (
    <figure className="activity">
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${title}: 14일 중 ${active}일 사용, 가장 많은 날 ${max}${unit}`}>
        <line x1="0" y1={h} x2={w} y2={h} stroke="currentColor" strokeOpacity="0.15" />
        {bars.map((bar, i) => {
          const height = bar.value === 0 ? 0 : Math.max(6, (bar.value / max) * (h - 10));
          const x = i * step + step * 0.3;
          return (
            <g key={bar.day}>
              {height > 0 && <rect x={x} y={h - height} width={step * 0.4} height={height} fill="currentColor" fillOpacity={i === bars.length - 1 ? 1 : 0.22} />}
              {height === 0 && bar.worked && <circle cx={x + step * 0.2} cy={h - 4} r="3" fill="currentColor" fillOpacity={0.22} />}
            </g>
          );
        })}
      </svg>
      {/* 날짜는 SVG 밖 글자로 둡니다. SVG 안이면 패널이 좁을 때 함께 줄어 읽기 어려워져요. */}
      <div className="activity-axis" aria-hidden="true">
        {bars.map((bar, i) => (i === 0 || i === 6 || i === bars.length - 1) && <span key={bar.day} style={{ left: `${((i + 0.5) / bars.length) * 100}%` }}>{bar.day.slice(5).replace("-", "/")}</span>)}
      </div>
    </figure>
  );
}
