import { useEffect, useRef, useState, type FormEvent } from "react";
import { aiReady, defaultAi, type AiSettings } from "../domain/aiNote";
import { localDay } from "../domain/care";
import type { Room } from "../domain/model";
import { currentPeriod, hasWork, noteMaxLength, periodLabel, periodWork, reportInput, shiftPeriod, withReport, type Period, type ReportEvery, type WorkNote, type WorkReport } from "../domain/workReport";
import { formatWork, type WorkLog } from "../domain/worklog";
import { AiError, reportWork } from "../gateways/claude";
import { isNative } from "../gateways/native";
import { getAiSettings } from "../storage/ai";
import { getWorkLog } from "../storage/db";
import { getReportEvery, getWorkNotes, getWorkReports, saveWorkNotes, saveWorkReports } from "../storage/workReport";
import { useModal } from "./useModal";
import { Icon } from "./Icon";

const roomNames = (rooms: Room[]) => new Map(rooms.map((room) => [room.id, room.name]));

// 기간 하나의 보고를 Claude에게 받아 저장해요. 그 기간에 기록이 없으면 보내지 않고 null이에요.
export async function createReport(apiKey: string, period: Period, rooms: Room[]): Promise<WorkReport | null> {
  const [log, notes] = await Promise.all([getWorkLog(), getWorkNotes()]);
  const names = roomNames(rooms);
  const work = periodWork(log, notes, period, names);
  if (!hasWork(work)) return null;
  const { text, model } = await reportWork(apiKey, reportInput(period, work, names));
  const report: WorkReport = { ...period, text, at: Date.now(), model };
  await saveWorkReports(withReport(await getWorkReports(), report));
  return report;
}

