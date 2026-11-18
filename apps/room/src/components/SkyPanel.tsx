import { useState } from "react";
import { shortPath } from "../domain/platform";
import { ductLength, kindParts } from "../art/duct";
import { RoomFaceArt } from "./RoomFace";
import { relativeDay } from "../domain/care";
import { formatBytes, type Room } from "../domain/model";
import { roomUsage } from "../domain/care";
import { homeActivity, type RoomStat } from "../domain/sky";
import { roomMenuTriggers, type OpenRoomMenu } from "./ContextMenu";
import { KindMix } from "./KindLegend";

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
