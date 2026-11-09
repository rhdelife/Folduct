import { kindLabels, type Kind, type Thing } from "./model";

// AI 메모: 파일 하나를 Claude에 보여 주고 받은 짧은 요약과 판단. 사용자가 켜고, 파일마다 눌렀을 때만 만들어요.
// 파일은 읽기만 하고, 판단은 화면에 보여 주기만 해요(옮기거나 지우지 않아요).

export const aiRoles = ["결과물", "작업 중", "자료", "중간 산물", "옛 버전", "알 수 없음"] as const;
export const aiAdvice = ["계속 두세요", "정리 상자로 보내도 돼요", "판단하기 어려워요"] as const;
export type AiRole = (typeof aiRoles)[number];
export type AiAdvice = (typeof aiAdvice)[number];

// 무엇을 읽어 보냈는지. none이면 이름·위치·크기만 보고 판단한 거예요.
export type AiRead = "text" | "text-head" | "pdf" | "image" | "none";

export type AiNote = {
  summary: string;
  role: AiRole;
  advice: AiAdvice;
  reason: string;
  read: AiRead;
  // 이 메모를 만들 때의 파일 상태. 파일이 바뀌면 다시 요약하라고 알려요.
  size: number;
  lastModified: number;
  at: number;
  model: string;
};

// 구조화 출력 스키마(output_config.format). 모든 객체는 additionalProperties: false여야 해요.
export const aiNoteSchema = {
  type: "object",
  properties: {
    summary: { type: "string", description: "파일 내용 요약. 한국어 해요체 2~3문장." },
    role: { type: "string", enum: [...aiRoles], description: "이 파일이 프로젝트에서 맡은 역할." },
    advice: { type: "string", enum: [...aiAdvice], description: "이 방에 계속 둘지에 대한 제안." },
    reason: { type: "string", description: "역할과 제안의 근거. 한국어 해요체 한 문장." },
  },
  required: ["summary", "role", "advice", "reason"],
  additionalProperties: false,
} as const;

// 읽어서 보낼 수 있는 크기. 텍스트가 textBytes를 넘으면 앞부분만(화면에 그렇다고 써요), PDF·이미지·아주 큰 텍스트는 이름으로만 판단해요.
// PDF는 base64로 약 1.37배가 되니 요청 한도 32MB 안에 들게 20MB까지만 보내요. 텍스트는 앞부분만 보내도 파일을 통째로 읽어야 해서 20MB에서 끊어요.
export const aiLimits = { textBytes: 200_000, textFileBytes: 20 * 1024 ** 2, pdfBytes: 20 * 1024 ** 2, imageBytes: 40 * 1024 ** 2 } as const;

const pdfOk = (thing: Pick<Thing, "kind" | "size">) => thing.kind === "pdf" && thing.size <= aiLimits.pdfBytes;
// 캔버스로 줄일 수 있는 형식만 그림으로 보내요. RAW·PSD 같은 건 이름으로만 봐요.
const imageOk = (thing: Pick<Thing, "kind" | "size" | "name">) => thing.kind === "image" && thing.size <= aiLimits.imageBytes && /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(thing.name);
// 텍스트로 읽어도 되는 파일(메모·코드·데이터). 형식표의 text와 csv·tsv예요.
const textOk = (thing: Pick<Thing, "kind" | "name" | "size">) => (thing.kind === "text" || /\.(csv|tsv)$/i.test(thing.name)) && thing.size <= aiLimits.textFileBytes;

// 이 파일에서 무엇을 읽어 보낼지. 실제로 읽은 뒤 텍스트가 길면 text-head가 돼요.
export function aiReadPlan(thing: Pick<Thing, "kind" | "size" | "name" | "missing">): AiRead {
  if (thing.missing) return "none";
  if (pdfOk(thing)) return "pdf";
  if (imageOk(thing)) return "image";
  if (textOk(thing)) return thing.size > aiLimits.textBytes ? "text-head" : "text";
  return "none";
}

export const readLabels: Record<AiRead, string> = {
  text: "내용을 읽고 판단했어요.",
  "text-head": `앞부분 ${Math.round(aiLimits.textBytes / 1000)}KB만 읽고 판단했어요.`,
  pdf: "PDF 내용을 읽고 판단했어요.",
  image: "이미지를 보고 판단했어요.",
  none: "내용은 읽지 못하고 이름·위치·크기로만 판단했어요.",
};

