import { describe, expect, it } from "vitest";
import { cleanGroup, roomGroups } from "../domain/model";

describe("방 분류", () => {
  it("분류 이름은 다듬고, 비거나 글자가 아니면 분류 없음", () => {
    expect(cleanGroup(" 수업 ")).toBe("수업");
    expect(cleanGroup("")).toBeNull();
    expect(cleanGroup(undefined)).toBeNull();
    expect(cleanGroup("가".repeat(25))).toHaveLength(20);
  });

  it("방들의 분류를 겹치지 않게 가나다순으로 모은다", () => {
    expect(roomGroups([{ group: "회사" }, { group: null }, { group: "수업" }, { group: "회사" }, {}])).toEqual(["수업", "회사"]);
  });
});
