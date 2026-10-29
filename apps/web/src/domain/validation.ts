import { absoluteOrigin } from "./coordinates";
import { isUuid } from "./ids";
import { limits } from "./limits";
import type {
  AssetKind,
  AssetManifestEntry,
  Availability,
  Card,
  MediaPosition,
  Scene,
  SourceMode,
  Viewport,
  Workspace,
  Zone,
} from "./models";
import { assetKinds, availabilityStates, sceneTypes, sourceModes } from "./models";
import { ephemeralPath } from "./persistable";
import { fail, ok, type Result } from "./result";
import { isFiniteNumber, textLength } from "./text";

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown): RecordValue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as RecordValue;
}

function exactKeys(record: RecordValue, keys: readonly string[]): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function trimmedText(value: unknown, max: number, label: string, allowEmpty: boolean): Result<string> {
  if (typeof value !== "string") return fail("invalid", `${label}은 문자열이어야 합니다.`);
  const trimmed = value.trim();
  const length = textLength(trimmed);
  if (!allowEmpty && length < 1) return fail("invalid", `${label}이 비어 있습니다.`);
  if (length > max) return fail("invalid", `${label}은 ${max}자까지 저장할 수 있습니다.`);
  return ok(trimmed);
}

function rawText(value: unknown, max: number, label: string): Result<string> {
  if (typeof value !== "string") return fail("invalid", `${label}은 문자열이어야 합니다.`);
  if (textLength(value) > max) return fail("invalid", `${label}은 ${max}자까지 저장할 수 있습니다.`);
  return ok(value);
}

export function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024) return false;
  if (value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:/.test(value)) return false;
  if (value.includes("\\") || value.includes("\0")) return false;
  const parts = value.split("/");
  if (parts.length > limits.maxDirectoryDepth + 1) return false;
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

export function normalizeProjectFields(input: {
  name: unknown;
  coverColor: unknown;
  deskPosition: unknown;
}): Result<{ name: string; coverColor: string; deskPosition: { x: number; y: number } }> {
  const name = trimmedText(input.name, limits.projectName, "프로젝트 이름", false);
  if (!name.ok) return name;
  const color = trimmedText(input.coverColor, limits.coverColor, "표지 색", false);
  if (!color.ok) return color;
  const position = asRecord(input.deskPosition);
  if (!position || !isFiniteNumber(position.x) || !isFiniteNumber(position.y)) {
    return fail("invalid", "책상 위치는 유한한 좌표여야 합니다.");
  }
  if (position.x < 0 || position.y < 0 || position.x > limits.deskWidth || position.y > limits.deskHeight) {
    return fail("invalid", "책상 위치는 1440 × 900 안에 있어야 합니다.");
  }
  return ok({ name: name.value, coverColor: color.value, deskPosition: { x: position.x, y: position.y } });
}

export function normalizeRootFields(input: { sourceMode: unknown; rootName: unknown }): Result<{ sourceMode: SourceMode; rootName: string }> {
  if (!sourceModes.includes(input.sourceMode as SourceMode)) return fail("invalid", "폴더 연결 방식이 올바르지 않습니다.");
  const rootName = trimmedText(input.rootName, limits.rootName, "폴더 이름", false);
  if (!rootName.ok) return rootName;
  return ok({ sourceMode: input.sourceMode as SourceMode, rootName: rootName.value });
}

