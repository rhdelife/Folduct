import type { Asset, Availability, Card, RootRecord, Workspace } from "./models";

// 방 돌보기: 손대지 않은 카드는 기울고 쓰러지며, 주간 정리 때 파일을 프로젝트 안 상자 폴더로 옮깁니다.
export const boxFolderName = "_Folduct 정리상자";
export const sweepIntervalDays = 7;

const dayMs = 24 * 60 * 60 * 1000;

export type CareStage = "normal" | "tilted" | "fallen";

export type BoxEntry = {
  // moving-*는 이동 직전에 남기는 기록이라, 중간에 앱이 꺼져도 실제 위치를 보고 맞출 수 있습니다.
  state: "moving-in" | "boxed" | "moving-out" | "virtual";
  fromPath: string;
  boxPath: string;
  at: number;
};

export type CareRecord = {
  key: string;
  enabled: boolean;
  resting: boolean;
  tiltAfterDays: number;
  fallAfterDays: number;
  touched: Record<string, number>;
  pinned: string[];
  boxed: Record<string, BoxEntry>;
  // 방 크기. null이면 용량은 보여주되 경고하지 않습니다.
  budgetBytes: number | null;
  // 방 크기를 넘었다는 배너를 마지막으로 보여준 시각(주 1회).
  budgetNoticeAt: number | null;
};

export type CareSettings = Pick<CareRecord, "enabled" | "resting" | "tiltAfterDays" | "fallAfterDays" | "budgetBytes" | "budgetNoticeAt">;

export function careKey(projectId: string): string {
  return `care:${projectId}`;
}

export function defaultCare(projectId: string): CareRecord {
  return { key: careKey(projectId), enabled: true, resting: false, tiltAfterDays: 3, fallAfterDays: 7, touched: {}, pinned: [], boxed: {}, budgetBytes: null, budgetNoticeAt: null };
}

