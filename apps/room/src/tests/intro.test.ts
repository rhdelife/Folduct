/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import sheet from "../art/duct-eat.png?inline";
import { eatBoard, eatFrameCount } from "../art/duct";
import { eatKeyframes, eatTimeline, introMs, introPaperCount, introPapers, introThings } from "../domain/intro";
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

  it("주름관과 글자가 있는 가운데를 비우고 화면 안쪽에 놓아요", () => {
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

describe("파일을 먹는 스프라이트", () => {
  it("시간표는 모으는 시간과 같고, 있는 프레임만 쓰며, 서 있는 그림으로 끝난다", () => {
    expect(eatTimeline.reduce((sum, [, ms]) => sum + ms, 0)).toBe(introMs.gather);
    for (const [frame] of eatTimeline) expect(frame).toBeLessThan(eatFrameCount);
    expect(new Set(eatTimeline.map(([frame]) => frame)).size).toBe(eatFrameCount);
    expect(eatTimeline.at(-1)![0]).toBe(0);
  });

  it("키프레임은 칸 단위로 넘어가고 시작과 끝이 제자리다", () => {
    const keys = eatKeyframes(eatTimeline, eatFrameCount);
    expect(keys[0]).toMatchObject({ offset: 0, transform: "translateX(0%)" });
    expect(keys.at(-1)).toMatchObject({ offset: 1 });
    expect(keys.at(-1)!.transform).toBe("translateX(0%)");
    const offsets = keys.map((key) => key.offset as number);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });

  it("시트 파일이 프레임 수와 그림 칸 비율에 맞다", () => {
    const png = atob(sheet.split(",")[1]);
    const u32 = (at: number) => [0, 1, 2, 3].reduce((sum, i) => sum * 256 + png.charCodeAt(at + i), 0);
    const [width, height] = [u32(16), u32(20)];
    expect(width % eatFrameCount).toBe(0);
    expect((width / eatFrameCount) / height).toBeCloseTo(eatBoard.width / eatBoard.height, 2);
  });
});
