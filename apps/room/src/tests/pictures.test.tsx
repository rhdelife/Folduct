import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ObjectShape, paperArts, pickArt } from "../art/ObjectShape";
import { kindLabels, type Kind } from "../domain/model";
import { isStoredPicture, parsePictureKey } from "../storage/db";
import { fitWithin, outputType, pictureSide } from "../storage/pictures";

const kinds = Object.keys(kindLabels) as Kind[];
const render = (props: Parameters<typeof ObjectShape>[0]) => renderToStaticMarkup(<ObjectShape {...props} />);
const attr = (markup: string, tag: string, name: string) => Number(new RegExp(`<${tag}[^>]*\\s${name}="([^"]+)"`).exec(markup)?.[1]);
// 그림마다 그 그림을 고르는 seed를 찾아 둡니다.
const seedFor = (kind: Kind, id: string) => Array.from({ length: 300 }, (_, at) => `s${at}`).find((seed) => pickArt(kind, seed).id === id)!;

describe("내 이미지 크기", () => {
  it("긴 변을 384px로 줄이고 비율은 지켜요", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: pictureSide, height: 288 });
    expect(fitWithin(1000, 4000)).toEqual({ width: 96, height: pictureSide });
  });

  it("작은 그림은 키우지 않아요", () => {
    expect(fitWithin(120, 80)).toEqual({ width: 120, height: 80 });
  });

  it("크기를 모르는 그림은 정사각형, 아주 가는 그림도 1px은 남겨요", () => {
    expect(fitWithin(0, 0)).toEqual({ width: pictureSide, height: pictureSide });
    expect(fitWithin(NaN, 10)).toEqual({ width: pictureSide, height: pictureSide });
    expect(fitWithin(10000, 1)).toEqual({ width: pictureSide, height: 1 });
  });

  it("JPEG 사진만 JPEG, 투명할 수 있는 나머지는 모두 PNG로 저장해요", () => {
    expect(outputType("image/jpeg")).toBe("image/jpeg");
    for (const type of ["image/png", "image/gif", "image/webp", "image/svg+xml", "image/vnd.microsoft.icon", "image/heic", "image/tiff", ""]) expect(outputType(type), type).toBe("image/png");
  });
});

describe("저장 기록", () => {
  it("키에서 방과 물건을 읽고, 망가진 키는 건너뛰어요", () => {
    expect(parsePictureKey("pic:room-1:thing-1")).toEqual({ room: "room-1", thing: "thing-1" });
    for (const key of ["pic:", "pic::t", "pic:r:", "mark:r", 3, null, "pic:r"]) expect(parsePictureKey(key), String(key)).toBeNull();
  });

  it("그림 기록만 받아요", () => {
    expect(isStoredPicture({ type: "image/png", bytes: new ArrayBuffer(3) })).toBe(true);
    for (const value of [null, {}, { type: "text/plain", bytes: new ArrayBuffer(3) }, { type: "image/png", bytes: new ArrayBuffer(0) }, { type: "image/png", bytes: "abc" }]) expect(isStoredPicture(value)).toBe(false);
  });
});

