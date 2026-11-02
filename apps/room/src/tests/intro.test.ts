import { describe, expect, it } from "vitest";
import { introPaperCount, introPapers, introThings } from "../domain/intro";
import type { Kind, Room, Thing } from "../domain/model";
import { sampleRooms } from "../storage/sample";

const thing = (id: string, kind: Kind, extra: Partial<Thing> = {}) => ({ id, kind, name: `${id}.bin`, size: 1024 * 1024, ...extra }) as Thing;
const room = (things: Thing[]) => ({ things }) as Room;
const many = (count: number, kind: Kind = "image") => Array.from({ length: count }, (_, at) => thing(`${kind}-${at}`, kind));

describe("인트로 종이", () => {
  it("파일이 충분하면 내 파일을, 적거나 없으면 샘플을 보여 줘요", () => {
    const samples = sampleRooms(0);
    const sampleIds = samples.flatMap((item) => item.things).map((item) => item.id);
    expect(introThings([room(many(6))], samples).map((item) => item.id)).toEqual(many(6).map((item) => item.id));
    expect(introThings([room(many(5))], samples).map((item) => item.id)).toEqual(sampleIds);
    expect(introThings([], samples).map((item) => item.id)).toEqual(sampleIds);
  });

  it("사라진 파일은 세지 않아요", () => {
    const missing = many(6).map((item) => ({ ...item, missing: true }));
    const samples = sampleRooms(0);
    expect(introThings([room(missing)], samples).some((item) => item.missing)).toBe(false);
  });

  it("장수를 넘기지 않고, 많은 형식이 먼저 차지하지 않아요", () => {
    const papers = introPapers([...many(30, "image"), ...many(2, "video"), ...many(1, "audio")]);
    expect(papers).toHaveLength(introPaperCount);
    expect(new Set(papers.map((paper) => paper.kind))).toEqual(new Set(["image", "video", "audio"]));
    expect(papers.filter((paper) => paper.kind === "video")).toHaveLength(2);
  });

  it("파일이 장수보다 적어도 끝나요", () => {
    expect(introPapers(many(3))).toHaveLength(3);
    expect(introPapers([])).toEqual([]);
  });

  it("화병과 글자가 있는 가운데를 비우고 화면 안쪽에 놓아요", () => {
    for (const paper of introPapers([...many(8, "image"), ...many(8, "text")])) {
      expect(Math.abs(paper.x) >= 38 || Math.abs(paper.y) >= 35, `${paper.x}, ${paper.y}`).toBe(true);
      expect(Math.abs(paper.x)).toBeLessThanOrEqual(45);
      expect(Math.abs(paper.y)).toBeLessThanOrEqual(42);
    }
  });

  it("같은 파일은 언제나 같은 자리예요", () => {
    expect(introPapers(many(8))).toEqual(introPapers(many(8)));
  });
});
