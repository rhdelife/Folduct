import Anthropic from "@anthropic-ai/sdk";
import { aiContext, aiLimits, aiNoteSchema, aiSystem, parseAiNote, type AiNote, type AiRead } from "../domain/aiNote";
import { reportSystem } from "../domain/workReport";
import type { Thing } from "../domain/model";
import { shrink } from "../storage/pictures";

// 파일 하나를 Claude에 보여 주고 요약·판단을 받아요. 사용자가 켜고 파일마다 눌렀을 때만 불러요.
// 키는 사용자가 환경설정에 넣은 자기 키예요. 데스크톱 앱(CSP가 api.anthropic.com만 열어 둔 웹뷰)에서만 부르고, 웹 빌드에는 이 기능을 보이지 않아요.
// 그래서 dangerouslyAllowBrowser를 켜요.
export const aiModel = "claude-opus-5-5";

export class AiError extends Error {}

const toBase64 = (bytes: ArrayBuffer): string => {
  let binary = "";
  const view = new Uint8Array(bytes);
  for (let at = 0; at < view.length; at += 0x8000) binary += String.fromCharCode(...view.subarray(at, at + 0x8000));
  return btoa(binary);
};

type Content = Anthropic.Beta.Messages.BetaContentBlockParam;

// 읽은 파일을 보낼 내용 블록으로. 텍스트가 길면 앞부분만 보내고 read를 text-head로 바꿔요(화면에도 그렇게 써요).
async function contentOf(file: File | null, plan: AiRead): Promise<{ blocks: Content[]; read: AiRead }> {
  if (!file || plan === "none") return { blocks: [], read: "none" };
  if (plan === "pdf") return { blocks: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: toBase64(await file.arrayBuffer()) } }], read: "pdf" };
  if (plan === "image") {
    const picture = await shrink(file, 1024);
    return { blocks: [{ type: "image", source: { type: "base64", media_type: picture.type === "image/jpeg" ? "image/jpeg" : "image/png", data: toBase64(picture.bytes) } }], read: "image" };
  }
  const head = file.size > aiLimits.textBytes;
  const text = decodeText(await (head ? file.slice(0, aiLimits.textBytes) : file).arrayBuffer(), head);
  return { blocks: [{ type: "text", text: `<file>\n${text}\n</file>` }], read: head ? "text-head" : "text" };
}

// UTF-8로 읽고, 아니면 한국어 옛 인코딩(EUC-KR·CP949)으로 읽어요. 앞부분만 자른 경우 끝에 걸친 반쪽 글자는 버려요(stream).
export function decodeText(bytes: ArrayBuffer, cut: boolean): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: cut });
  } catch {
    return new TextDecoder("euc-kr").decode(bytes, { stream: cut });
  }
}

export async function summarize(apiKey: string, thing: Thing, neighbors: string[], file: File | null, plan: AiRead): Promise<AiNote> {
  const { blocks, read } = await contentOf(file, plan);
  // 요약 하나라 오래 걸릴 일이 없어요. 90초를 넘기면 늦는다고 알려요.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 90_000 });
  let response: Anthropic.Beta.Messages.BetaMessage;
  try {
    response = await client.beta.messages.create({
      model: aiModel,
      // 답은 짧은 JSON 하나예요(낮은 노력의 생각 포함해도 넉넉해요).
      max_tokens: 4000,
      // 요약은 깊은 추론이 필요 없어 노력을 낮춰요. 정책 거절이면 서버가 알맞은 모델로 다시 돌려요.
      output_config: { effort: "low", format: { type: "json_schema", schema: aiNoteSchema } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: aiSystem,
      messages: [{ role: "user", content: [...blocks, { type: "text", text: aiContext(thing, neighbors, read) }] }],
    });
  } catch (error) {
    throw failure(error);
  }
  if (response.stop_reason === "refusal") throw new AiError("이 파일은 요약하지 못했어요.");
  const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  const parsed = parseAiNote(text);
  if (!parsed) throw new AiError("요약을 읽지 못했어요. 다시 해 주세요.");
  return { ...parsed, read, size: thing.size, lastModified: thing.lastModified, at: Date.now(), model: response.model };
}

// 작업 보고. 기간·방 이름과 분·날마다의 분·적어 둔 줄(reportInput)만 보내요.
export async function reportWork(apiKey: string, input: string): Promise<{ text: string; model: string }> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 90_000 });
  let response: Anthropic.Beta.Messages.BetaMessage;
  try {
    response = await client.beta.messages.create({
      model: aiModel,
      max_tokens: 2000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: reportSystem,
      messages: [{ role: "user", content: input }],
    });
  } catch (error) {
    throw failure(error);
  }
  const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("").trim();
  if (response.stop_reason === "refusal" || !text) throw new AiError("보고를 만들지 못했어요. 다시 해 주세요.");
  return { text, model: response.model };
}

// SDK 오류를 화면에 보일 말로 바꿔요. 모르는 오류는 그대로 돌려줘요.
function failure(error: unknown): unknown {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return new AiError("API 키를 확인해 주세요. 환경설정에서 바꿀 수 있어요.");
  if (error instanceof Anthropic.APIError && (error.type === "billing_error" || /credit balance/i.test(error.message))) return new AiError("API 크레딧이 부족해요. Anthropic 콘솔에서 확인해 주세요.");
  if (error instanceof Anthropic.RateLimitError) return new AiError("요청이 많아요. 잠시 뒤 다시 해 주세요.");
  if (error instanceof Anthropic.BadRequestError || (error instanceof Anthropic.APIError && error.status === 413)) return new AiError("이 파일은 보낼 수 없어요.");
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new AiError("응답이 늦어요. 잠시 뒤 다시 해 주세요.");
  if (error instanceof Anthropic.APIConnectionError) return new AiError("인터넷 연결을 확인해 주세요.");
  if (error instanceof Anthropic.APIError) return new AiError("AI가 지금 답하지 못했어요. 잠시 뒤 다시 해 주세요.");
  return error;
}
