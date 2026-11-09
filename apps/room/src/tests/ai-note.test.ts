import { afterEach, describe, expect, it, vi } from "vitest";
import { aiAdvice, aiContext, aiLimits, aiNoteSchema, aiNoteStale, aiReadPlan, aiReady, aiRoles, neighborsOf, normalizeAi, parseAiNote } from "../domain/aiNote";
import { kindOf, type Thing } from "../domain/model";
import { AiError, decodeText, summarize } from "../gateways/claude";

const thing = (path: string, patch: Partial<Thing> = {}): Thing => {
  const name = path.split("/").pop()!;
  return { id: path, path, name, kind: kindOf(name), size: 1000, lastModified: Date.UTC(2026, 10, 1), lastUsedAt: null, missing: false, spot: null, note: "", touchedAt: null, seenAt: 0, pinned: false, box: null, ...patch };
};

describe("AI 메모: 무엇을 읽어 보낼지", () => {
  it("PDF·그릴 수 있는 이미지·텍스트는 내용을, 나머지는 이름만 보내요", () => {
    expect(aiReadPlan(thing("output/pdf/RT4_강의노트.pdf"))).toBe("pdf");
    expect(aiReadPlan(thing("포스터.png"))).toBe("image");
    expect(aiReadPlan(thing("포스터.psd"))).toBe("none");
    expect(aiReadPlan(thing("raw/IMG_1.CR2"))).toBe("none");
    expect(aiReadPlan(thing("notes/RT5.md"))).toBe("text");
    expect(aiReadPlan(thing("data/table.csv"))).toBe("text");
    expect(aiReadPlan(thing("발표.pptx"))).toBe("none");
    expect(aiReadPlan(thing("큰메모.txt", { size: aiLimits.textBytes + 1 }))).toBe("text-head");
    expect(aiReadPlan(thing("큰.pdf", { size: aiLimits.pdfBytes + 1 }))).toBe("none");
    expect(aiReadPlan(thing("없는.pdf", { missing: true }))).toBe("none");
    // PDF는 base64 뒤 32MB 요청 한도에 들게 20MB까지, 텍스트는 통째로 읽어야 하니 20MB까지만 읽어요.
    expect(aiReadPlan(thing("21MB.pdf", { size: 21 * 1024 ** 2 }))).toBe("none");
    expect(aiReadPlan(thing("huge.log", { size: aiLimits.textFileBytes + 1 }))).toBe("none");
  });

  it("이웃은 같은 폴더의 다른 파일이고, 상자·없는 파일은 빼요", () => {
    const things = [thing("a/x.pdf"), thing("a/y.pdf"), thing("a/b/z.pdf"), thing("a/old.pdf", { missing: true }), thing("a/boxed.pdf", { box: { state: "boxed", fromPath: "a/boxed.pdf", boxPath: "_Folduct 정리상자/a/boxed.pdf", at: 0 } })];
    expect(neighborsOf(things[0], things)).toEqual(["y.pdf"]);
  });

  it("보내는 설명에 이름·경로·이웃과, 내용을 보냈는지가 들어가요", () => {
    const text = aiContext(thing("a/x.pdf"), Array.from({ length: 50 }, (_, at) => `n${at}.png`), "none");
    expect(text).toContain("파일 이름: x.pdf");
    expect(text).toContain("방 안 경로: a/x.pdf");
    expect(text).toContain("50개, 앞의 40개만");
    expect(text).toContain("파일 내용은 보내지 않았어요.");
  });
});