export function normalizeAssetFields(input: {
  projectId: unknown;
  relativePath: unknown;
  displayName: unknown;
  kind: unknown;
  size: unknown;
  lastModified: unknown;
  availability: unknown;
}): Result<{
  projectId: string;
  relativePath: string;
  displayName: string;
  kind: AssetKind;
  size: number;
  lastModified: number;
  availability: Availability;
}> {
  if (!isUuid(input.projectId)) return fail("invalid", "프로젝트 ID가 올바르지 않습니다.");
  if (!isSafeRelativePath(input.relativePath)) return fail("invalid", "상대 경로만 저장할 수 있습니다.");
  const displayName = trimmedText(input.displayName, limits.displayName, "파일 이름", false);
  if (!displayName.ok) return displayName;
  if (!assetKinds.includes(input.kind as AssetKind)) return fail("invalid", "파일 종류가 올바르지 않습니다.");
  if (!isFiniteNumber(input.size) || input.size < 0) return fail("invalid", "파일 크기가 올바르지 않습니다.");
  if (!isFiniteNumber(input.lastModified) || input.lastModified < 0) return fail("invalid", "수정 시각이 올바르지 않습니다.");
  if (!availabilityStates.includes(input.availability as Availability)) return fail("invalid", "파일 상태가 올바르지 않습니다.");
  return ok({
    projectId: input.projectId,
    relativePath: input.relativePath,
    displayName: displayName.value,
    kind: input.kind as AssetKind,
    size: input.size,
    lastModified: input.lastModified,
    availability: input.availability as Availability,
  });
}

function rectInsideWorkspace(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && y >= 0 && x + width <= limits.workspaceWidth && y + height <= limits.workspaceHeight;
}

function readZone(value: unknown): Result<Zone> {
  const record = asRecord(value);
  if (!record || !exactKeys(record, ["id", "title", "x", "y", "width", "height"])) {
    return fail("invalid", "영역 형식이 올바르지 않습니다.");
  }
  if (!isUuid(record.id)) return fail("invalid", "영역 ID가 올바르지 않습니다.");
  const title = trimmedText(record.title, limits.zoneTitle, "영역 이름", false);
  if (!title.ok) return title;
  if (![record.x, record.y, record.width, record.height].every(isFiniteNumber)) {
    return fail("invalid", "영역 좌표는 유한한 숫자여야 합니다.");
  }
  const x = record.x as number;
  const y = record.y as number;
  const width = record.width as number;
  const height = record.height as number;
  if (width <= 0 || height <= 0 || !rectInsideWorkspace(x, y, width, height)) {
    return fail("invalid", "영역은 작업면 2400 × 1600 안에 있어야 합니다.");
  }
  return ok({ id: record.id, title: title.value, x, y, width, height });
}

function readCard(value: unknown, zones: Zone[]): Result<Card> {
  const record = asRecord(value);
  if (!record || !exactKeys(record, ["id", "assetId", "title", "note", "zoneId", "x", "y", "width", "height", "zIndex"])) {
    return fail("invalid", "카드 형식이 올바르지 않습니다.");
  }
  if (!isUuid(record.id)) return fail("invalid", "카드 ID가 올바르지 않습니다.");
  if (record.assetId !== null && !isUuid(record.assetId)) return fail("invalid", "자료 ID가 올바르지 않습니다.");
  if (record.zoneId !== null && !isUuid(record.zoneId)) return fail("invalid", "카드의 영역 ID가 올바르지 않습니다.");
  const title = trimmedText(record.title, limits.cardTitle, "카드 제목", true);
  if (!title.ok) return title;
  const note = rawText(record.note, limits.note, "이유 메모");
  if (!note.ok) return note;
  if (![record.x, record.y, record.width, record.height].every(isFiniteNumber)) {
    return fail("invalid", "카드 좌표는 유한한 숫자여야 합니다.");
  }
  const width = record.width as number;
  const height = record.height as number;
  if (
    width < limits.cardMinWidth ||
    height < limits.cardMinHeight ||
    width > limits.cardMaxWidth ||
    height > limits.cardMaxHeight
  ) {
    return fail("invalid", "카드 크기는 180 × 120부터 600 × 600까지입니다.");
  }
  if (!Number.isInteger(record.zIndex) || (record.zIndex as number) < 0 || (record.zIndex as number) > limits.maxZIndex) {
    return fail("invalid", "카드 순서가 올바르지 않습니다.");
  }
  const card: Card = {
    id: record.id,
    assetId: record.assetId as string | null,
    title: title.value,
    note: note.value,
    zoneId: record.zoneId as string | null,
    x: record.x as number,
    y: record.y as number,
    width,
    height,
    zIndex: record.zIndex as number,
  };
  if (card.zoneId !== null && !zones.some((zone) => zone.id === card.zoneId)) {
    return fail("invalid", "카드가 없는 영역을 가리킵니다.");
  }
  const origin = absoluteOrigin(card, zones);
  if (!origin) return fail("invalid", "카드 좌표를 계산할 수 없습니다.");
  if (card.zoneId !== null) {
    const zone = zones.find((item) => item.id === card.zoneId)!;
    if (card.x < 0 || card.y < 0 || card.x >= zone.width || card.y >= zone.height) {
      return fail("invalid", "영역 안 카드의 기준점은 그 영역 안에 있어야 합니다.");
    }
  }
  if (!rectInsideWorkspace(origin.x, origin.y, card.width, card.height)) {
    return fail("invalid", "카드는 작업면 안에 있어야 합니다.");
  }
  return ok(card);
}

