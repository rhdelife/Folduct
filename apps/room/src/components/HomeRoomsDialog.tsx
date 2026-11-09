import { useRef, useState } from "react";
import { relativeDay, roomLastActivity, roomUsage } from "../domain/care";
import { formatBytes, type Room } from "../domain/model";
import { homeLimit, roomsToKeep } from "../domain/sky";
import { RankVase } from "./SkyPanel";
import { FrodoGuide } from "./FrodoGuide";
import { useModal } from "./useModal";
import { toggled } from "./sets";

// 홈 자리보다 방이 많아지면 뜹니다. 새 방, 다시 올리기, 가져오기, 예전 기록이 모두 이 창 하나로 옵니다.
export function HomeRoomsDialog({ rooms, prefer, now, onKeep }: { rooms: Room[]; prefer: (string | null)[]; now: number; onKeep: (keep: Set<string>) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [keep, setKeep] = useState(() => new Set(roomsToKeep(rooms, prefer)));
  const [saving, setSaving] = useState(false);
  useModal(dialog);

  function toggle(id: string, on: boolean) {
    setKeep((current) => toggled(current, [id], on));
  }

  async function submit() {
    setSaving(true);
    await onKeep(keep);
    // 저장에 실패하면 창이 남으니 다시 누를 수 있게 합니다.
    setSaving(false);
  }

  const full = keep.size >= homeLimit;
  const shown = rooms.filter((room) => keep.has(room.id)).length;
  return (
    <dialog ref={dialog} className="sheet" aria-labelledby="home-rooms-title" onCancel={(event) => event.preventDefault()}>
      <FrodoGuide />
      <form
        className="sheet-body"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 id="home-rooms-title">홈에 둘 방을 골라 주세요</h2>
        <p>홈에는 방을 {homeLimit}개까지 둘 수 있어요. 뺀 방은 메뉴의 방 목록에 있고, 폴더와 파일은 그대로예요.</p>
        {/* 다 차면 빈 칸을 막아 두니, 눌러도 왜 안 되는지 여기서 알려요. */}
        <p role="status"><strong>{shown} / {homeLimit}</strong>{full && " · 다 찼어요. 다른 방을 넣으려면 하나를 먼저 빼 주세요."}</p>
        <section className="sweep-room">
          <ul>
            {rooms.map((room) => {
              const last = roomLastActivity(room);
              return (
                <li key={room.id}>
                  <label>
                    <input type="checkbox" checked={keep.has(room.id)} disabled={saving || (full && !keep.has(room.id))} onChange={(event) => toggle(room.id, event.target.checked)} />
                    <RankVase room={room} partial={!roomUsage(room).exact} />
                    <span className="name">{room.name}</span>
                    <span className="soft">{formatBytes(roomUsage(room).totalBytes)}{last > 0 ? ` · 마지막 작업 ${relativeDay(last, now)}` : ""}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
        <div className="row end">
          <button type="submit" className="primary" autoFocus disabled={saving || shown === 0}>{saving ? "옮기는 중" : `${shown}개만 홈에 두기`}</button>
        </div>
      </form>
    </dialog>
  );
}