describe("종이에 끼운 내 이미지", () => {
  it("모든 종이에서 크기는 원래 그림과 같고, 그림은 종이 안·이름 띠 위에 있어요", () => {
    for (const kind of kinds) {
      for (const art of paperArts[kind]) {
        const seed = seedFor(kind, art.id);
        for (const size of [20, 64, 120]) {
          const plain = render({ kind, size, name: "여름 포스터 최종.png", seed });
          const pictured = render({ kind, size, name: "여름 포스터 최종.png", seed, picture: "blob:test" });
          const label = `${kind}/${art.id}/${size}`;
          expect(attr(pictured, "svg", "width"), label).toBe(attr(plain, "svg", "width"));
          expect(attr(pictured, "svg", "height"), label).toBe(attr(plain, "svg", "height"));
          expect(pictured, label).toContain('href="blob:test"');
          const [x, y, w, h] = ["x", "y", "width", "height"].map((name) => attr(pictured, "image", name));
          expect(x, label).toBeGreaterThan(0);
          expect(y, label).toBeGreaterThan(0);
          expect(x + w, label).toBeLessThan(art.w);
          expect(h, label).toBeGreaterThan(art.h * 0.4);
          if (size >= 56) {
            // 이름은 그림 아래 띠에 찍혀요.
            expect(pictured, label).toContain("<text");
            expect(y + h, label).toBeLessThanOrEqual(attr(pictured, "tspan", "y") - 4);
          } else {
            expect(y + h, label).toBeLessThan(art.h);
          }
        }
      }
    }
  });

  it("그림이 없으면 원래 종이 그대로예요", () => {
    expect(render({ kind: "image", size: 64, name: "a.png", seed: "x", picture: null })).not.toContain("<image");
    expect(render({ kind: "image", size: 64, name: "a.png", seed: "x" })).not.toContain("<image");
  });
});

// 저장소를 흉내 내는 최소 indexedDB. meta 하나만 Map으로 둡니다.
function fakeMeta(initial: [string, unknown][]) {
  const meta = new Map(initial);
  type Range = { lower: string; upper: string };
  const within = (key: string, range: Range) => key >= range.lower && key <= range.upper;
  const keysIn = (range: Range) => [...meta.keys()].filter((key) => within(key, range)).sort();
  const store = {
    getAllKeys: (range: Range) => ({ result: keysIn(range) }),
    getAll: (range: Range) => ({ result: keysIn(range).map((key) => meta.get(key)) }),
    put: (value: unknown, key: string) => ({ result: meta.set(key, value) && key }),
    delete: (key: string | Range) => ({ result: typeof key === "string" ? meta.delete(key) : keysIn(key).forEach((at) => meta.delete(at)) }),
  };
  vi.stubGlobal("IDBKeyRange", { bound: (lower: string, upper: string) => ({ lower, upper }) });
  vi.stubGlobal("indexedDB", {
    open: () => {
      const request: Record<string, unknown> = {};
      request.result = {
        transaction: () => {
          const tx: Record<string, unknown> = { objectStore: () => store };
          setTimeout(() => (tx.oncomplete as () => void)());
          return tx;
        },
      };
      setTimeout(() => (request.onsuccess as () => void)());
      return request;
    },
  });
  return meta;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("저장소의 내 이미지", () => {
  const png = { type: "image/png", bytes: new ArrayBuffer(4) };

  it("목록은 그림 키만, 망가진 기록은 지우지 않고 건너뛰어요", async () => {
    const meta = fakeMeta([["doorstep", {}], ["mark:r1", "옛 얼굴"], ["pic:r1:t1", png], ["pic:r1:t2", "망가짐"], ["pic:r2:t3", png]]);
    const { listPictures } = await import("../storage/db");
    expect((await listPictures()).map(({ room, thing }) => `${room}/${thing}`)).toEqual(["r1/t1", "r2/t3"]);
    expect(meta.has("pic:r1:t2")).toBe(true);
  });

  it("넣고 지우면 그 파일 하나만 바뀌어요", async () => {
    const meta = fakeMeta([["pic:r1:t1", png]]);
    const { putPicture, deletePicture } = await import("../storage/db");
    await putPicture("r1", "t2", png);
    await deletePicture("r1", "t1");
    expect([...meta.keys()]).toEqual(["pic:r1:t2"]);
  });

  it("방을 잊으면 그 방의 그림만 지워요", async () => {
    const meta = fakeMeta([["pic:r1:t1", png], ["pic:r1:t2", png], ["pic:r10:t3", png], ["pic:r2:t4", png], ["doorstep", {}]]);
    const { forgetRoom } = await import("../storage/db");
    await forgetRoom("r1");
    expect([...meta.keys()].sort()).toEqual(["doorstep", "pic:r10:t3", "pic:r2:t4"]);
  });
});