function readViewport(value: unknown): Result<Viewport> {
  const record = asRecord(value);
  if (!record || !exactKeys(record, ["x", "y", "scale"])) return fail("invalid", "보기 위치 형식이 올바르지 않습니다.");
  if (!isFiniteNumber(record.x) || !isFiniteNumber(record.y) || !isFiniteNumber(record.scale)) {
    return fail("invalid", "보기 위치는 유한한 숫자여야 합니다.");
  }
  if (record.scale < limits.minZoom || record.scale > limits.maxZoom) {
    return fail("invalid", "확대율은 50%부터 150%까지입니다.");
  }
  return ok({ x: record.x, y: record.y, scale: record.scale });
}

function readMedia(value: unknown): Result<MediaPosition> {
  const record = asRecord(value);
  if (!record || !exactKeys(record, ["assetId", "seconds"])) return fail("invalid", "재생 위치 형식이 올바르지 않습니다.");
  if (!isUuid(record.assetId)) return fail("invalid", "재생 위치의 자료 ID가 올바르지 않습니다.");
  if (!isFiniteNumber(record.seconds) || record.seconds < 0) return fail("invalid", "재생 위치는 0 이상의 유한한 숫자여야 합니다.");
  return ok({ assetId: record.assetId, seconds: record.seconds });
}

export function normalizeWorkspace(value: unknown, projectId: string): Result<Workspace> {
  const leaked = ephemeralPath(value);
  if (leaked) return fail("invalid", "파일 원본, 미리보기 주소, 폴더 핸들은 작업면에 저장하지 않습니다.");
  const record = asRecord(value);
  if (
    !record ||
    !exactKeys(record, [
      "projectId",
      "revision",
      "zones",
      "cards",
      "nextAction",
      "viewport",
      "selectedCardId",
      "mediaPositions",
      "updatedAt",
    ])
  ) {
    return fail("invalid", "작업면 형식이 올바르지 않습니다.");
  }
  if (record.projectId !== projectId || !isUuid(projectId)) return fail("invalid", "작업면의 프로젝트가 일치하지 않습니다.");
  if (!Number.isInteger(record.revision) || (record.revision as number) < 1) return fail("invalid", "작업면 개정 번호가 올바르지 않습니다.");
  if (!Array.isArray(record.zones) || record.zones.length > limits.zones) return fail("limit", `영역은 ${limits.zones}개까지입니다.`);
  if (!Array.isArray(record.cards) || record.cards.length > limits.cards) return fail("limit", `카드는 ${limits.cards}개까지입니다.`);
  const zones: Zone[] = [];
  for (const item of record.zones) {
    const zone = readZone(item);
    if (!zone.ok) return zone;
    zones.push(zone.value);
  }
  if (new Set(zones.map((zone) => zone.id)).size !== zones.length) return fail("invalid", "영역 ID가 중복되었습니다.");
  const cards: Card[] = [];
  for (const item of record.cards) {
    const card = readCard(item, zones);
    if (!card.ok) return card;
    cards.push(card.value);
  }
  if (new Set(cards.map((card) => card.id)).size !== cards.length) return fail("invalid", "카드 ID가 중복되었습니다.");
  const nextAction = rawText(record.nextAction, limits.nextAction, "다음 행동");
  if (!nextAction.ok) return nextAction;
  const viewport = readViewport(record.viewport);
  if (!viewport.ok) return viewport;
  if (record.selectedCardId !== null && !cards.some((card) => card.id === record.selectedCardId)) {
    return fail("invalid", "선택한 카드가 작업면에 없습니다.");
  }
  if (!Array.isArray(record.mediaPositions)) return fail("invalid", "재생 위치 목록이 올바르지 않습니다.");
  const mediaPositions: MediaPosition[] = [];
  for (const item of record.mediaPositions) {
    const media = readMedia(item);
    if (!media.ok) return media;
    mediaPositions.push(media.value);
  }
  if (new Set(mediaPositions.map((item) => item.assetId)).size !== mediaPositions.length) {
    return fail("invalid", "같은 자료의 재생 위치가 중복되었습니다.");
  }
  if (!isFiniteNumber(record.updatedAt)) return fail("invalid", "작업면 수정 시각이 올바르지 않습니다.");
  return ok({
    projectId,
    revision: record.revision as number,
    zones,
    cards,
    nextAction: nextAction.value,
    viewport: viewport.value,
    selectedCardId: record.selectedCardId as string | null,
    mediaPositions,
    updatedAt: record.updatedAt,
  });
}

