import { colorGroups } from "../art/palette";
import type { Kind, Room } from "./model";
import { roomProgress } from "./sky";

// 방 표 장면의 순수 계산: 방 순서, 글자 풀림.

// 진행 중인 방을 최근에 쓴 순서로, 완료한 방은 그 뒤로.
export function roomOrder(rooms: Room[], now: number): Room[] {
  const usedAt = (room: Room) => roomProgress(room, now).lastActivityAt ?? room.createdAt;
  return [...rooms].sort((a, b) => Number(a.care.done) - Number(b.care.done) || usedAt(b) - usedAt(a));
}

export function folderOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut > 0 ? path.slice(0, cut) : "맨 위";
}

export function kindCounts(room: Room): { label: string; kind: Kind; count: number }[] {
  return colorGroups
    .map(({ label, kinds }) => ({ label, kind: kinds[0], count: room.things.filter((thing) => !thing.missing && kinds.includes(thing.kind)).length }))
    .filter((group) => group.count > 0)
    .sort((a, b) => b.count - a.count);
}

/* ── 글자 풀림 ── */
// 한글은 비슷한 글자로(모음과 받침 있고 없음은 두고), 라틴은 라틴으로, 숫자는 숫자로 바꿉니다. 길이와 문장 부호는 그대로라 칸이 흔들리지 않아요.
export function scramble(chars: string[], seed: number, from = 0): string {
  return chars
    .map((char, index) => {
      const at = from + index;
      const code = char.codePointAt(0)!;
      if (code >= 0xac00 && code <= 0xd7a3) {
        const syllable = code - 0xac00;
        const tail = syllable % 28;
        const lead = Math.floor(syllable / 588);
        const nextTail = tail === 0 ? 0 : 1 + ((tail - 1 + seed * 5 + at * 3) % 27);
        return String.fromCodePoint(0xac00 + ((lead + seed + at * 7) % 19) * 588 + (syllable - lead * 588 - tail) + nextTail);
      }
      if (/[a-z]/.test(char)) return String.fromCharCode(97 + ((seed + at * 11) % 26));
      if (/[A-Z]/.test(char)) return String.fromCharCode(65 + ((seed + at * 11) % 26));
      if (/[0-9]/.test(char)) return String((seed + (at % 2) * 5) % 10);
      return char;
    })
    .join("");
}

export const decodeStart = 2510;
export const decodeStep = 57.14;
const decodeLength = 240;
export const decodeEnd = decodeStart + decodeStep * 7 + decodeLength;

// pos 하나로 정해지는 글자. 멈추면 그대로 멈추고, 되돌리면 똑같이 다시 흐트러집니다.
// 푸는 중인 줄은 5마다, 아직 기다리는 줄은 드물게 바꿔 그리는 양을 줄입니다.
export function decodeAt(text: string, pos: number, row: number, col: number): string {
  const progress = (pos - (decodeStart + decodeStep * row)) / decodeLength;
  if (progress >= 1) return text;
  const chars = Array.from(text);
  const shown = progress <= 0 ? 0 : Math.floor(progress * chars.length);
  const roll = Math.floor(pos / (progress <= 0 ? 40 : 5));
  return chars.slice(0, shown).join("") + scramble(chars.slice(shown), roll * 3 + row * 7 + col * 13 + 1, shown);
}

// 카드가 올라오는 동안 k줄째가 켜집니다.
export function counterAt(pos: number, rows: number): number {
  return Math.max(0, Math.min(rows, Math.floor((pos - 1757) / 58.5) + 1));
}
