import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { localDay } from "../domain/care";
import type { Room } from "../domain/model";
import { freeDoorName, memoName, saveMemo, trashFile } from "../gateways/mover";
import { folderMover, isNative } from "../gateways/native";
import { getSession, listRooms } from "../storage/db";

// 쓰다 만 메모와 마지막에 고른 방은 이 창 안에서만 기억해요. 못 읽어도 빈 메모로 시작해요.
const draftKey = "folduct.memo.draft";
const roomKey = "folduct.memo.room";
const remember = (key: string, value: string | null) => {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // 저장소를 못 쓰면 기억만 못 해요.
  }
};
const recall = (key: string): string => {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
};

// 폴더를 연결한 진행 중인 방만 메모를 받을 수 있어요.
const linked = (room: Room) => room.source === "handle" && Boolean(room.origin) && !room.care.done;
const defaultBase = (room: Room | undefined) => `${localDay(Date.now())} ${room?.name ?? ""} memo`.replace(/\s+/g, " ");

// 퀵 메모(2026-11-19 요청): 메뉴 막대 작은 창 안에서 '메모'를 누르면 펼쳐져요. 저장하면 고른 방 폴더 맨 위에 '날짜 방이름 memo.txt'로 들어가요.
export function QuickMemo({ onClose }: { onClose: () => void }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState(() => recall(roomKey));
  const [text, setText] = useState(() => recall(draftKey));
  const [name, setName] = useState("");
  // 이름을 직접 고쳤으면 방을 바꿔도 그대로 둬요.
  const [named, setNamed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ text: string; failed?: boolean; saved?: { root: string; name: string } } | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const room = rooms.find((item) => item.id === roomId);

  // 펼칠 때마다 방 목록을 다시 읽고, 작업 중인 방이 있으면 그 방을 골라요.
  useEffect(() => {
    const load = async () => {
      try {
        const [list, session] = await Promise.all([listRooms(), getSession()]);
        const usable = list.filter(linked);
        setRooms(usable);
        const working = session?.status === "working" ? usable.find((item) => item.id === session.roomId) : undefined;
        setRoomId((before) => working?.id ?? (usable.some((item) => item.id === before) ? before : (usable[0]?.id ?? "")));
      } catch (error) {
        console.error(error);
      }
      area.current?.focus();
    };
    void load();
  }, []);

  useEffect(() => {
    if (!named) setName(defaultBase(room));
  }, [room?.id, room?.name, named]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => remember(draftKey, text), [text]);
  useEffect(() => remember(roomKey, roomId || null), [roomId]);

  async function save() {
    if (!room?.origin || !text.trim() || busy) return;
    setBusy(true);
    setDone(null);
    try {
      const file = await freeDoorName(folderMover(room.origin), memoName(name));
      const result = file ? await saveMemo(room.origin, file, text) : { ok: false as const, message: "방 폴더에 둘 이름을 정하지 못했어요." };
      if (result.ok) {
        setDone({ text: `${room.name} 방에 ${file!.normalize("NFC")}(으)로 저장했어요.`, saved: { root: room.origin, name: file! } });
        setText("");
        setNamed(false);
        setName(defaultBase(room));
      } else setDone({ text: result.message, failed: true });
    } catch (error) {
      console.error(error);
      setDone({ text: "저장하지 못했어요.", failed: true });
    }
    setBusy(false);
  }

  async function undo({ root, name: file }: { root: string; name: string }) {
    setBusy(true);
    try {
      await trashFile(root, file);
      setDone({ text: "저장한 메모를 휴지통으로 보냈어요." });
    } catch (error) {
      console.error(error);
      setDone({ text: "휴지통으로 보내지 못했어요.", failed: true });
    }
    setBusy(false);
  }

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
    }
  };

  return (
    <section className="pet-memo" aria-label="퀵 메모" onKeyDown={onKey}>
        <textarea ref={area} className="memo-text" aria-label="메모" placeholder="바로 적어 두세요" value={text} onChange={(event) => setText(event.target.value)} />
        {rooms.length === 0 ? (
          <p className="memo-note">폴더를 연결한 방이 있어야 저장할 수 있어요.</p>
        ) : (
          <div className="memo-fields">
            <label>
              <span>방</span>
              <select value={roomId} onChange={(event) => setRoomId(event.target.value)}>
                {rooms.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>이름</span>
              <input
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setNamed(true);
                }}
              />
            </label>
          </div>
        )}
        {done && (
          <div className="memo-done">
            <p role="status" className={done.failed ? "error" : undefined}>{done.text}</p>
            {done.saved && <button type="button" disabled={busy} onClick={() => void undo(done.saved!)}>되돌리기</button>}
          </div>
        )}
        <div className="memo-actions">
          <button type="button" className="quiet" onClick={onClose}>닫기</button>
          <button type="button" className="primary" disabled={busy || !room || !text.trim() || !isNative()} title={isNative() ? "⌘Enter" : "앱에서만 저장할 수 있어요"} onClick={() => void save()}>저장</button>
        </div>
    </section>
  );
}
