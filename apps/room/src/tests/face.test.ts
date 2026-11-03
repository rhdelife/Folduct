import { describe, expect, it } from "vitest";
import { vaseIndex, vasePaths } from "../art/vases";
import { defaultFace, faceColors, normalizeFace, pickFace } from "../domain/face";
import { buildRoom } from "../domain/importFile";
import type { RoomFace } from "../domain/model";
import { sampleRooms } from "../storage/sample";

describe("방 얼굴", () => {
  it("얼굴이 없던 방은 예전 모양을 그대로 받고, 같은 방은 늘 같은 얼굴이에요", () => {
    expect(defaultFace("방-1").shape).toBe(vaseIndex("방-1"));
    expect(defaultFace("방-1")).toEqual(defaultFace("방-1"));
  });

  it("색은 정해진 범위 안에서 방마다 흩어져요", () => {
    const colors = new Set(Array.from({ length: 80 }, (_, at) => defaultFace(`방-${at}`).color));
    expect(colors.size).toBe(faceColors.length);
  });

  it("저장된 얼굴은 지키고, 망가진 칸만 기본값으로 채워요", () => {
    expect(normalizeFace({ shape: 2, color: 3 }, "r")).toEqual({ shape: 2, color: 3 });
    const fallback = defaultFace("r");
    expect(normalizeFace(undefined, "r")).toEqual(fallback);
    expect(normalizeFace({ shape: 99, color: 3 }, "r")).toEqual({ shape: fallback.shape, color: 3 });
    expect(normalizeFace({ shape: 2, color: -1 }, "r")).toEqual({ shape: 2, color: fallback.color });
    expect(normalizeFace({ shape: 1.5, color: "남색" }, "r")).toEqual(fallback);
  });

  it("새 방은 겹치지 않는 모양과 색을 먼저 받아요", () => {
    const taken: RoomFace[] = [];
    for (let at = 0; at < vasePaths.length; at += 1) taken.push(pickFace(taken, `새 방-${at}`));
    expect(new Set(taken.map((face) => face.shape)).size).toBe(vasePaths.length);
    expect(new Set(taken.map((face) => face.color)).size).toBe(faceColors.length);
  });

  it("다 쓰면 가장 덜 쓰인 쪽부터 다시 써요", () => {
    const taken: RoomFace[] = Array.from({ length: vasePaths.length }, (_, at) => ({ shape: at, color: at }));
    taken.push({ shape: 0, color: 0 });
    const next = pickFace(taken, "다음");
    expect(next.shape).not.toBe(0);
    expect(next.color).not.toBe(0);
  });

  it("방을 만들 때 이미 있는 얼굴을 피해요", () => {
    const made = (taken: RoomFace[]) => buildRoom({ taken, name: "방", source: "input", rootName: "방", files: [], scan: { complete: true, failed: 0 }, done: false, workDays: [], now: 0 }).face;
    const all = Array.from({ length: vasePaths.length - 1 }, (_, at) => ({ shape: at, color: at }));
    expect(made(all)).toEqual({ shape: vasePaths.length - 1, color: faceColors.length - 1 });
  });

  it("샘플 방은 서로 다른 얼굴이에요", () => {
    const faces = sampleRooms(0).map((room) => room.face);
    expect(new Set(faces.map((face) => face.shape)).size).toBe(faces.length);
    expect(new Set(faces.map((face) => face.color)).size).toBe(faces.length);
  });
});

describe("이미지 얼굴", () => {
  it("없어진 표시는 버려요", () => {
    // 없어진 이미지 얼굴 표시는 남기지 않습니다. 그런 방은 화병으로 보여요.
    expect(normalizeFace({ shape: 1, color: 1, mark: 5 }, "r")).toEqual({ shape: 1, color: 1 });
  });
});
