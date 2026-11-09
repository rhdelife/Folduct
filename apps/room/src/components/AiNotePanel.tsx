import { useEffect, useState } from "react";
import { aiNoteStale, aiReady, aiReadPlan, defaultAi, neighborsOf, readLabels, type AiNote, type AiSettings } from "../domain/aiNote";
import type { Room, Thing } from "../domain/model";
import { AiError, summarize } from "../gateways/claude";
import { readFolderFile, type Folder } from "../gateways/native";
import { getAiNote, getAiSettings, putAiNote } from "../storage/ai";
import { PictureError } from "../storage/pictures";

// 환경설정에서 AI 설정을 바꾸면 열린 패널이 따라오게 알리는 이름.
export const aiSettingsChanged = "folduct-ai-settings";

// 파일 상세 아래 AI 요약·판단. 켜 두고 누를 때만 이 파일 하나를 Anthropic에 보내요. 받은 메모는 이 기기에만 두고, 파일이 바뀌면 다시 요약하라고 알려요.
export function AiNotePanel({ room, thing, folder }: { room: Room; thing: Thing; folder: Folder | null }) {
  const [ai, setAi] = useState<AiSettings>(defaultAi);
  const [note, setNote] = useState<AiNote | null>(null);
  const [state, setState] = useState<{ status: "idle" | "busy" | "done" } | { status: "error"; message: string }>({ status: "idle" });

  useEffect(() => {
    const read = () => getAiSettings().then(setAi, (error: unknown) => console.error(error));
    void read();
    window.addEventListener(aiSettingsChanged, read);
    return () => window.removeEventListener(aiSettingsChanged, read);
  }, []);

  useEffect(() => {
    let left = false;
    getAiNote(room.id, thing.id).then((saved) => !left && setNote(saved), (error: unknown) => console.error(error));
    return () => {
      left = true;
    };
  }, [room.id, thing.id]);

  if (!ai.on) return null;
  if (!aiReady(ai)) return <p className="ai-hint">AI 요약을 쓰려면 환경설정에 Anthropic API 키를 넣어 주세요.</p>;

  // 폴더를 읽을 수 없으면(샘플 방·권한 없음) 이름·위치로만 판단해요.
  const plan = folder ? aiReadPlan(thing) : "none";
  const busy = state.status === "busy";

  async function ask() {
    if (busy) return;
    setState({ status: "busy" });
    let next: AiNote;
    try {
      const file = plan === "none" || !folder ? null : await readFolderFile(folder, thing.path);
      next = await summarize(ai.apiKey, thing, neighborsOf(thing, room.things), file, plan);
    } catch (error) {
      console.error(error);
      setState({ status: "error", message: error instanceof AiError || error instanceof PictureError ? error.message : "파일을 읽지 못했어요. 폴더 권한을 확인해 주세요." });
      return;
    }
    // 받은 요약은 먼저 보여 주고, 저장은 실패해도 화면의 요약은 그대로 둬요(다음에 다시 요약해야 할 뿐이에요).
    setNote(next);
    setState({ status: "done" });
    putAiNote(room.id, thing.id, next).catch((error: unknown) => console.error(error));
  }

  return (
    <section className="ai-note" aria-labelledby={`ai-${thing.id}`} aria-busy={busy}>
      <h3 id={`ai-${thing.id}`}>AI 요약</h3>
      {note ? (
        <>
          <p className="ai-summary">{note.summary}</p>
          <dl className="ai-judge">
            <div><dt>역할</dt><dd>{note.role}</dd></div>
            <div><dt>제안</dt><dd>{note.advice}</dd></div>
          </dl>
          <p className="ai-reason">{note.reason}</p>
          <p className="ai-meta">{readLabels[note.read]} {new Date(note.at).toLocaleDateString("ko-KR")}{aiNoteStale(note, thing) && " · 그 뒤로 파일이 바뀌었어요."}</p>
        </>
      ) : (
        <p className="ai-meta">{plan === "none" ? "파일 이름·위치·크기와 같은 폴더의 다른 파일 이름(40개까지)만 Anthropic에 보내요." : "이 파일 내용과 이름·위치, 같은 폴더의 다른 파일 이름(40개까지)을 Anthropic에 보내 요약을 받아요."}</p>
      )}
      {/* 상태 줄은 비어 있어도 늘 붙어 있어야 화면 읽기 프로그램이 바뀐 내용을 읽어 줘요. */}
      <p role="status" className="ai-status">{busy ? "요약하는 중이에요…" : state.status === "error" ? state.message : state.status === "done" ? "요약했어요." : ""}</p>
      {/* 누르는 동안 포커스를 잃지 않게 disabled 대신 aria-disabled를 써요. */}
      <button type="button" aria-disabled={busy} onClick={() => void ask()}>{note ? "다시 요약" : "AI로 요약하기"}</button>
    </section>
  );
}
