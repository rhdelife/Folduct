import { useId } from "react";
import { ObjectShape } from "../../art/ObjectShape";
import { kindParts, kindSummary, vaseBands, vaseIndex, vasePaths } from "../../art/vases";
import { budgetLevel, roomUsage } from "../../domain/care";
import { formatBytes, type Room } from "../../domain/model";
import { progressText, roomActivity, roomMess, roomProgress } from "../../domain/sky";
import { kindCounts } from "../../domain/table";

// 목록의 다른 얼굴: 화병과 용량, 14일 활동, 형식별 수.
const pitch = 14;
const dotRows = 4;
const objectSize = 18;

export function TableSummary({ room, now }: { room: Room; now: number }) {
  const clip = useId();
  const usage = roomUsage(room);
  const level = budgetLevel(usage, room.budgetBytes);
  const parts = kindParts(room.things);
  const vase = vaseIndex(room.id);
  // 지도의 화병은 한도 대비로 차지만, 여기서는 한도가 없는 방도 형식 비율을 보여 줍니다.
  const ratio = room.budgetBytes && level !== "partial" ? usage.totalBytes / room.budgetBytes : 1;
  // 부분 스캔의 합계는 최솟값이라, 한도에 닿았으면 넘은 게 확실합니다. 그래서 level이 아니라 합계로 봅니다.
  const over = !!room.budgetBytes && usage.totalBytes >= room.budgetBytes;
  const limit = room.budgetBytes ? (over ? "한도를 넘었어요" : `${Math.round((usage.totalBytes / room.budgetBytes) * 100)}% 찼어요`) : "한도 없음";

  const days = roomActivity(room, now);
  const filled = days.flatMap((day, x) => Array.from({ length: Math.min(dotRows, day.value) }, (_, y) => `M${(x + 0.5) * pitch} ${(dotRows - y - 0.5) * pitch}h0`)).join("");
  const empty = days.flatMap((day, x) => Array.from({ length: dotRows - Math.min(dotRows, day.value) }, (_, y) => `M${(x + 0.5) * pitch} ${(y + 0.5) * pitch}h0`)).join("");
  const used = days.reduce((sum, day) => sum + day.value, 0);
  const worked = days.filter((day) => day.value > 0).length;

  const counts = kindCounts(room);
  const { fallen, tilted } = roomMess(room, now);
  const progress = progressText(roomProgress(room, now), now);

  return (
    <div className="table-summary" data-own-wheel>
      <section className="sum-col" aria-label="용량">
        <h3 className="sum-label">용량</h3>
        <div className="sum-size">
          <svg className="sum-vase" viewBox="-90 -100 180 200" aria-hidden="true" focusable="false">
            <clipPath id={clip}><path d={vasePaths[vase]} /></clipPath>
            <path className="vase-body" d={vasePaths[vase]} />
            <g clipPath={`url(#${clip})`}>
              {vaseBands(parts, ratio).map((band) => <rect key={band.label} className="vase-band" x={-100} y={band.y} width={200} height={band.height} fill={band.color} />)}
            </g>
            <path className={`vase-line level-${level}`} d={vasePaths[vase]} />
          </svg>
          <p className="sum-stat">
            <strong>{formatBytes(usage.totalBytes)}</strong>
            {(room.budgetBytes || !usage.exact) && <small>{usage.exact ? `/ ${formatBytes(room.budgetBytes!)}` : "최소"}</small>}
            <span className={over ? "attention" : undefined}>{limit}</span>
          </p>
        </div>
      </section>
      <section className="sum-col" aria-label="최근 14일">
        <h3 className="sum-label">최근 14일</h3>
        <div className="sum-cell sum-days">
          <p className="sum-stat">
            <strong>{used}</strong>
            <small>개</small>
            <span>{worked === 0 ? "쓴 날이 없어요" : `${worked}일 동안 썼어요`}</span>
          </p>
          <svg viewBox={`0 0 ${pitch * 14} ${pitch * dotRows}`} role="img" aria-label={`최근 14일 동안 쓴 파일 ${used}개, 쓴 날 ${worked}일`} focusable="false">
            <path className="sum-dot-empty" d={empty} strokeWidth={pitch * 0.4} />
            <path className="sum-dot" d={filled} strokeWidth={pitch * 0.4} />
          </svg>
          <p className="sum-axis" aria-hidden="true"><span>14일 전</span><span>오늘</span></p>
        </div>
      </section>
      <section className="sum-col" aria-label="파일 형식">
        <h3 className="sum-label">파일 형식</h3>
        {counts.length > 0 ? (
          <ul className="sum-kinds">
            {counts.map(({ label, kind, count }) => (
              <li key={label}>
                <ObjectShape kind={kind} size={objectSize} />
                <span>{label}</span>
                <b>{count}</b>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sum-cell sum-none">{room.things.length > 0 ? "찾지 못했어요." : "아직 없어요."}</p>
        )}
      </section>
      <p className="sum-line">
        <span>
          {/* 0바이트 파일만 있는 방은 비율을 못 내지만 빈 방은 아닙니다. 파일을 다 잃은 방도 '아직'이 아니고요. */}
          {parts.length > 0 ? `${kindSummary(parts)}. ` : counts.length > 0 ? "" : room.things.length > 0 ? "폴더에서 파일을 찾지 못했어요. " : "이 방에는 아직 파일이 없어요. "}
          {fallen + tilted > 0 ? <strong>{[fallen && `쓰러진 파일 ${fallen}개`, tilted && `기울어진 파일 ${tilted}개`].filter(Boolean).join(", ")}. </strong> : counts.length > 0 ? "모두 제자리에 있어요. " : ""}
          {progress}
        </span>
      </p>
    </div>
  );
}
