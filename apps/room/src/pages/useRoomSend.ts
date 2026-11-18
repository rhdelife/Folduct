import { useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { ToastAction } from "../components/Toast";
import type { Room, Thing } from "../domain/model";
import type { Folder } from "../gateways/native";
import { isNotFound, restoreTrashed, trashFile } from "../gateways/mover";
import { listRooms } from "../storage/db";
import { canReceive, transferThings, undoMove, type TransferMode } from "../storage/transfer";

type SendContext = {
  latest: RefObject<Room | null>;
  handle: Folder | null;
  picked: Set<string> | null;
  setPicked: Dispatch<SetStateAction<Set<string> | null>>;
  selectedId: string | null;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setBusy: Dispatch<SetStateAction<string | null>>;
  update: (change: (room: Room) => Room, touch?: string[]) => void;
  toast: (message: string, action?: ToastAction) => void;
  heading: RefObject<HTMLHeadingElement | null>;
};

// 방 안에서 사용자 폴더를 바꾸는 일 중 고르기 줄의 옮기기·복제·휴지통과, 파일 하나 휴지통으로 보내기예요(RoomPage에서 자리만 옮김).
// 실제 이동·복제·휴지통은 mover.ts와 transfer.ts가 하고, 여기서는 묻기·방 기록 맞추기·알림과 되돌리기를 해요.
export function useRoomSend({ latest, handle, picked, setPicked, selectedId, setSelectedId, setBusy, update, toast, heading }: SendContext) {
  // 옮기기·복제할 방 고르는 중이면 그 방법과 받을 수 있는 방들.
  const [send, setSend] = useState<{ mode: TransferMode; rooms: Room[] } | null>(null);

  // 고른 파일들을 한 번 묻고 차례로 휴지통으로 보내요. 하나가 실패해도 나머지는 계속해요. 고르기 줄과 꺼내기 목록이 같이 써요.
  async function trashPicked(ids: Set<string> | null = picked) {
    const chosen = (latest.current?.things ?? []).filter((thing) => ids?.has(thing.id) && !thing.missing);
    if (chosen.length === 0 || typeof handle !== "string" || !(await window.confirm(`파일 ${chosen.length.toLocaleString("ko-KR")}개를 휴지통으로 보낼까요? 휴지통에서 되살릴 수 있어요.`))) return;
    setBusy("휴지통으로 보내는 중…");
    const done: { thing: Thing; place: string | null }[] = [];
    for (const thing of chosen) {
      try {
        done.push({ thing, place: await trashFile(handle, thing.path) });
      } catch (error) {
        // 이미 없는 파일은 기록에서만 빼요.
        if (isNotFound(error)) done.push({ thing, place: null });
        else console.error(error);
      }
    }
    const sent = new Set(done.map(({ thing }) => thing.id));
    setBusy(null);
    if (sent.size > 0) update((room) => ({ ...room, things: room.things.filter((thing) => !sent.has(thing.id)) }));
    if (selectedId && sent.has(selectedId)) setSelectedId(null);
    setPicked(null);
    const failed = chosen.length - sent.size;
    toast(`${sent.size > 0 ? `파일 ${sent.size.toLocaleString("ko-KR")}개를 휴지통으로 보냈어요.` : ""}${failed > 0 ? ` ${failed.toLocaleString("ko-KR")}개는 보내지 못했어요.` : ""}`.trim(), undoTrash(handle, done));
  }

  // 고른 파일들을 다른 방으로 옮기거나 복제해요(2026-11-18 요청). 먼저 받을 방을 고르게 해요.
  async function chooseTarget(mode: TransferMode) {
    const current = latest.current;
    if (!current) return;
    setSend({ mode, rooms: (await listRooms()).filter((other) => canReceive(other, current)) });
  }

  async function sendTo(to: Room) {
    const from = latest.current;
    if (!from || !send) return;
    const mode = send.mode;
    const chosen = from.things.filter((thing) => picked?.has(thing.id) && !thing.missing && !thing.box);
    if (chosen.length === 0) return;
    setSend(null);
    setBusy(mode === "move" ? "옮기는 중…" : "복제하는 중…");
    const { done, failed, message } = await transferThings(from, to, chosen, mode);
    setBusy(null);
    const gone = new Set(done.map(({ thing }) => thing.id));
    if (mode === "move" && gone.size > 0) {
      update((room) => ({ ...room, things: room.things.filter((thing) => !gone.has(thing.id)) }));
      if (selectedId && gone.has(selectedId)) setSelectedId(null);
    }
    setPicked(null);
    const verb = mode === "move" ? "옮겼어요" : "복제했어요";
    const text = `${done.length > 0 ? `파일 ${done.length.toLocaleString("ko-KR")}개를 ‘${to.name}’ 방으로 ${verb}.` : ""}${failed > 0 ? ` ${failed.toLocaleString("ko-KR")}개는 못 했어요.${message ? ` ${message}` : ""}` : ""}`.trim();
    // 옮기기만 되돌릴 수 있어요. 복제는 원본이 그대로라 되돌릴 게 없어요.
    toast(text, mode === "move" && done.length > 0 ? {
      label: "되돌리기",
      run: () =>
        void undoMove(from, to, done).then((back) => {
          if (back.length > 0) update((room) => ({ ...room, things: [...room.things, ...back.map(({ thing }) => thing).filter((thing) => !room.things.some((item) => item.id === thing.id))] }));
          toast(back.length === done.length ? `파일 ${back.length.toLocaleString("ko-KR")}개를 되돌렸어요.` : `${back.length.toLocaleString("ko-KR")}개만 되돌렸어요. 원래 자리에 같은 이름 파일이 생겼을 수 있어요.`);
        }),
    } : undefined);
  }

  // 휴지통으로 보낸 파일들을 원래 자리로 되돌리고 방 기록에 다시 넣는 알림 단추. 자리를 모르면(macOS 밖) 단추가 없어요.
  function undoTrash(root: string, done: { thing: Thing; place: string | null }[]): ToastAction | undefined {
    const known = done.filter((item): item is { thing: Thing; place: string } => item.place !== null);
    if (known.length === 0) return undefined;
    return {
      label: "되돌리기",
      run: () =>
        void (async () => {
          const back: Thing[] = [];
          for (const { thing, place } of known) {
            try {
              await restoreTrashed(root, thing.path, place);
              back.push(thing);
            } catch (error) {
              console.error(error);
            }
          }
          if (back.length > 0) update((room) => ({ ...room, things: [...room.things, ...back.filter((thing) => !room.things.some((item) => item.id === thing.id))] }));
          const failed = known.length - back.length;
          toast(back.length > 0 ? `파일 ${back.length.toLocaleString("ko-KR")}개를 되돌렸어요.${failed > 0 ? ` ${failed.toLocaleString("ko-KR")}개는 되돌리지 못했어요. 휴지통에서 직접 꺼내 주세요.` : ""}` : "되돌리지 못했어요. 휴지통에서 직접 꺼내 주세요.");
        })(),
    };
  }

  // 묻고 나서 휴지통으로 보내고, 방 기록에서도 빼요(데스크톱만). 휴지통에서 되살릴 수 있어요.
  async function trashThing(id: string) {
    const gone = latest.current?.things.find((thing) => thing.id === id);
    if (!gone || typeof handle !== "string" || !(await window.confirm(`‘${gone.name}’ 파일을 휴지통으로 보낼까요? 휴지통에서 되살릴 수 있어요.`))) return;
    let place: string | null;
    try {
      place = await trashFile(handle, gone.path);
    } catch (error) {
      if (!isNotFound(error)) return toast(`휴지통으로 보내지 못했어요. (${String(error)})`);
      update((room) => ({ ...room, things: room.things.filter((thing) => thing.id !== id) }));
      setSelectedId(null);
      return toast(`‘${gone.name}’ 파일이 이미 없어서 목록에서만 뺐어요.`);
    }
    update((room) => ({ ...room, things: room.things.filter((thing) => thing.id !== id) }));
    setSelectedId(null);
    heading.current?.focus();
    toast(`‘${gone.name}’ 파일을 휴지통으로 보냈어요.`, undoTrash(handle, [{ thing: gone, place }]));
  }

  return { send, setSend, chooseTarget, sendTo, trashPicked, trashThing };
}