export const aiSystem = [
  "너는 작업 폴더 정리 앱 Folduct 안에서 파일 하나를 살펴보는 도우미야.",
  "사용자가 이 파일이 무엇인지 빨리 알아보고, 같은 폴더의 비슷한 파일들 사이에서 이 파일이 어떤 자리인지 판단하도록 도와.",
  "summary는 내용을 2~3문장으로 줄이고, 내용을 받지 못했으면 이름·위치·이웃 파일에서 추측할 수 있는 것만 말하고 추측이라고 밝혀.",
  "role은 결과물(남에게 내거나 최종으로 쓰는 것), 작업 중, 자료(참고·원본), 중간 산물(도구가 만든 렌더·캐시·빌드), 옛 버전(더 새 버전이 옆에 있음), 알 수 없음 중 하나.",
  "advice는 확실할 때만 정리 상자로 보내도 된다고 해. 결과물·원본·하나뿐인 자료는 계속 두라고 해. 애매하면 판단하기 어렵다고 해.",
  "모든 글은 한국어 해요체로 짧게 써.",
].join("\n");

// 파일 밖 정보: 이름·경로·형식·크기·날짜와 같은 폴더의 이웃 파일 이름(많으면 앞의 일부만, 그렇다고 적어요).
export function aiContext(thing: Pick<Thing, "name" | "path" | "kind" | "size" | "lastModified">, neighbors: string[], read: AiRead): string {
  const shown = neighbors.slice(0, 40);
  return [
    `파일 이름: ${thing.name}`,
    `방 안 경로: ${thing.path}`,
    `형식: ${kindLabels[thing.kind as Kind]}`,
    `크기: ${thing.size.toLocaleString("en-US")} bytes`,
    `고친 날: ${new Date(thing.lastModified).toISOString().slice(0, 10)}`,
    `같은 폴더의 다른 파일(${neighbors.length}개${neighbors.length > shown.length ? `, 앞의 ${shown.length}개만` : ""}): ${shown.join(", ") || "없음"}`,
    read === "none" ? "파일 내용은 보내지 않았어요." : read === "text-head" ? `파일이 길어서 앞부분 ${aiLimits.textBytes} bytes만 보냈어요.` : "파일 내용을 함께 보냈어요.",
  ].join("\n");
}

// 같은 폴더의 다른 파일 이름(상자에 든 것·없는 것 빼고).
export function neighborsOf(thing: Pick<Thing, "id" | "path">, things: Pick<Thing, "id" | "path" | "name" | "box" | "missing">[]): string[] {
  const folder = thing.path.slice(0, thing.path.lastIndexOf("/") + 1);
  return things.filter((other) => other.id !== thing.id && !other.box && !other.missing && other.path.slice(0, other.path.lastIndexOf("/") + 1) === folder).map((other) => other.name);
}

// 모델이 돌려준 JSON을 확인해요. 모양이 다르면 null(화면에는 '요약을 읽지 못했어요').
export function parseAiNote(text: string): Pick<AiNote, "summary" | "role" | "advice" | "reason"> | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const note = value as Record<string, unknown>;
  if (!note || typeof note.summary !== "string" || typeof note.reason !== "string") return null;
  if (!aiRoles.includes(note.role as AiRole) || !aiAdvice.includes(note.advice as AiAdvice)) return null;
  return { summary: note.summary.trim(), role: note.role as AiRole, advice: note.advice as AiAdvice, reason: note.reason.trim() };
}

// 메모를 만든 뒤 파일이 바뀌었는지.
export const aiNoteStale = (note: Pick<AiNote, "size" | "lastModified">, thing: Pick<Thing, "size" | "lastModified">): boolean => note.size !== thing.size || note.lastModified !== thing.lastModified;

// 설정: 켜기와 API 키. 키는 이 기기의 앱 저장소에만 두고, Anthropic 말고 어디로도 보내지 않아요.
export type AiSettings = { on: boolean; apiKey: string };
export const defaultAi: AiSettings = { on: false, apiKey: "" };
export function normalizeAi(value: unknown): AiSettings {
  const ai = value as Partial<AiSettings> | null | undefined;
  return { on: ai?.on === true, apiKey: typeof ai?.apiKey === "string" ? ai.apiKey.trim() : "" };
}
export const aiReady = (ai: AiSettings): boolean => ai.on && ai.apiKey.length > 0;
