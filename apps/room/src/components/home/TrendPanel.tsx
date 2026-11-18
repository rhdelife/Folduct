import { useMemo, useState, type CSSProperties, type PointerEvent } from "react";
import { faceColorVar } from "../../domain/face";
import type { Room } from "../../domain/model";
import { buckets, periodTotal, roomTotals, weekdayAverage, type Bucket, type Period } from "../../domain/trends";
import { formatWorkShort, periodName, workParts, type WorkLog } from "../../domain/worklog";
import { isNative } from "../../gateways/native";

const weekdays = ["월", "화", "수", "목", "금", "토", "일"];
// 그래프 시간은 영어 단위 짧은 꼴(3h 42m)이에요. 큰 숫자는 단위를 작게 써요.
const work = formatWorkShort;
const BigWork = ({ ms }: { ms: number }) => <>{workParts(ms).map(({ n, u }) => <span key={u}>{n}<small>{u}</small></span>)}</>;
const roomsShown = 6;

// 홈 '작업 기록' 판의 추세: 이번 주(월~일) 카드 셋(작업 시간 그래프, 요일별 평균, 방별 시간).
// 합계·년·월 고르기는 뺐어요(2026-11-18 요청). 달마다 한 칸이라 기록이 한두 달이면 막대 하나에 방 색 줄만 남아 읽을 게 없었어요.
// 작업 시간 막대와 방별 막대는 방 얼굴 색(메뉴 막대 알약과 같은 색)으로 그려요. 방이 여럿이라 범례를 둬요. 요일별 평균은 잉크 한 가지예요.
export function TrendPanel({ log, rooms, now }: { log: WorkLog; rooms: Room[]; now: number }) {
  const period: Period = "week";
  const series = useMemo(() => buckets(log, period, now), [log, period, now]);
  const total = useMemo(() => periodTotal(log, period, now), [log, period, now]);
  const week = useMemo(() => weekdayAverage(log, period, now), [log, period, now]);
  const byRoom = useMemo(() => roomTotals(log, period, now), [log, period, now]);
  const names = new Map(rooms.map((room) => [room.id, room.name]));
  const roomColor = (id: string) => { const room = rooms.find((item) => item.id === id); return room ? faceColorVar(room.face.color) : "var(--line-strong)"; };
  if (Object.keys(log).length === 0) return <p className="trend-empty">{isNative() ? "플로팅 창에서 작업을 시작하면 여기에 쌓여요." : "작업 시간은 데스크톱 앱에서 재요."}</p>;
  const topRoom = byRoom[0]?.[1] ?? 0;
  const topDay = Math.max(...week.byWeekday, 1);
  return (
    <div className="trend">
      <section className="trend-card" aria-labelledby="trend-time">
        <h3 id="trend-time">작업 시간</h3>
        <p className="trend-number"><BigWork ms={total} /></p>
        <p className="trend-sub">{periodName("week", now)}</p>
        <BarChart series={series} rooms={rooms} />
      </section>
      <section className="trend-card" aria-labelledby="trend-week">
        <h3 id="trend-week">요일별 평균</h3>
        <p className="trend-number"><BigWork ms={week.average} /></p>
        <p className="trend-sub">작업한 날 하루 평균</p>
        <ol className="trend-bars">
          {week.byWeekday.map((ms, at) => (
            <li key={weekdays[at]} title={`${weekdays[at]}요일 평균 ${work(ms)}`} aria-label={`${weekdays[at]}요일 평균 ${work(ms)}`}>
              <span className="trend-bar" style={{ "--share": ms / topDay } as CSSProperties} />
              <small aria-hidden="true">{weekdays[at]}</small>
            </li>
          ))}
        </ol>
      </section>
      <section className="trend-card" aria-labelledby="trend-rooms">
        <h3 id="trend-rooms">방별 작업 시간</h3>
        {byRoom.length === 0 ? (
          <p className="trend-sub">이 기간에는 기록이 없어요.</p>
        ) : (
          <ul className="trend-rooms">
            {byRoom.slice(0, roomsShown).map(([id, ms]) => (
              <li key={id}>
                <span className="trend-room-name">{names.get(id) ?? "지운 방"}</span>
                <span className="trend-room-time">{work(ms)}</span>
                <span className="trend-room-bar" style={{ "--share": ms / topRoom, "--c": roomColor(id) } as CSSProperties} aria-hidden="true" />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// 칸마다 방 색(방 얼굴 색, 메뉴 막대 알약과 같은 색)으로 쌓은 막대. 가리키면 그 칸의 방별 시간이 말풍선으로 떠요.
function BarChart({ series, rooms }: { series: Bucket[]; rooms: Room[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const top = Math.max(...series.map((bucket) => bucket.ms), 1);
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const color = (id: string) => { const room = byId.get(id); return room ? faceColorVar(room.face.color) : "var(--line-strong)"; };
  const name = (id: string) => byId.get(id)?.name ?? "지운 방";
  // 칸마다 많이 한 방이 아래에 오게 쌓아요. 색 순서는 기간 전체에서 많이 한 방 순서로 맞춰요.
  const totals = new Map<string, number>();
  for (const bucket of series) for (const [id, ms] of Object.entries(bucket.rooms)) totals.set(id, (totals.get(id) ?? 0) + ms);
  const order = [...totals].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setHover(Math.min(series.length - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * series.length))));
  };
  const shown = hover === null ? null : series[hover];
  const peak = series.reduce((best, bucket) => (bucket.ms > best.ms ? bucket : best), series[0]);
  return (
    <>
      <div className="trend-chart trend-stack" role="img" aria-label={peak && peak.ms > 0 ? `가장 많이 한 때 ${peak.label}, ${work(peak.ms)}` : "기록이 없어요"} onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)}>
        {series.map((bucket, at) => (
          <span key={bucket.label} className={`trend-col${hover === at && bucket.ms > 0 ? " on" : ""}`} style={{ "--share": bucket.ms / top } as CSSProperties}>
            {order.filter((id) => bucket.rooms[id]).map((id) => (
              <i key={id} style={{ flexGrow: bucket.rooms[id], "--c": color(id) } as CSSProperties} />
            ))}
          </span>
        ))}
        {shown && hover !== null && shown.ms > 0 && (
          <p className="trend-tip" aria-hidden="true" style={{ left: `${Math.min(80, Math.max(20, ((hover + 0.5) / series.length) * 100))}%` }}>
            <small>{shown.label}</small>
            <strong>{work(shown.ms)}</strong>
            {order.filter((id) => shown.rooms[id]).slice(0, 4).map((id) => (
              <small key={id} className="trend-tip-room"><i style={{ "--c": color(id) } as CSSProperties} />{name(id)} {work(shown.rooms[id])}</small>
            ))}
          </p>
        )}
      </div>
      {order.length > 0 && (
        <ul className="trend-legend" aria-label="방 색">
          {order.slice(0, roomsShown).map((id) => (
            <li key={id}><i style={{ "--c": color(id) } as CSSProperties} />{name(id)}</li>
          ))}
        </ul>
      )}
    </>
  );
}
