import { useMemo, useRef } from "react";
import { ObjectShape } from "../art/ObjectShape";
import { relativeDay } from "../domain/care";
import { formatBytes, type Room, type Thing } from "../domain/model";
import { seriesOf } from "../domain/versions";
import type { Folder } from "../gateways/native";
import { usePicture } from "../storage/pictures";
import { useThumb } from "../storage/thumbs";
import { Meta } from "./Meta";

// 서랍 아래 버전 기록: 같은 계열 파일을 새것부터 시간순으로 늘어놓아요. 누르면 그 버전이 서랍에 열려요.
export function VersionLog({ room, thing, folder, now, onPick }: { room: Room; thing: Thing; folder: Folder | null; now: number; onPick: (id: string) => void }) {
  const list = useMemo(() => seriesOf(room.things, thing), [room.things, thing]);
  // 버전 폴더가 나뉜 계열(…-v2/01.png, …-v3/01.png)은 이름이 같아서 폴더 이름을 함께 적어요.
  const split = list ? new Set(list.map((item) => item.path.slice(0, item.path.lastIndexOf("/")))).size > 1 : false;
  if (!list || thing.box) return null;
  return (
    <section className="version-log" aria-labelledby="version-log-title">
      <h3 id="version-log-title">버전 기록 <span className="lane-count">{list.length}</span></h3>
      <ol>
        {list.map((item, at) => (
          <li key={item.id}>
            <VersionRow item={item} folderName={split ? item.path.split("/").at(-2) : undefined} latest={at === 0} current={item.id === thing.id} folder={folder} now={now} onPick={onPick} />
          </li>
        ))}
      </ol>
    </section>
  );
}

const clock = (at: number) => new Date(at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });

// 오늘·어제는 시각까지, 그보다 옛날은 날짜만. 같은 날 여러 번 저장한 버전도 구별돼요.
function when(at: number, now: number): string {
  const day = relativeDay(at, now);
  return day === "오늘" || day === "어제" ? `${day} ${clock(at)}` : new Date(at).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
}

function VersionRow({ item, folderName, latest, current, folder, now, onPick }: { item: Thing; folderName?: string; latest: boolean; current: boolean; folder: Folder | null; now: number; onPick: (id: string) => void }) {
  const self = useRef<HTMLButtonElement>(null);
  const own = usePicture(item.id);
  const thumb = useThumb(self, own ? null : folder, item);
  return (
    <button ref={self} type="button" className="version-row" aria-current={current ? "true" : undefined} title={item.path} onClick={() => onPick(item.id)}>
      <span className="version-art"><ObjectShape kind={item.kind} size={40} seed={item.id} picture={own ?? thumb} /></span>
      <span className="version-text">
        <b>{item.name}</b>
        <Meta items={[when(item.lastModified, now), formatBytes(item.size), latest && "최신"]} />
        {folderName && <span className="version-folder">{folderName}</span>}
      </span>
    </button>
  );
}
