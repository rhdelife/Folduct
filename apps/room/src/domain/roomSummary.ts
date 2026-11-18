import { kindParts } from "../art/duct";
import { formatBytes, type Room } from "./model";
import type { RoomStat } from "./sky";
import { formatWork } from "./worklog";

// 홈에서 방 카드를 프로도에게 먹이면 말풍선에 띄우는 짧은 요약(2026-11-18 요청). 프로도 말투(반말), 두세 문장.
// 파일 수·용량, 가장 큰 형식, 이번 주 쓴 파일, 안 쓴 파일, 그해 이 방에서 일한 시간만 써요. 기록에 없는 말은 지어내지 않아요.
// 받침이 있으면 '이야', 없으면 '야'(영상이야·이미지야).
const isYa = (word: string) => {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code < 11172 && code % 28 !== 0 ? `${word}이야` : `${word}야`;
};

export function roomSummary(room: Room, stat: RoomStat, workedMs: number, year: number): string[] {
  const live = room.things.filter((thing) => !thing.missing && !thing.box);
  if (live.length === 0) return [`${room.name} 방은 아직 비어 있어.`];
  const size = `${stat.usage.exact ? "" : "최소 "}${formatBytes(stat.usage.totalBytes)}`;
  const top = kindParts(live).sort((a, b) => b.size - a.size)[0];
  const lines = [`${room.name} 방에는 파일 ${live.length.toLocaleString("ko-KR")}개, ${size}가 있어.${top ? ` 제일 큰 건 ${isYa(top.label)}.` : ""}`];
  const recent = stat.progress.recentCount;
  lines.push(stat.stale > 0 ? `${recent > 0 ? `이번 주에 ${recent}개를 썼고, ` : ""}안 쓴 파일 ${stat.stale}개는 정리해도 돼.` : recent > 0 ? `이번 주에 ${recent}개를 썼어. 안 쓴 파일은 없어.` : "안 쓴 파일은 없어.");
  if (workedMs > 0) lines.push(`${year}년에 이 방에서 ${formatWork(workedMs)} 일했어.`);
  return lines;
}
