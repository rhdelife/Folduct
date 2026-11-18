import type { RoomUsage } from "../domain/care";
import { formatBytes } from "../domain/model";

// 방 합계. 부분 스캔의 합계는 실제보다 작아서 최소라고 적습니다.
export function Capacity({ usage }: { usage: RoomUsage }) {
  const total = formatBytes(usage.totalBytes);
  return (
    <div className="capacity">
      <p>{usage.exact ? total : `최소 ${total}`}</p>
      {usage.boxBytes > 0 && <p className="capacity-box">정리 상자 {formatBytes(usage.boxBytes)}</p>}
    </div>
  );
}
