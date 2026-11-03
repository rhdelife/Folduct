import { mergeScan } from "../domain/care";
import { addFolder, dropItem, restoreItem, settleFolder, settleMoved, type DoorItem, type Doorstep } from "../domain/doorstep";
import { readDoorFolder } from "../gateways/folder";
import { freeDoorName, moveDoorFile } from "../gateways/mover";
import type { Room } from "../domain/model";
import { folderMover, pathSource, sameFolder, scanRoomFolder } from "../gateways/native";
import { getDoorstep, listRooms, patchDoorstep, patchRoom } from "./db";

export type DoorMove = { folder: string; name: string };

// 현관 폴더를 읽어 줄을 맞춥니다. 파일은 읽기만 해요.
// 못 읽은 폴더(옮겨짐·드라이브 분리·권한)는 기록을 그대로 두고 다음에 다시 봅니다. 하나도 못 읽었으면 마지막으로 읽은 시각도 그대로예요.
export async function refreshDoorstep(now = Date.now()): Promise<{ state: Doorstep; failed: number }> {
  const before = await getDoorstep();
  if (before.folders.length === 0) return { state: before, failed: 0 };
  const reads = await Promise.all(
    before.folders.map(async (folder) => {
      try {
        return { folder, read: await readDoorFolder(pathSource(folder), before.seen[folder]) };
      } catch (error) {
        console.error(error);
        return null;
      }
    }),
  );
  const done = reads.filter((entry) => entry !== null);
  const state = await patchDoorstep((latest) => {
    const next = done.reduce((merged, { folder, read }) => settleFolder(merged, folder, read, now), latest);
    return done.length > 0 ? { ...next, readAt: now } : next;
  });
  return { state, failed: reads.length - done.length };
}

// 더하는 때에 기준을 잡아, 지금부터 생기는 문서만 새 문서가 됩니다. 방 폴더의 새 파일은 이미 그 방 선반에 올라가니 받지 않아요.
export async function addDoorFolder(folder: string): Promise<{ state: Doorstep; error: string | null }> {
  if ((await listRooms()).some((room) => sameFolder(room.origin, folder))) return { state: await getDoorstep(), error: "이미 방으로 연결한 폴더예요." };
  const read = await readDoorFolder(pathSource(folder), undefined);
  return { state: await patchDoorstep((latest) => addFolder(latest, folder, read)), error: null };
}

// 문서를 방 폴더로 옮깁니다. 방 기록은 고치지 않아요. 방을 열 때 폴더를 다시 읽어 선반에 올립니다.
export async function assignDoorItem(item: DoorItem, folder: string): Promise<{ state: Doorstep; moved: DoorMove | null; error: string | null }> {
  const room = folderMover(folder);
  const name = await freeDoorName(room, item.path);
  if (!name) return { state: await getDoorstep(), moved: null, error: "방 폴더에 둘 이름을 정하지 못했어요." };
  const result = await moveDoorFile(folderMover(item.folder), item.path, room, name);
  if (result.ok) return { state: await patchDoorstep((latest) => settleMoved(latest, item)), moved: { folder, name }, error: null };
  // 파일이 이미 없으면 줄에 둘 이유가 없습니다. 그 밖의 실패는 다시 고를 수 있게 남겨 둬요.
  const state = result.reason === "missing" ? await patchDoorstep((latest) => dropItem(latest, item.id)) : await getDoorstep();
  return { state, moved: null, error: result.message };
}

// 방 목록을 폴더에 맞춥니다. 못 읽어도 옮긴 파일은 그대로고, 방을 열 때 다시 맞춰요.
async function syncRoom(room: Room) {
  try {
    const scan = await scanRoomFolder(room.origin!);
    await patchRoom(room.id, (latest) => mergeScan(latest, scan.files, scan, Date.now()));
  } catch (error) {
    console.error(error);
  }
}

// 작업 중인 방으로 가져옵니다. 파일을 그 방 폴더로 옮기고 방 목록에도 바로 올려요.
export async function bringIntoRoom(item: DoorItem, room: Room): Promise<{ state: Doorstep; moved: DoorMove | null; error: string | null }> {
  const result = await assignDoorItem(item, room.origin!);
  if (result.moved) await syncRoom(room);
  return result;
}

export async function undoBring(item: DoorItem, moved: DoorMove, room: Room): Promise<{ state: Doorstep; error: string | null }> {
  const result = await undoDoorMove(item, moved);
  if (!result.error) await syncRoom(room);
  return result;
}

// 되돌리기: 원래 이름으로 현관 폴더에 돌려놓고 줄에 다시 올립니다. 그 자리에 다른 파일이 있으면 덮어쓰지 않아요.
export async function undoDoorMove(item: DoorItem, moved: DoorMove): Promise<{ state: Doorstep; error: string | null }> {
  const result = await moveDoorFile(folderMover(moved.folder), moved.name, folderMover(item.folder), item.path);
  if (!result.ok) return { state: await getDoorstep(), error: result.message };
  return { state: await patchDoorstep((latest) => restoreItem(latest, item)), error: null };
}
