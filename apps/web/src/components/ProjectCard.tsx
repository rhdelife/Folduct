import { useRef } from "react";
import { clampDeskPosition, deskCard, firstActionLine, projectInitial } from "../domain/deskLayout";
import type { RoomUsage } from "../domain/care";
import { formatByteSize } from "../domain/preview";
import type { DeskPosition, Project, RootRecord } from "../domain/models";
import { CapacityBar } from "./RoomCapacity";

export function ProjectCard({
  project,
  root,
  encoding,
  workDays,
  fileCount,
  totalBytes,
  countExact,
  usage,
  budgetBytes,
  nextAction,
  pausedAt,
  connection,
  scale,
  position,
  onPosition,
  onCommit,
  onOpen,
  onShare,
}: {
  project: Project;
  root: RootRecord | null;
  encoding: "none" | "work" | "files";
  workDays: number | null;
  fileCount: number;
  totalBytes: number | null;
  countExact: boolean;
  usage: RoomUsage;
  budgetBytes: number | null;
  nextAction: string;
  pausedAt: number | null;
  connection: string;
  scale: number;
  position: DeskPosition;
  onPosition: (position: DeskPosition) => void;
  onCommit: (position: DeskPosition) => void;
  onOpen: () => void;
  onShare?: () => void;
}) {
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean; latest: { x: number; y: number } } | null>(null);
  const action = firstActionLine(nextAction);
  const depth = fileCount === 0 ? 0 : fileCount < 10 ? 1 : fileCount < 100 ? 2 : 3;
  const saturation = workDays === null ? 0 : workDays === 0 ? 20 : workDays < 3 ? 40 : workDays < 8 ? 60 : 85;

  return (
    <article
      className="project-card"
      style={{ left: position.x, top: position.y, width: deskCard.width, height: deskCard.height }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        if ((event.target as HTMLElement).closest("button")) return;
        drag.current = { x: position.x, y: position.y, px: event.clientX, py: event.clientY, moved: false, latest: position };
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // 포인터 캡처를 지원하지 않아도 이동 계산은 이어갑니다.
        }
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const next = clampDeskPosition({
          x: drag.current.x + (event.clientX - drag.current.px) / scale,
          y: drag.current.y + (event.clientY - drag.current.py) / scale,
        });
        drag.current.moved = true;
        drag.current.latest = next;
        onPosition(next);
      }}
      onPointerUp={() => {
        if (!drag.current) return;
        const moved = drag.current.moved;
        const latest = drag.current.latest;
        drag.current = null;
        if (moved) onCommit(latest);
      }}
    >
      <div className="cover" style={{ background: project.coverColor }} aria-hidden="true">
        <span>{projectInitial(project.name)}</span>
        {encoding === "work" && <span className="work-marker" style={{ backgroundColor: workDays === null ? "#f8f1e8" : `hsl(167 ${saturation}% 42%)` }} />}
        {encoding === "files" && countExact && <span className={`paper-stack depth-${depth}`}><i /><i /><i /></span>}
      </div>
      <div className="card-copy">
        <h2>{project.name}</h2>
        <p>{connection}</p>
        <CapacityBar usage={usage} budgetBytes={budgetBytes} />
        <p>{action ? `다음: ${action}` : "다음 행동은 아직 없습니다"}</p>
        <p>{pausedAt ? `마지막 중단 ${formatPaused(pausedAt)}` : "아직 여기서 멈추지 않음"}</p>
        {encoding === "work" && <p className="visual-label">{workDays === null ? "작업 날짜 기록 없음" : `최근 30일 작업 ${workDays}일`}</p>}
        {encoding === "files" && <p className="visual-label" title={`${countExact ? totalBytes === null ? "전체 용량을 확인할 수 없습니다." : `확인된 파일 정보 합계 ${formatByteSize(totalBytes)}` : "스캔이 끝나지 않아 전체 수를 모릅니다."}${root?.lastScanAt ? ` · 마지막 확인 ${new Date(root.lastScanAt).toLocaleString("ko-KR")}` : ""}`}>{!root?.scan ? "자료 수 미확인" : countExact ? `파일 ${fileCount.toLocaleString("ko-KR")}개${totalBytes === null ? "" : ` · ${formatByteSize(totalBytes)}`}` : `최소 ${fileCount.toLocaleString("ko-KR")}개 확인`}</p>}
        {root && !root.scan?.complete && <p>일부 파일만 연결됨</p>}
        <div className="sheet-actions">
          <button type="button" className="primary" onClick={onOpen}>이어서 시작</button>
          {onShare && <button type="button" onClick={onShare}>공유하기</button>}
        </div>
      </div>
    </article>
  );
}

function formatPaused(timestamp: number): string {
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(timestamp);
}