function readManifest(value: unknown): Result<AssetManifestEntry> {
  const record = asRecord(value);
  if (!record || !exactKeys(record, ["assetId", "relativePath", "displayName", "size", "lastModified"])) {
    return fail("invalid", "장면의 파일 기록이 올바르지 않습니다.");
  }
  if (!isUuid(record.assetId) || !isSafeRelativePath(record.relativePath)) return fail("invalid", "장면의 파일 경로가 올바르지 않습니다.");
  const displayName = trimmedText(record.displayName, limits.displayName, "파일 이름", false);
  if (!displayName.ok) return displayName;
  if (!isFiniteNumber(record.size) || record.size < 0 || !isFiniteNumber(record.lastModified) || record.lastModified < 0) {
    return fail("invalid", "장면의 파일 크기나 수정 시각이 올바르지 않습니다.");
  }
  return ok({
    assetId: record.assetId,
    relativePath: record.relativePath,
    displayName: displayName.value,
    size: record.size,
    lastModified: record.lastModified,
  });
}

export function normalizeScene(value: unknown): Result<Scene> {
  const leaked = ephemeralPath(value);
  if (leaked) return fail("invalid", "장면에는 파일 원본, 미리보기 주소, 폴더 핸들을 넣지 않습니다.");
  const record = asRecord(value);
  if (!record || !exactKeys(record, ["id", "projectId", "title", "type", "createdAt", "sourceRevision", "snapshot", "assetManifest"])) {
    return fail("invalid", "장면 형식이 올바르지 않습니다.");
  }
  if (!isUuid(record.id) || !isUuid(record.projectId)) return fail("invalid", "장면 ID가 올바르지 않습니다.");
  const title = trimmedText(record.title, limits.sceneTitle, "장면 이름", false);
  if (!title.ok) return title;
  if (!sceneTypes.includes(record.type as Scene["type"])) return fail("invalid", "장면 유형이 올바르지 않습니다.");
  if (!isFiniteNumber(record.createdAt)) return fail("invalid", "장면 생성 시각이 올바르지 않습니다.");
  if (!Number.isInteger(record.sourceRevision) || (record.sourceRevision as number) < 1) {
    return fail("invalid", "장면의 개정 번호가 올바르지 않습니다.");
  }
  const snapshot = normalizeWorkspace(record.snapshot, record.projectId);
  if (!snapshot.ok) return snapshot;
  if (!Array.isArray(record.assetManifest)) return fail("invalid", "장면의 파일 기록이 올바르지 않습니다.");
  const assetManifest: AssetManifestEntry[] = [];
  for (const item of record.assetManifest) {
    const entry = readManifest(item);
    if (!entry.ok) return entry;
    assetManifest.push(entry.value);
  }
  return ok({
    id: record.id,
    projectId: record.projectId,
    title: title.value,
    type: record.type as Scene["type"],
    createdAt: record.createdAt,
    sourceRevision: record.sourceRevision as number,
    snapshot: snapshot.value,
    assetManifest,
  });
}
