import { describe, expect, it } from "vitest";
import { kindTones } from "../art/palette";
import { dayMs, defaultCare, localDay } from "../domain/care";
import type { Room, Thing } from "../domain/model";
import { clampSpin, columnOrder, dialPitch, dialPose, focusPose, nameTop, onDial, recentWork, ringPose, dialAngle, roomFacts, vaseFill, dialGeometry } from "../domain/dial";

const now = new Date(2026, 9, 20, 12).getTime();

function thing(id: string, patch: Partial<Thing> = {}): Thing {
  return { id, path: `${id}.png`, name: `${id}.png`, kind: "image", size: 10, lastModified: now - 30 * dayMs, lastUsedAt: null, missing: false, spot: null, note: "", touchedAt: null, pinned: false, box: null, ...patch };
}
function room(things: Thing[], patch: Partial<Room> = {}): Room {
  return { id: "r", name: "r", createdAt: now, source: "handle", rootName: "r", scan: { complete: true, failed: 0, at: now, freedBytes: 0 }, things, workDays: [], care: defaultCare, budgetBytes: null, budgetNoticeAt: null, doneOfferAt: null, face: { shape: 0, color: 0 }, ...patch };
}

describe("다이얼", () => {
  const visible = (count: number, spin: number) => Array.from({ length: count }, (_, i) => dialAngle(i, count, spin)).filter(onDial);

  it("방이 많아도 다이얼에는 일곱 장만 오르고, 돌리면 다음 방이 들어와요", () => {
    for (const spin of [0, 13, -200, 999, 5000]) expect(visible(30, spin)).toHaveLength(7);
    expect(dialAngle(0, 30, 0)).toBe(0);
    expect(dialAngle(29, 30, 0)).toBeCloseTo(-dialPitch);
    expect(dialAngle(10, 30, -10 * dialPitch)).toBeCloseTo(0);
  });

  it("일곱 장 미만은 12시를 중심으로 놓이고 끝 화병가 12시를 넘지 않아요", () => {
    expect(dialAngle(0, 1, 0)).toBe(0);
    expect([0, 1, 2].map((i) => dialAngle(i, 3, 0))).toEqual([-dialPitch, 0, dialPitch]);
    expect(clampSpin(500, 3)).toBeCloseTo(dialPitch);
    expect(clampSpin(-500, 1)).toBe(-20);
    expect(clampSpin(500, 7)).toBe(500);
  });

  it("세로줄은 12시부터 시계 방향이고 살짝 돌아가도 순서가 그대로예요", () => {
    const angles = (spin: number) => Array.from({ length: 7 }, (_, i) => dialAngle(i, 7, spin));
    expect(columnOrder(angles(0))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(columnOrder(angles(-7))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(columnOrder([-dialPitch, 0, dialPitch])).toEqual([2, 0, 1]);
  });

  it("창 폭마다 정해진 치수를 쓰고, 이름은 커진 화병 아래에 와요", () => {
    const wide = dialGeometry(1280, 840);
    expect(wide.width).toBe(170);
    expect(dialPose(0, wide).y).toBeCloseTo(0.56 * 840);
    expect(dialPose(dialPitch, wide).x).toBeCloseTo(302, 0);
    expect(nameTop(wide)).toBeGreaterThan(focusPose(wide).y + wide.height * 1.16);
    expect(dialGeometry(720, 840).width).toBe(130);
    expect(dialGeometry(375, 812).center).toBeCloseTo(0.82 * 812);
  });

  it("자세히 보기에서 기다리는 화병는 화면 아래 가장자리에 머물러요", () => {
    const wide = dialGeometry(1280, 840);
    expect(ringPose(dialPitch, wide).y + wide.height / 2).toBeCloseTo(809, 0);
  });

  it("어느 방이든 12시로 돌릴 수 있어요. 돌아왔을 때 그 방이 보여요", () => {
    for (const [index, count] of [[0, 1], [2, 3], [5, 6], [6, 7], [19, 30], [29, 30]]) {
      expect(dialAngle(index, count, clampSpin(-dialAngle(index, count, 0), count))).toBeCloseTo(0);
    }
  });
});

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("화병 내용", () => {
  it("이름과 액면은 어느 형식 바탕에서도 4.5:1 이상이에요", () => {
    for (const tone of Object.values(kindTones)) for (const field of [tone.soft, tone.pale]) expect(contrast(tone.ink, field)).toBeGreaterThanOrEqual(4.5);
  });

  it("용량이 가장 큰 형식이 바탕이 되고, 없으면 기타예요", () => {
    expect(roomFacts(room([thing("a", { kind: "image", size: 10 }), thing("b", { kind: "video", size: 99 })])).kind).toBe("video");
    expect(roomFacts(room([])).kind).toBe("unknown");
    expect(roomFacts(room([thing("gone", { kind: "video", size: 99, missing: true })])).biggest).toBeNull();
  });

  it("마지막 활동과 가장 큰 파일을 골라요", () => {
    const facts = roomFacts(room([thing("old", { size: 500 }), thing("new", { lastModified: now - dayMs })]));
    expect(facts.latest?.id).toBe("new");
    expect(facts.lastAt).toBe(now - dayMs);
    expect(facts.biggest?.id).toBe("old");
    expect(roomFacts(room([thing("never", { lastModified: 0 })])).lastAt).toBe(0);
  });

  it("최근 며칠 중 방을 쓴 날을 오늘이 끝에 오게 세요", () => {
    const week = recentWork([localDay(now), localDay(now - 2 * dayMs), localDay(now - 30 * dayMs)], now, 7);
    expect(week).toEqual([false, false, false, false, true, false, true]);
    expect(recentWork([], now)).toHaveLength(14);
  });

  it("한도가 있으면 한도 대비, 없으면 조금 덜 채워요", () => {
    expect(vaseFill(room([], { budgetBytes: 100 }), 50)).toBe(0.5);
    expect(vaseFill(room([]), 50)).toBe(0.8);
  });
});