function Bars({ title, rows }: { title: string; rows: [string, number][] }) {
  if (rows.length === 0) return null;
  const max = rows[0][1];
  return (
    <section className="report-bars" aria-label={title}>
      <h3>{title}</h3>
      <ul>
        {rows.map(([name, ms]) => (
          <li key={name}>
            <span className="report-bar-name">{name}</span>
            <span className="report-bar-time">{formatWork(ms)}</span>
            <i style={{ inlineSize: `${Math.max(2, (ms / max) * 100)}%` }} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// 작업 보고 창. 고른 주기(끈 상태면 주) 단위로 앞뒤 기간을 넘겨 봐요. 시간은 이 기기의 기록에서 바로 세고, Claude 정리는 AI를 켰을 때만 받아요.
export function WorkReportDialog({ rooms, now, start, onClose }: { rooms: Room[]; now: number; start?: Period; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pressedOutside = useRef(false);
  useModal(dialog);
  // 연 순간의 값으로 한 번만 읽어요. now는 1분마다 바뀌어도 고른 기간을 되돌리지 않아요.
  const [opened] = useState(() => ({ now, start }));
  const [every, setEvery] = useState<ReportEvery>("off");
  const [period, setPeriod] = useState<Period>(() => start ?? currentPeriod("week", now));
  const [log, setLog] = useState<WorkLog>({});
  const [notes, setNotes] = useState<WorkNote[]>([]);
  const [reports, setReports] = useState<WorkReport[]>([]);
  const [ai, setAi] = useState<AiSettings>(defaultAi);
  const [text, setText] = useState("");
  const [noteRoom, setNoteRoom] = useState("");
  const [state, setState] = useState<{ status: "idle" | "busy" } | { status: "error"; message: string }>({ status: "idle" });

  useEffect(() => {
    void (async () => {
      try {
        const [savedEvery, savedLog, savedNotes, savedReports, savedAi] = await Promise.all([getReportEvery(), getWorkLog(), getWorkNotes(), getWorkReports(), getAiSettings()]);
        setEvery(savedEvery);
        if (!opened.start && savedEvery !== "off") setPeriod(currentPeriod(savedEvery, opened.now));
        setLog(savedLog);
        setNotes(savedNotes);
        setReports(savedReports);
        setAi(savedAi);
      } catch (error) {
        console.error(error);
        setState({ status: "error", message: "기록을 읽지 못했어요. 잠시 뒤 다시 해 주세요." });
      }
    })();
  }, [opened]);

  const unit = every === "off" ? "week" : every;
  const names = roomNames(rooms);
  const work = periodWork(log, notes, period, names);
  const report = reports.find((item) => item.from === period.from && item.to === period.to);
  const today = localDay(now);
  const holdsToday = today >= period.from && today <= period.to;
  const busy = state.status === "busy";
  const canAsk = isNative() && aiReady(ai);

  function go(step: -1 | 1) {
    setPeriod(shiftPeriod(unit, period, step));
    setState({ status: "idle" });
  }

  async function changeNotes(next: WorkNote[]) {
    const before = notes;
    setNotes(next);
    try {
      await saveWorkNotes(next);
    } catch (error) {
      console.error(error);
      setNotes(before);
      setState({ status: "error", message: "저장하지 못했어요. 잠시 뒤 다시 해 주세요." });
    }
  }

  function addNote(event: FormEvent) {
    event.preventDefault();
    const line = text.trim().slice(0, noteMaxLength);
    if (!line) return;
    setText("");
    void changeNotes([...notes, { id: crypto.randomUUID(), day: today, roomId: noteRoom || null, text: line, at: Date.now() }]);
  }

  async function ask() {
    if (busy) return;
    setState({ status: "busy" });
    try {
      const made = await createReport(ai.apiKey, period, rooms);
      if (!made) {
        setState({ status: "error", message: "이 기간엔 기록이 없어요." });
        return;
      }
      setReports((list) => withReport(list, made));
      setState({ status: "idle" });
    } catch (error) {
      console.error(error);
      setState({ status: "error", message: error instanceof AiError ? error.message : "보고를 저장하지 못했어요. 잠시 뒤 다시 해 주세요." });
    }
  }

  return (
    <dialog
      ref={dialog}
      className="sheet report"
      aria-labelledby="report-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onPointerDown={(event) => {
        pressedOutside.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedOutside.current && event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet-body">
        <header className="menu-head">
          <h2 id="report-title">작업 보고</h2>
          <button type="button" className="quiet icon-close" aria-label="닫기" onClick={onClose}><Icon name="close" /></button>
        </header>
        <nav className="report-period" aria-label="기간">
          <button type="button" className="quiet" aria-label="앞 기간" onClick={() => go(-1)}>‹</button>
          <strong>{periodLabel(period)}</strong>
          <button type="button" className="quiet" aria-label="뒤 기간" disabled={holdsToday} onClick={() => go(1)}>›</button>
        </nav>
        <p className="report-total">
          <strong>{work.totalMs > 0 ? formatWork(work.totalMs) : "0분"}</strong>
          <small>{work.days.length > 0 ? `${work.days.length}일 작업` : "작업 기록이 없어요"}</small>
        </p>
        <Bars title="방별" rows={work.rooms} />

        <section className="report-notes" aria-labelledby="report-notes-title">
          <h3 id="report-notes-title">한 일</h3>
          {work.notes.length > 0 && (
            <ul>
              {work.notes.map((note) => (
                <li key={note.id}>
                  <span>
                    {note.text}
                    <small>{periodLabel({ from: note.day, to: note.day })}{note.roomId && `, ${names.get(note.roomId) ?? "지운 방"}`}</small>
                  </span>
                  <button type="button" className="quiet" aria-label={`${note.text} 빼기`} onClick={() => void changeNotes(notes.filter((item) => item.id !== note.id))}>빼기</button>
                </li>
              ))}
            </ul>
          )}
          {holdsToday ? (
            <form className="report-note-form" onSubmit={addNote}>
              <input value={text} maxLength={noteMaxLength} placeholder="오늘 한 일을 한 줄로 적어요" aria-label="오늘 한 일" onChange={(event) => setText(event.target.value)} />
              <select value={noteRoom} aria-label="방" onChange={(event) => setNoteRoom(event.target.value)}>
                <option value="">방 없이</option>
                {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
              </select>
              <button type="submit" disabled={!text.trim()}>적기</button>
            </form>
          ) : (
            work.notes.length === 0 && <p className="soft">적어 둔 일이 없어요.</p>
          )}
        </section>

        <section className="report-ai" aria-labelledby="report-ai-title" aria-busy={busy}>
          <h3 id="report-ai-title">AI 정리</h3>
          {report && <p className="report-text">{report.text}</p>}
          {report && <p className="soft">{new Date(report.at).toLocaleDateString("ko-KR")}에 정리했어요.</p>}
          {canAsk ? (
            <>
              {!report && <p className="soft">기간, 방 이름과 시간, 적은 한 일만 Anthropic에 보내요. 파일은 보내지 않아요.</p>}
              <button type="button" aria-disabled={busy} onClick={() => void ask()}>{busy ? "정리하는 중…" : report ? "다시 정리" : "AI로 정리하기"}</button>
            </>
          ) : (
            !report && <p className="soft">{isNative() ? "환경설정에서 AI 요약을 켜고 키를 넣으면 Claude가 정리해 줘요." : "AI 정리는 데스크톱 앱에서 쓸 수 있어요."}</p>
          )}
          <p role="status" className="ai-status">{state.status === "error" ? state.message : ""}</p>
        </section>
      </div>
    </dialog>
  );
}