export function localDay(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// 선택은 미리보기를 여는 행동이라 손댄 것으로 셉니다. 보기 위치·겹침 순서·삭제는 세지 않습니다.
export function touchedCardIds(prev: Workspace, next: Workspace): string[] {
  const before = new Map(prev.cards.map((card) => [card.id, card]));
  const ids = new Set<string>();
  for (const card of next.cards) {
    const old = before.get(card.id);
    if (!old || changed(old, card)) ids.add(card.id);
  }
  if (next.selectedCardId && next.selectedCardId !== prev.selectedCardId) ids.add(next.selectedCardId);
  return [...ids];
}

function changed(a: Card, b: Card): boolean {
  return a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height || a.zoneId !== b.zoneId || a.title !== b.title || a.note !== b.note;
}

export type StageInput = {
  touchedAt: number | undefined;
  now: number;
  workDays: string[];
  care: CareSettings;
  pinned: boolean;
  availability?: Availability;
  lastModified?: number;
};

// shortcut: 기기 시계만 믿습니다. 시계가 뒤로 가면 판정이 늦어질 뿐이고, 옮기기 전에는 항상 사용자 확인을 거칩니다.
export function careStage(input: StageInput): { stage: CareStage; days: number } {
  if (input.touchedAt === undefined) return { stage: "normal", days: 0 };
  const days = Math.max(0, Math.floor((input.now - input.touchedAt) / dayMs));
  if (!input.care.enabled || input.care.resting || input.pinned) return { stage: "normal", days };
  if (input.availability === "missing" || input.availability === "permissionRequired") return { stage: "normal", days };
  // 원본이 손댄 뒤에 수정됐다면 밖에서 작업 중일 수 있습니다.
  if (input.lastModified !== undefined && input.lastModified > input.touchedAt) return { stage: "normal", days };
  // 방 자체를 쓰지 않은 기간은 방치가 아닙니다. 손댄 날 이후 방을 쓴 날이 하루라도 있어야 합니다.
  const touchedDay = localDay(input.touchedAt);
  const today = localDay(input.now);
  if (!input.workDays.some((day) => day > touchedDay && day <= today)) return { stage: "normal", days };
  if (days >= input.care.fallAfterDays) return { stage: "fallen", days };
  if (days >= input.care.tiltAfterDays) return { stage: "tilted", days };
  return { stage: "normal", days };
}

export function cardStage(card: Card, asset: Asset | undefined, care: CareRecord, workDays: string[], now: number) {
  return careStage({
    touchedAt: care.touched[card.id],
    now,
    workDays,
    care,
    pinned: care.pinned.includes(card.id),
    availability: asset?.availability,
    lastModified: asset?.lastModified,
  });
}

export function isBoxedCard(card: Card, care: CareRecord | null): boolean {
  return Boolean(card.assetId && care?.boxed[card.assetId]);
}

export type SweepCandidate = { asset: Asset; days: number; note: string; cardIds: string[] };

// 같은 파일을 여러 카드가 쓰면, 그 카드가 모두 쓰러졌을 때만 옮깁니다. 메모 카드는 옮길 파일이 없습니다.
export function sweepCandidates(workspace: Workspace, assets: Asset[], care: CareRecord, workDays: string[], now: number): SweepCandidate[] {
  if (!care.enabled || care.resting) return [];
  const byAsset = new Map<string, Card[]>();
  for (const card of workspace.cards) {
    if (!card.assetId || care.boxed[card.assetId]) continue;
    byAsset.set(card.assetId, [...(byAsset.get(card.assetId) ?? []), card]);
  }
  const result: SweepCandidate[] = [];
  for (const [assetId, cards] of byAsset) {
    const asset = assets.find((item) => item.id === assetId);
    if (!asset) continue;
    const stages = cards.map((card) => cardStage(card, asset, care, workDays, now));
    if (!stages.every((item) => item.stage === "fallen")) continue;
    result.push({
      asset,
      days: Math.min(...stages.map((item) => item.days)),
      note: firstLine(cards.find((card) => card.note.trim())?.note ?? ""),
      cardIds: cards.map((card) => card.id),
    });
  }
  return result.sort((a, b) => b.days - a.days);
}

export function sweepDue(lastSweepAt: number | null, now: number): boolean {
  return lastSweepAt !== null && now - lastSweepAt >= sweepIntervalDays * dayMs;
}

export function firstLine(text: string): string {
  return text.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

// 원래 하위 경로를 상자 안에서도 유지합니다. 이름이 겹치면 "이름 (2).확장자"로 피합니다.
export function boxPathCandidate(fromPath: string, attempt: number): string {
  const parts = fromPath.split("/");
  const name = parts.pop() ?? fromPath;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const fileName = attempt <= 1 ? name : `${base} (${attempt})${ext}`;
  return [boxFolderName, ...parts, fileName].join("/");
}

export function isInBox(relativePath: string): boolean {
  return relativePath === boxFolderName || relativePath.startsWith(`${boxFolderName}/`);
}

export function normalizeCare(value: unknown, projectId: string): CareRecord {
  const base = defaultCare(projectId);
  if (!value || typeof value !== "object") return base;
  const record = value as Partial<CareRecord>;
  const days = (input: unknown, fallback: number) => (Number.isInteger(input) && (input as number) >= 0 && (input as number) <= 365 ? (input as number) : fallback);
  const touched: Record<string, number> = {};
  for (const [id, at] of Object.entries(record.touched ?? {})) if (typeof at === "number" && Number.isFinite(at)) touched[id] = at;
  const boxed: Record<string, BoxEntry> = {};
  for (const [id, entry] of Object.entries(record.boxed ?? {})) {
    if (entry && typeof entry.fromPath === "string" && typeof entry.boxPath === "string" && ["moving-in", "boxed", "moving-out", "virtual"].includes(entry.state)) {
      boxed[id] = { state: entry.state, fromPath: entry.fromPath, boxPath: entry.boxPath, at: Number(entry.at) || 0 };
    }
  }
  return {
    key: base.key,
    enabled: typeof record.enabled === "boolean" ? record.enabled : base.enabled,
    resting: typeof record.resting === "boolean" ? record.resting : base.resting,
    tiltAfterDays: days(record.tiltAfterDays, base.tiltAfterDays),
    fallAfterDays: days(record.fallAfterDays, base.fallAfterDays),
    touched,
    pinned: Array.isArray(record.pinned) ? record.pinned.filter((id): id is string => typeof id === "string") : [],
    boxed,
    budgetBytes: positive(record.budgetBytes),
    budgetNoticeAt: positive(record.budgetNoticeAt),
  };
}

function positive(input: unknown): number | null {
  return typeof input === "number" && Number.isFinite(input) && input > 0 ? Math.round(input) : null;
}

// ── 물건 크기와 방 용량 (FR16) ──
const MB = 1024 ** 2;
export const GB = 1024 ** 3;
// 로그 구간이라 4GB 영상 하나가 나머지를 가리지 않습니다. 1024 기준이라 formatByteSize 글자와 단계가 맞습니다.
const stepEdges = [MB, 10 * MB, 100 * MB, GB];
const iconScales = [1, 1.15, 1.3, 1.5, 1.75];
const cardSizes = [[240, 180], [260, 195], [290, 218], [330, 248], [380, 285]];

export function sizeStep(bytes: number): number {
  return stepEdges.filter((edge) => bytes >= edge).length + 1;
}

export function iconScale(bytes: number): number {
  return iconScales[sizeStep(bytes) - 1];
}

// 처음 놓을 때만 씁니다. 이미 놓인 카드는 사용자가 정한 크기를 그대로 둡니다. 메모 카드는 1단계입니다.
export function defaultCardSize(bytes: number | null): { width: number; height: number } {
  const [width, height] = cardSizes[sizeStep(bytes ?? 0) - 1];
  return { width, height };
}

export type RoomUsage = { totalBytes: number; boxBytes: number; exact: boolean };

// 스캔으로 확인한 파일만 같은 자료 한 번씩 셉니다. 상자 안 파일도 아직 폴더에 있으니 합계에 넣고 따로 보여줍니다.
export function roomUsage(assets: Asset[], root: RootRecord | null, care: CareRecord | null): RoomUsage {
  const seen = new Set<string>();
  let totalBytes = 0;
  let boxBytes = 0;
  for (const asset of assets) {
    if (seen.has(asset.id) || asset.availability === "missing") continue;
    seen.add(asset.id);
    totalBytes += asset.size;
    if (isInBox(asset.relativePath) || care?.boxed[asset.id]) boxBytes += asset.size;
  }
  return { totalBytes, boxBytes, exact: Boolean(root?.scan?.complete && root.scan.failed === 0) };
}

export type BudgetLevel = "unset" | "partial" | "ok" | "near" | "over";

// 부분 스캔은 실제보다 작게 보이므로 경고하지 않습니다(AC34).
export function budgetLevel(usage: RoomUsage, budgetBytes: number | null): BudgetLevel {
  if (!usage.exact) return "partial";
  if (budgetBytes === null) return "unset";
  const ratio = usage.totalBytes / budgetBytes;
  return ratio >= 1 ? "over" : ratio >= 0.8 ? "near" : "ok";
}

export function budgetNoticeDue(usage: RoomUsage, care: CareRecord, now: number): boolean {
  return budgetLevel(usage, care.budgetBytes) === "over" && (care.budgetNoticeAt === null || now - care.budgetNoticeAt >= sweepIntervalDays * dayMs);
}

// 지금 용량 × 1.5를 GB 단위로 반올림합니다. 1GB 아래 방도 1GB부터 제안합니다.
export function suggestBudget(totalBytes: number): number {
  return Math.max(1, Math.round((totalBytes * 1.5) / GB)) * GB;
}

export const budgetPresets = [GB, 5 * GB, 20 * GB];
