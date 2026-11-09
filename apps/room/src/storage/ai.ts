import { normalizeAi, type AiNote, type AiSettings } from "../domain/aiNote";
import { run } from "./db";

// AI 설정과 파일별 AI 메모. 저장소를 새로 만들지 않고 meta에 둬요(스키마 그대로). 방을 잊으면 db.forgetRoom이 메모도 지워요.
const noteKey = (room: string, thing: string) => `ai:${room}:${thing}`;

export async function getAiSettings(): Promise<AiSettings> {
  return normalizeAi(await run<unknown>("meta", "readonly", (store) => store.get("ai")));
}

export function saveAiSettings(ai: AiSettings): Promise<unknown> {
  return run("meta", "readwrite", (store) => store.put(ai, "ai"));
}

export async function getAiNote(room: string, thing: string): Promise<AiNote | null> {
  const note = await run<AiNote | undefined>("meta", "readonly", (store) => store.get(noteKey(room, thing)));
  return note && typeof note.summary === "string" ? note : null;
}

export function putAiNote(room: string, thing: string, note: AiNote): Promise<unknown> {
  return run("meta", "readwrite", (store) => store.put(note, noteKey(room, thing)));
}
