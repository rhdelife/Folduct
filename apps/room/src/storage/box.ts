import { mergeScan, sweepCandidates } from "../domain/care";
import type { BoxEntry, Room, Thing } from "../domain/model";
import { fileManagerName } from "../domain/platform";
import { fileExists, freeBoxPath, moveFile, type MoveDirectory } from "../gateways/mover";
import { askFolder, canMoveIn, folderAccess, folderMover, folderSource, isNative, scanRoomFolder, type Folder } from "../gateways/native";
import { getHandle, listRooms, patchRoom, setLastSweepAt } from "./db";

export type SweepPlan = {
  room: Room;
  // virtual: 폴더 입력 방식·샘플·이동을 못 하는 브라우저는 Folduct 안에서만 상자에 넣습니다.
  mode: "real" | "virtual";
  handle: Folder | null;
  candidates: Thing[];
};

export type SweepOutcome = {
  roomId: string;
  roomName: string;
  mode: "real" | "virtual";
  moved: number;
  movedBytes: number;
  failures: { id: string; path: string; name: string; message: string }[];
  skipped: string | null;
};

// '제자리로'가 바꾼 칸만 돌려줍니다. 화면은 이것만 합쳐서, 기다리는 동안 고친 메모·자리를 지킵니다. 실패하면 빈 객체입니다.
export type RestorePatch = Partial<Pick<Thing, "box" | "path" | "touchedAt">>;

// 최신 저장본 위에서 물건별 변경을 한 트랜잭션으로 씁니다. null이면 그 물건은 그대로 둡니다.
function patchThings(roomId: string, change: (thing: Thing) => Partial<Thing> | null): Promise<Room> {
  return patchRoom(roomId, (room) => ({
    ...room,
    things: room.things.map((thing) => {
      const patch = change(thing);
      return patch ? { ...thing, ...patch } : thing;
    }),
  }));
}

// 방의 실제 폴더: 데스크톱은 절대 경로(origin), 브라우저는 저장해 둔 핸들.
export async function roomFolder(room: Room): Promise<Folder | null> {
  if (room.source !== "handle") return null;
  return isNative() ? (room.origin ?? null) : getHandle(room.id);
}

// 권한을 묻지 않고 읽을 수 있을 때만 폴더를 다시 읽어 저장합니다. 못 읽으면 기록을 그대로 두고 seen은 null이에요.
async function rereadRoom(room: Room, handle: Folder, now: number): Promise<{ current: Room; seen: Set<string> | null }> {
  if ((await folderAccess(handle)) !== "granted") return { current: room, seen: null };
  const current = await reconcileBox(room, handle);
  try {
    const scan = await scanRoomFolder(handle);
    return { current: await patchRoom(room.id, (latest) => mergeScan(latest, scan.files, scan, now)), seen: new Set(scan.files.map((file) => file.path)) };
  } catch (error) {
    console.error(error);
    return { current, seen: null };
  }
}

// 집 화면이 밖에서 바뀐 파일을 따라잡습니다. 폴더를 실제로 읽은 방의 수를 돌려줘요.
export async function refreshRooms(rooms: Room[], now = Date.now()): Promise<number> {
  const reads = await Promise.all(
    rooms
      .filter((room) => !room.care.done)
      .map(async (room) => {
        try {
          const handle = await roomFolder(room);
          return handle ? (await rereadRoom(room, handle, now)).seen !== null : false;
        } catch (error) {
          console.error(error);
          return false;
        }
      }),
  );
  return reads.filter(Boolean).length;
}

// rooms를 주면 다시 읽지 않습니다. 방마다 권한 확인과 폴더 읽기는 동시에 합니다.
export async function planSweep(rooms?: Room[], now = Date.now()): Promise<SweepPlan[]> {
  const plans = await Promise.all(
    (rooms ?? (await listRooms())).map(async (room): Promise<SweepPlan | null> => {
      const handle = await roomFolder(room);
      // 저장된 활동은 방에 들어갈 때만 새로워집니다. 방 밖에서 쓴 파일이 오래된 것으로 잡히지 않게 폴더를 먼저 다시 읽습니다.
      const { current, seen } = handle ? await rereadRoom(room, handle, now) : { current: room, seen: null };
      const real = handle !== null && canMoveIn(handle);
      // 실제 파일을 옮기는 방은 이번에 폴더에서 확인한 파일만 제안합니다. 옛 기록만 보고 옮기지 않아요.
      const candidates = sweepCandidates(current, now).filter((thing) => !real || seen?.has(thing.path));
      if (candidates.length === 0) return null;
      return { room: current, mode: real ? "real" : "virtual", handle: real ? handle : null, candidates };
    }),
  );
  return plans.filter((plan) => plan !== null);
}

