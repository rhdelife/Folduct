import { useMemo, useState, type CSSProperties, type PointerEvent } from "react";
import type { Room } from "../../domain/model";
import { buckets, periods, periodTotal, recentDays, roomTotals, streak, weekdayAverage, type Bucket, type Period } from "../../domain/trends";
import { formatWork, type WorkLog } from "../../domain/worklog";

const weekdays = ["월", "화", "수", "목", "금", "토", "일"];
const work = (ms: number) => (ms > 0 ? formatWork(ms) : "0분");
const roomsShown = 6;

// 홈 '추세' 판의 몸: 기간 고르기 아래 카드 넷(연속 작업, 작업 시간 그래프, 요일별 평균, 방별 시간).
// 색은 파일 형식 몫이라 그래프는 잉크 한 가지로만 그려요. 계열이 하나라 범례는 두지 않아요.
export function TrendPanel({ log, rooms, now }: { log: WorkLog; rooms: Room[]; now: number }) {
  const [period, setPeriod] = useState<Period>("week");
  const days = useMemo(() => recentDays(log, now), [log, now]);
  const run = useMemo(() => streak(log, now), [log, now]);
  const series = useMemo(() => buckets(log, period, now), [log, period, now]);
  const total = useMemo(() => periodTotal(log, period, now), [log, period, now]);
  const week = useMemo(() => weekdayAverage(log, period, now), [log, period, now]);
  const byRoom = useMemo(() => roomTotals(log, period, now), [log, period, now]);
  const names = new Map(rooms.map((room) => [room.id, room.name]));
  if (Object.keys(log).length === 0) return <p className="trend-empty">플로팅 창에서 작업을 시작하면 여기에 쌓여요.</p>;
  const topRoom = byRoom[0]?.[1] ?? 0;
  const topDay = Math.max(...week.byWeekday, 1);
  return (
    <div className="trend">
      <div className="seg trend-periods" role="radiogroup" aria-label="기간">
        {periods.map(({ value, label }) => (
          <label key={value}>
            <input type="radio" name="trend-period" checked={period === value} onChange={() => setPeriod(value)} />
            {label}
          </label>
        ))}
      </div>
      <section className="trend-card" aria-labelledby="trend-streak">
        <h3 id="trend-streak">연속 작업</h3>
        <p className="trend-number">{run > 0 ? <>{run}<small>일</small></> : <small>오늘 시작해 보세요</small>}</p>
        <ol className="trend-days" aria-label={`최근 ${days.length}일 중 ${days.filter(Boolean).length}일 작업`}>
          {days.map((on, at) => <li key={at} data-on={on || undefined} />)}
        </ol>
      </section>
      <section className="trend-card" aria-labelledby="trend-time">
        <h3 id="trend-time">작업 시간</h3>
        <p className="trend-number">{work(total)}</p>
        <LineChart series={series} />
      </section>
      <section className="trend-card" aria-labelledby="trend-week">
        <h3 id="trend-week">요일별 평균</h3>
        <p className="trend-number">{work(week.average)}</p>
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
                <span className="trend-room-bar" style={{ "--share": ms / topRoom } as CSSProperties} aria-hidden="true" />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// 칸마다 점을 잇는 선과 그 아래 옅은 면. 가리키면 가장 가까운 칸에 세로선과 말풍선이 붙어요.
function LineChart({ series }: { series: Bucket[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const top = Math.max(...series.map((bucket) => bucket.ms), 1);
  const x = (at: number) => (series.length < 2 ? 50 : (at / (series.length - 1)) * 100);
  const y = (ms: number) => 100 - (ms / top) * 92;
  const line = series.map((bucket, at) => `${x(at)},${y(bucket.ms)}`).join(" ");
  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setHover(Math.min(series.length - 1, Math.max(0, Math.round(((event.clientX - box.left) / box.width) * (series.length - 1)))));
  };
  const shown = hover === null ? null : series[hover];
  const peak = series.reduce((best, bucket) => (bucket.ms > best.ms ? bucket : best), series[0]);
  return (
    <div className="trend-chart" onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={peak && peak.ms > 0 ? `가장 많이 한 때 ${peak.label}, ${work(peak.ms)}` : "기록이 없어요"}>
        {series.length > 1 && <polygon className="trend-area" points={`0,100 ${line} 100,100`} />}
        <polyline className="trend-line" points={line} />
        {shown && hover !== null && <line className="trend-cross" x1={x(hover)} x2={x(hover)} y1={0} y2={100} />}
      </svg>
      {/* 점은 늘어나지 않게 HTML로 얹어요. 칸이 하나뿐이면 선 대신 점 하나예요. */}
      {(series.length === 1 || (shown && hover !== null)) && <span className="trend-dot" aria-hidden="true" style={{ left: `${x(hover ?? 0)}%`, top: `${y((shown ?? series[0]).ms)}%` }} />}
      {shown && hover !== null && (
        <p className="trend-tip" aria-hidden="true" style={{ left: `${Math.min(80, Math.max(20, x(hover)))}%` }}>
          <small>{shown.label}</small>
          <strong>{work(shown.ms)}</strong>
        </p>
      )}
    </div>
  );
}
