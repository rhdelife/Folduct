import type { Room } from "../domain/model";
import { renameFile } from "../gateways/mover";
import { askFolder, canMoveIn, folderAccess, folderMover } from "../gateways/native";
import { roomFolder } from "./box";
import { patchRoom } from "./db";

// 파일 이름 바꾸기. 실제 폴더에서는 mover.renameFile(같은 폴더 안, 덮어쓰기 없음)로 바꾼 뒤 기록을 맞춰요.
// 샘플 방은 실제 파일이 없어 기록만 바꿔요. 버튼 클릭 안에서 불러야 합니다(쓰기 권한 요청).
export async function renameThing(room: Room, thingId: string, newName: string, now = Date.now()): Promise<{ room: Room | null; error: string | null }> {
  const thing = room.things.find((item) => item.id === thingId);
  if (!thing || thing.missing || thing.box) return { room: null, error: "이름을 바꿀 수 없는 파일이에요." };
  const name = newName.trim();
  if (name === thing.name) return { room, error: null };
  const path = [...thing.path.split("/").slice(0, -1), name].join("/");
  if (room.source !== "sample") {
    const folder = await roomFolder(room);
    if (!folder) return { room: null, error: "방 폴더가 연결되어 있어야 이름을 바꿀 수 있어요." };
    if (!canMoveIn(folder)) return { room: null, error: "이 브라우저에서는 파일 이름을 바꿀 수 없어요." };
    if ((await folderAccess(folder, "readwrite")) !== "granted" && !(await askFolder(folder, "readwrite"))) return { room: null, error: "폴더 수정 권한을 받지 못해 바꾸지 않았어요." };
    const result = await renameFile(folderMover(folder), thing.path, name);
    if (!result.ok) return { room: null, error: result.message };
  }
  const saved = await patchRoom(room.id, (current) => ({ ...current, things: current.things.map((item) => (item.id === thingId ? { ...item, name, path, touchedAt: now } : item)) }));
  return { room: saved, error: null };
}
