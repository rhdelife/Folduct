import { useMemo, useRef } from "react";
import { ObjectShape } from "../art/ObjectShape";
import { ownCoverId, type Room, type Thing } from "../domain/model";
import type { Folder } from "../gateways/native";
import { usePicture } from "../storage/pictures";
import { coverOf, useThumb } from "../storage/thumbs";
import { mix } from "../art/palette";
import { cssToken } from "./tokens";
import { iconOfCover } from "../domain/icon";
import { useIcons } from "../storage/icons";
import { IconArt } from "./IconMaker";

// 방 썸네일 종이 색: 방 얼굴 색(--face-*)을 옅게 푼 값. 작업 시작 알약처럼 면은 옅고 테두리는 진한 얼굴 색이에요(.room-cover --ink).
// 종이는 옅은 칸·테두리 색을 계산해야 해서 var()가 아닌 실제 값이 필요해요.
export const faceHex = (color: number) => {
  const hex = cssToken(`--face-${color + 1}`);
  return /^#[0-9a-f]{6}$/i.test(hex) ? mix(hex, "#ffffff", 0.6) : undefined;
};

// 방 카드의 그림(방 썸네일). 이름만으로 방을 찾지 않게 그림을 보여 줘요.
// 방 설정에서 고른 것(방 파일, 올린 그림, 보관함 아이콘)이 먼저이고, 없으면 가장 최근 그림, 그림이 없는 방은 첫 파일의 종이예요.
export function RoomCover({ room, folder, px, color }: { room: Room; folder: Folder | null; px: number; color?: string }) {
  const ownUrl = usePicture(ownCoverId(room.id));
  const cover = useMemo(() => coverOf(room) ?? room.things.find((thing) => !thing.missing), [room.things, room.cover]); // eslint-disable-line react-hooks/exhaustive-deps
  const iconId = iconOfCover(room.cover);
  const icon = useIcons().find((item) => item.id === iconId);
  // 보관함에서 지운 아이콘이면 자동 썸네일로 돌아가요.
  if (icon) return <span className="room-cover icon-cover" aria-hidden="true"><IconArt icon={icon} px={px} /></span>;
  if (room.cover === ownCoverId(room.id) && ownUrl) return <OwnCover seed={room.id} url={ownUrl} px={px} color={color} />;
  return cover ? <CoverPaper thing={cover} folder={folder} px={px} color={color} /> : null;
}

// 사용자가 올린 그림을 그림 종이로 그려요. 방 설정의 미리보기도 같은 모양이에요.
export function OwnCover({ seed, url, px, color }: { seed: string; url: string; px: number; color?: string }) {
  return (
    <span className="room-cover" aria-hidden="true">
      <ObjectShape kind="image" color={color} size={px} seed={seed} picture={url} />
    </span>
  );
}

export function CoverPaper({ thing, folder, px, color }: { thing: Thing; folder: Folder | null; px: number; color?: string }) {
  const self = useRef<HTMLSpanElement>(null);
  const own = usePicture(thing.id);
  const thumb = useThumb(self, own ? null : folder, thing);
  const url = own ?? thumb;
  return (
    <span ref={self} className="room-cover" aria-hidden="true">
      <ObjectShape kind={thing.kind} color={color} size={px} seed={thing.id} picture={url} />
    </span>
  );
}