// '정리하기' 클릭 안에서 불러야 합니다. 쓰기 권한 요청에 사용자 동작이 필요합니다.
export async function runSweep(plans: SweepPlan[], selected: Set<string>, now = Date.now()): Promise<SweepOutcome[]> {
  const picked = plans.map((plan) => ({ plan, things: plan.candidates.filter((thing) => selected.has(thing.id)) })).filter((entry) => entry.things.length > 0);
  // 권한부터 모두 받아 둡니다. 다른 비동기 작업 뒤에는 클릭의 사용자 동작이 만료될 수 있습니다.
  const granted = new Map<string, boolean>();
  for (const { plan } of picked) {
    if (plan.mode === "real" && plan.handle) granted.set(plan.room.id, (await folderAccess(plan.handle, "readwrite")) === "granted" || (await askFolder(plan.handle, "readwrite")));
  }
  const outcomes: SweepOutcome[] = [];
  for (const { plan, things } of picked) {
    const outcome: SweepOutcome = { roomId: plan.room.id, roomName: plan.room.name, mode: plan.mode, moved: 0, movedBytes: 0, failures: [], skipped: null };
    outcomes.push(outcome);
    if (plan.mode === "real" && plan.handle) {
      if (granted.get(plan.room.id)) await boxRoom(plan.room.id, folderMover(plan.handle), things, outcome, now);
      else outcome.skipped = "폴더 수정 권한을 받지 못해 아무것도 옮기지 않았어요.";
      continue;
    }
    const ids = new Set(things.map((thing) => thing.id));
    // 이미 상자에 든 물건(다시 누른 정리 등)은 건드리지 않습니다.
    const boxed = new Set<string>();
    await patchThings(plan.room.id, (thing) => {
      if (!ids.has(thing.id) || thing.box) return null;
      boxed.add(thing.id);
      return { box: { state: "virtual", fromPath: thing.path, boxPath: thing.path, at: now } };
    });
    for (const thing of things) if (boxed.has(thing.id)) count(outcome, thing);
  }
  // 권한을 못 받아 모두 건너뛴 주는 끝난 주로 치지 않습니다. 다음에 다시 묻습니다.
  if (outcomes.length === 0 || outcomes.some((outcome) => outcome.skipped === null)) await setLastSweepAt(now);
  return outcomes;
}

function count(outcome: SweepOutcome, thing: Thing) {
  outcome.moved += 1;
  outcome.movedBytes += thing.size;
}

// 오래 안 쓴 방 제안의 답. 표시만 바꾸고 폴더와 파일은 그대로예요.
export function answerDoneOffer(roomId: string, done: boolean, now = Date.now()): Promise<Room> {
  return patchRoom(roomId, (room) => ({ ...room, doneOfferAt: now, care: { ...room.care, done: room.care.done || done } }));
}

// 기록은 방마다 두 번만: 옮기기 전 moving-in 한 번, 끝난 뒤 결과 한 번. 중간에 꺼져도 moving-in을 보고 reconcileBox가 맞춥니다.
async function boxRoom(roomId: string, root: MoveDirectory, things: Thing[], outcome: SweepOutcome, now: number) {
  const fail = (thing: Thing, message: string) => outcome.failures.push({ id: thing.id, path: thing.path, name: thing.name, message });
  // 1. 상자 안 이름을 먼저 모두 정합니다. 같은 묶음 안에서 'a (2).txt'와 'a.txt'의 두 번째 이름이 겹치지 않게 잡아 둡니다.
  const reserved = new Set<string>();
  const targets = new Map<string, BoxEntry>();
  for (const thing of things) {
    const boxPath = await freeBoxPath(root, thing.path, reserved).catch(() => null);
    if (boxPath) targets.set(thing.id, { state: "moving-in", fromPath: thing.path, boxPath, at: now });
    else fail(thing, "상자 안에 둘 이름을 정하지 못했어요.");
  }
  // 2. 최신 기록에 상자 기록이 없는 물건만 moving-in으로 적습니다. 이미 상자에 든 물건은 내려앉히지 않습니다.
  const journaled = new Set<string>();
  const renamed = new Set<string>();
  await patchThings(roomId, (thing) => {
    const entry = targets.get(thing.id);
    if (!entry || thing.box) return null;
    // 목록을 연 뒤 Finder에서 이름이나 자리가 바뀐 파일은 옮기지 않고, 말없이 빠지지 않게 실패로 알려요.
    if (thing.path !== entry.fromPath) {
      renamed.add(thing.id);
      return null;
    }
    journaled.add(thing.id);
    return { box: entry };
  });
  for (const thing of things) if (renamed.has(thing.id)) fail(thing, "정리 목록을 연 뒤 이름이나 자리가 바뀌어서 옮기지 않았어요.");
  // 3. 하나씩 옮깁니다.
  const results = new Map<string, Partial<Thing>>();
  for (const thing of things) {
    const entry = targets.get(thing.id);
    if (!entry || !journaled.has(thing.id)) continue;
    const moved = await moveFile(root, entry.fromPath, entry.boxPath);
    if (moved.ok) {
      results.set(thing.id, { box: { ...entry, state: "boxed" }, path: entry.boxPath });
      count(outcome, thing);
    } else {
      results.set(thing.id, { box: null });
      fail(thing, moved.message);
    }
  }
  // 4. 결과를 한 번에 적습니다. 그사이 다른 쪽이 맞춘 기록은 그대로 둡니다.
  if (results.size === 0) return;
  await patchThings(roomId, (thing) => (thing.box?.state === "moving-in" && thing.box.boxPath === targets.get(thing.id)?.boxPath ? (results.get(thing.id) ?? null) : null));
}

