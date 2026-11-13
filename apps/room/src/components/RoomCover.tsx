import { useMemo, useRef } from "react";
import { ObjectShape } from "../art/ObjectShape";
import { ownCoverId, type Room, type Thing } from "../domain/model";
import type { Folder } from "../gateways/native";
import { usePicture } from "../storage/pictures";
import { coverOf, useThumb } from "../storage/thumbs";

// 방 카드의 그림(방 썸네일). 이름만으로 방을 찾지 않게 그림을 보여 줘요.
// 방 설정에서 고른 것(방 파일이나 올린 그림)이 먼저이고, 없으면 가장 최근 그림, 그림이 없는 방은 첫 파일의 종이예요.
export function RoomCover({ room, folder, px }: { room: Room; folder: Folder | null; px: number }) {
  const ownUrl = usePicture(ownCoverId(room.id));
  const cover = useMemo(() => coverOf(room) ?? room.things.find((thing) => !thing.missing), [room.things, room.cover]); // eslint-disable-line react-hooks/exhaustive-deps
  if (room.cover === ownCoverId(room.id) && ownUrl) return <OwnCover seed={room.id} url={ownUrl} px={px} />;
  return cover ? <CoverPaper thing={cover} folder={folder} px={px} /> : null;
}

// 사용자가 올린 그림을 그림 종이로 그려요. 방 설정의 미리보기도 같은 모양이에요.
export function OwnCover({ seed, url, px }: { seed: string; url: string; px: number }) {
  return (
    <span className="room-cover" aria-hidden="true">
      <ObjectShape kind="image" size={px} seed={seed} picture={url} />
    </span>
  );
}

export function CoverPaper({ thing, folder, px }: { thing: Thing; folder: Folder | null; px: number }) {
  const self = useRef<HTMLSpanElement>(null);
  const own = usePicture(thing.id);
  const thumb = useThumb(self, own ? null : folder, thing);
  const url = own ?? thumb;
  return (
    <span ref={self} className="room-cover" aria-hidden="true">
      <ObjectShape kind={thing.kind} size={px} seed={thing.id} picture={url} />
    </span>
  );
}
