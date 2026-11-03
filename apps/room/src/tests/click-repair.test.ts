import { describe, expect, it } from "vitest";
import { clickOrder } from "../gateways/clickRepair";

describe("뒤집힌 클릭 알아채기", () => {
  it("정상 순서의 클릭은 건드리지 않아요", () => {
    const order = clickOrder();
    expect(order.down("탭", 0)).toBe(false);
    order.up("탭", 80);
    expect(order.down("탭", 90)).toBe(false);
  });

  it("뗀 뒤에 같은 자리가 바로 눌리면 뒤집힌 클릭이에요", () => {
    const order = clickOrder();
    order.up("탭", 100);
    expect(order.down("탭", 100)).toBe(true);
  });

  it("다른 자리이거나 시간이 지났으면 새 클릭이에요", () => {
    const other = clickOrder();
    other.up("탭", 100);
    expect(other.down("버튼", 110)).toBe(false);
    const late = clickOrder();
    late.up("탭", 100);
    expect(late.down("탭", 400)).toBe(false);
  });

  it("뒤집힌 클릭 뒤의 다음 클릭은 정상으로 봐요", () => {
    const order = clickOrder();
    order.up("탭", 100);
    expect(order.down("탭", 100)).toBe(true);
    expect(order.down("탭", 500)).toBe(false);
    order.up("탭", 580);
    expect(order.down("탭", 590)).toBe(false);
  });
});