// 방 폴더 자체를 못 읽으면(옮겨짐·드라이브 분리·권한) 파일이 두 자리 모두 없어 보여서, 맞추기 전에 확인합니다.
async function folderReadable(handle: Folder): Promise<boolean> {
  try {
    for await (const _ of folderSource(handle).list()) break;
    return true;
  } catch {
    return false;
  }
}

// 옮기던 중 꺼졌던 기록은 파일이 실제로 있는 쪽에 맞춥니다. 최신 저장본에 적고 그 방을 돌려줍니다.
// 폴더에 닿지 못하면 기록을 그대로 두고 다음에 다시 맞춥니다.
export async function reconcileBox(room: Room, handle: Folder): Promise<Room> {
  const stuck = room.things.some((thing) => thing.box?.state === "moving-in" || thing.box?.state === "moving-out");
  if (!stuck || !(await folderReadable(handle))) return room;
  const root = folderMover(handle);
  const settled = new Map<string, { boxPath: string; patch: Partial<Thing> }>();
  for (const thing of room.things) {
    const entry = thing.box;
    if (!entry || (entry.state !== "moving-in" && entry.state !== "moving-out")) continue;
    try {
      const inBox = await fileExists(root, entry.boxPath);
      const atHome = await fileExists(root, entry.fromPath);
      const patch: Partial<Thing> =
        entry.state === "moving-out" && atHome ? { box: null, path: entry.fromPath, missing: false }
        : inBox ? { box: { ...entry, state: "boxed" }, path: entry.boxPath, missing: false }
        : { box: null, path: entry.fromPath, missing: !atHome };
      settled.set(thing.id, { boxPath: entry.boxPath, patch });
    } catch {
      // 권한이 없으면 다음 방문 때 다시 맞춥니다.
    }
  }
  if (settled.size === 0) return room;
  return patchThings(room.id, (thing) => {
    const found = settled.get(thing.id);
    const moving = thing.box?.state === "moving-in" || thing.box?.state === "moving-out";
    return found && moving && thing.box?.boxPath === found.boxPath ? found.patch : null;
  });
}

// '제자리로': 상자 폴더의 파일을 원래 경로로 되돌립니다. 버튼 클릭 안에서 불러야 합니다.
export async function restoreFromBox(room: Room, handle: Folder | null, thingId: string, now = Date.now()): Promise<{ room: Room; patch: RestorePatch; error: string | null }> {
  const thing = room.things.find((item) => item.id === thingId);
  const entry = thing?.box;
  const fail = (error: string, current = room) => ({ room: current, patch: {}, error });
  if (!thing || !entry) return fail("상자에 없는 물건이에요.");
  const patch: RestorePatch = { box: null, path: entry.fromPath, touchedAt: now };
  const write = (change: Partial<Thing>) => patchThings(room.id, (item) => (item.id === thingId ? change : null));
  if (entry.state === "virtual") return { room: await write(patch), patch, error: null };
  if (!handle) return fail("폴더 접근이 있어야 파일을 제자리로 옮길 수 있어요.");
  if ((await folderAccess(handle, "readwrite")) !== "granted" && !(await askFolder(handle, "readwrite"))) return fail("폴더 수정 권한을 받지 못해 옮기지 않았어요.");
  const root = folderMover(handle);
  if (await fileExists(root, entry.fromPath)) return fail(`원래 자리에 같은 이름의 파일이 있어요. ${fileManagerName()}에서 확인해 주세요.`);
  await write({ box: { ...entry, state: "moving-out" } });
  const moved = await moveFile(root, entry.boxPath, entry.fromPath);
  if (!moved.ok) return fail(moved.message, await write({ box: { ...entry, state: "boxed" } }));
  return { room: await write(patch), patch, error: null };
}
