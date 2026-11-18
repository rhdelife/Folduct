import { mergeScan } from "../domain/care";
import type { Room, Thing } from "../domain/model";
import { copyBetween, freeDoorName, moveBetween } from "../gateways/mover";
import { folderMover, isNative, scanRoomFolder } from "../gateways/native";
import { roomFolder } from "./box";
import { patchRoom } from "./db";

export type TransferMode = "move" | "copy";
// 옮긴(복제한) 파일과 대상 방 폴더 맨 위에 둔 이름. 같은 이름이 있으면 '이름 (2)'처럼 비켜 놓아요.
export type Transferred = { thing: Thing; name: string };

// 옮기기·복제를 받을 수 있는 방: 데스크톱에서 폴더를 연결한 다른 방.
export const canReceive = (room: Room, from: Room) => isNative() && room.id !== from.id && room.source === "handle" && typeof room.origin === "string";

// 대상 방 목록을 폴더에 맞춰요. 못 읽어도 옮긴 파일은 그대로고, 방을 열 때 다시 맞춰요.
async function syncRoom(room: Room) {
  try {
    const folder = await roomFolder(room);
    if (!folder) return;
    const scan = await scanRoomFolder(folder);
    await patchRoom(room.id, (latest) => mergeScan(latest, scan.files, scan, Date.now()));
  } catch (error) {
    console.error(error);
  }
}

// 고른 파일들을 다른 방 폴더 맨 위로 옮기거나 복제해요. 하나가 실패해도 나머지는 계속해요.
// 대상 방은 폴더를 다시 읽어 '새로 왔어요'에 세워요. 옮긴 파일을 이 방 기록에서 빼는 건 부른 쪽(방 화면의 저장 흐름)이 해요.
export async function transferThings(from: Room, to: Room, things: Thing[], mode: TransferMode): Promise<{ done: Transferred[]; failed: number; message: string | null }> {
  const [source, target] = await Promise.all([roomFolder(from), roomFolder(to)]);
  if (typeof source !== "string" || typeof target !== "string") return { done: [], failed: things.length, message: "두 방 모두 폴더가 연결되어 있어야 해요." };
  const done: Transferred[] = [];
  let message: string | null = null;
  for (const thing of things) {
    if (thing.box || thing.missing) {
      message ??= "정리 상자 안 파일과 없는 파일은 빼고 했어요.";
      continue;
    }
    const name = await freeDoorName(folderMover(target), thing.name);
    if (!name) {
      message ??= "대상 방에 둘 이름을 정하지 못했어요.";
      continue;
    }
    const result = mode === "move" ? await moveBetween(folderMover(source), thing.path, folderMover(target), name) : await copyBetween(source, thing.path, target, name);
    if (result.ok) done.push({ thing, name });
    else message ??= result.message;
  }
  if (done.length > 0) await syncRoom(to);
  return { done, failed: things.length - done.length, message };
}

// 옮기기 되돌리기: 대상 방 맨 위의 파일을 원래 자리로 돌려놓아요. 원래 자리에 다른 파일이 생겼으면 덮어쓰지 않아요.
// 돌아온 것만 돌려줘요. 이 방 기록(메모·자리)을 되살리는 건 부른 쪽이 해요.
export async function undoMove(from: Room, to: Room, done: Transferred[]): Promise<Transferred[]> {
  const [source, target] = await Promise.all([roomFolder(from), roomFolder(to)]);
  if (typeof source !== "string" || typeof target !== "string") return [];
  const back: Transferred[] = [];
  for (const entry of done) {
    if ((await moveBetween(folderMover(target), entry.name, folderMover(source), entry.thing.path)).ok) back.push(entry);
  }
  if (back.length > 0) {
    const names = new Set(back.map(({ name }) => name));
    // 넣기로 새로 생긴 기록은 방에 있던 적 없는 것처럼 빼요.
    await patchRoom(to.id, (latest) => ({ ...latest, things: latest.things.filter((thing) => !names.has(thing.path)) }));
  }
  return back;
}
