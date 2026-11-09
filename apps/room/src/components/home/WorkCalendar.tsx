import { useMemo } from "react";
import { localDay } from "../../domain/care";
import type { Room } from "../../domain/model";
import { formatWork, workAmount, yearMonths, yearWork, type WorkLog } from "../../domain/worklog";

const roomsShown = 3;

// 메인 화면 구석의 일력 한 장. 모든 작업을 올해 하나로 모읍니다. 한 줄이 한 달, 점 하나가 하루예요.
export function WorkCalendar({ rooms, log, now }: { rooms: Room[]; log: WorkLog; now: number }) {
  const today = localDay(now);
  const year = new Date(now).getFullYear();
  const work = useMemo(() => yearWork(log, year), [log, year]);
  const months = useMemo(() => yearMonths(year), [year]);
  const amount = workAmount(work.totalMs);
  const names = new Map(rooms.map((room) => [room.id, room.name]));
  const lines = work.rooms.filter(([id]) => names.has(id)).slice(0, roomsShown);
  return (
    <section className="work-cal" aria-label="올해 작업 시간">
      <p className="work-cal-total">
        <strong>{amount.value}</strong>
        <span>{amount.unit}</span>
        {work.days.size > 0 && <small>{work.days.size}일 작업</small>}
      </p>
      <div className="work-cal-days" role="img" aria-label={`${year}년 ${work.days.size}일 작업`}>
        {months.map((days, month) => (
          <div key={month}>
            {days.map((day, at) => {
              const ms = work.days.get(day);
              return <i key={day} className={ms ? "on" : day < today ? "past" : undefined} title={ms ? `${month + 1}월 ${at + 1}일, ${formatWork(ms)}` : undefined} />;
            })}
          </div>
        ))}
      </div>
      <p className="work-cal-rooms">{lines.length > 0 ? lines.map(([id, ms]) => `${names.get(id)} ${formatWork(ms)}`).join(", ") : "플로팅 창에서 작업을 시작하면 쌓여요."}</p>
    </section>
  );
}