describe("AI 메모: 받은 답", () => {
  it("스키마는 모든 칸이 필요하고 다른 칸을 받지 않아요", () => {
    expect(aiNoteSchema.additionalProperties).toBe(false);
    expect([...aiNoteSchema.required].sort()).toEqual(["advice", "reason", "role", "summary"]);
    expect(aiNoteSchema.properties.role.enum).toEqual([...aiRoles]);
    expect(aiNoteSchema.properties.advice.enum).toEqual([...aiAdvice]);
  });

  it("모양이 맞는 JSON만 받아요", () => {
    expect(parseAiNote('{"summary":" 요약이에요. ","role":"결과물","advice":"계속 두세요","reason":"최종본이에요."}')).toEqual({ summary: "요약이에요.", role: "결과물", advice: "계속 두세요", reason: "최종본이에요." });
    expect(parseAiNote('{"summary":"a","role":"최종","advice":"계속 두세요","reason":"b"}')).toBeNull();
    expect(parseAiNote("요약이에요")).toBeNull();
    expect(parseAiNote("null")).toBeNull();
  });

  it("파일 크기나 고친 시각이 바뀌면 메모가 묵었어요", () => {
    const note = { size: 10, lastModified: 5 };
    expect(aiNoteStale(note, { size: 10, lastModified: 5 })).toBe(false);
    expect(aiNoteStale(note, { size: 11, lastModified: 5 })).toBe(true);
    expect(aiNoteStale(note, { size: 10, lastModified: 6 })).toBe(true);
  });

  it("설정은 켜기와 키가 다 있어야 써요", () => {
    expect(normalizeAi(undefined)).toEqual({ on: false, apiKey: "" });
    expect(normalizeAi({ on: "yes", apiKey: 3 })).toEqual({ on: false, apiKey: "" });
    expect(aiReady(normalizeAi({ on: true, apiKey: " sk-ant-x " }))).toBe(true);
    expect(aiReady({ on: true, apiKey: "" })).toBe(false);
  });
});

describe("AI 메모: 글자 읽기", () => {
  it("UTF-8이 아니면 EUC-KR로 읽고, 앞부분만 자른 끝의 반쪽 글자는 버려요", () => {
    const euckr = new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb]); // "한글"
    expect(decodeText(euckr.buffer, false)).toBe("한글");
    const utf8 = new TextEncoder().encode("가나");
    expect(decodeText(utf8.slice(0, 4).buffer, true)).toBe("가");
    expect(decodeText(utf8.buffer, false)).toBe("가나");
  });
});

describe("AI 메모: Claude 부르기(가짜 서버)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const reply = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "request-id": "req_test" } }));

  it("JSON 형식·낮은 노력·서버 대체 모델을 걸어 보내고, 답을 메모로 바꿔요", async () => {
    const fetch = reply({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: "text", text: '{"summary":"강의노트예요.","role":"결과물","advice":"계속 두세요","reason":"시험 대비 최종본이에요."}' }] });
    vi.stubGlobal("fetch", fetch);
    const file = new File(["# RT5 시험 대비"], "RT5.md", { type: "text/markdown" });
    const note = await summarize("sk-ant-test", thing("notes/RT5.md"), ["RT6.md"], file, "text");
    expect(note).toMatchObject({ summary: "강의노트예요.", role: "결과물", advice: "계속 두세요", read: "text", size: 1000, model: "claude-opus-5-5" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("/v1/messages");
    const headers = new Headers(init.headers);
    // SDK 1.x는 키를 authorization 헤더로 보내요(0.x는 x-api-key).
    expect(headers.get("authorization") ?? headers.get("x-api-key")).toContain("sk-ant-test");
    expect(headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", output_config: { effort: "low", format: { type: "json_schema" } } });
    expect(body.messages[0].content[0].text).toContain("# RT5 시험 대비");
    expect(body.messages[0].content[1].text).toContain("방 안 경로: notes/RT5.md");
  });

  it("거절·잘못된 키는 해요체 안내로 바꿔요", async () => {
    vi.stubGlobal("fetch", reply({ id: "msg_2", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "refusal", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 }, content: [] }));
    await expect(summarize("sk-ant-test", thing("a.md"), [], null, "none")).rejects.toThrow(new AiError("이 파일은 요약하지 못했어요."));
    vi.stubGlobal("fetch", reply({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, 401));
    await expect(summarize("bad", thing("a.md"), [], null, "none")).rejects.toThrow("API 키를 확인해 주세요");
    vi.stubGlobal("fetch", reply({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }, 400));
    await expect(summarize("sk-ant-test", thing("a.md"), [], null, "none")).rejects.toThrow("API 크레딧이 부족해요");
  });
});
