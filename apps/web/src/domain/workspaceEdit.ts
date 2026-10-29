import { absoluteOrigin, releaseZone, screenToLogical, translateZone, type Point } from "./coordinates";
import { createId } from "./ids";
import { limits } from "./limits";
import type { Card, Viewport, Workspace, Zone } from "./models";
import { textLength } from "./text";
import { normalizeWorkspace } from "./validation";

export type EditResult = { ok: true; workspace: Workspace } | { ok: false; message: string };

type Placed = { zoneId: string | null; x: number; y: number };

export function pointerDeltaToLogical(dx: number, dy: number, scale: number): Point {
  return screenToLogical({ x: dx, y: dy }, { x: 0, y: 0, scale });
}

export function placeCard(workspace: Workspace, input: { assetId: string | null; title: string; at: Point; size?: { width: number; height: number } }): EditResult {
  if (workspace.cards.length >= limits.cards) return { ok: false, message: "카드는 100개까지 놓을 수 있습니다." };
  const { width, height } = input.size ?? { width: limits.cardDefaultWidth, height: limits.cardDefaultHeight };
  const placed = locate(workspace.zones, input.at, width, height);
  if (!placed) return { ok: false, message: "카드를 작업면 안에 놓을 자리가 없습니다." };
  const card: Card = {
    id: createId(),
    assetId: input.assetId,
    title: clampTitle(input.title),
    note: "",
    zoneId: placed.zoneId,
    x: placed.x,
    y: placed.y,
    width,
    height,
    zIndex: nextZ(workspace.cards),
  };
  return accept(workspace, { ...workspace, cards: [...workspace.cards, card], selectedCardId: card.id });
}

export function moveCard(workspace: Workspace, cardId: string, absolute: Point): EditResult {
  const card = findCard(workspace, cardId);
  if (!card) return { ok: false, message: "카드를 찾지 못했습니다." };
  const placed = locate(workspace.zones, absolute, card.width, card.height);
  if (!placed) return { ok: false, message: "카드가 작업면을 벗어납니다." };
  return replaceCard(workspace, { ...card, zoneId: placed.zoneId, x: placed.x, y: placed.y });
}

export function nudgeCard(workspace: Workspace, cardId: string, dx: number, dy: number): EditResult {
  const card = findCard(workspace, cardId);
  if (!card) return { ok: false, message: "카드를 찾지 못했습니다." };
  const origin = absoluteOrigin(card, workspace.zones);
  if (!origin) return { ok: false, message: "카드 위치를 계산할 수 없습니다." };
  return moveCard(workspace, cardId, { x: origin.x + dx, y: origin.y + dy });
}

export function resizeCard(workspace: Workspace, cardId: string, size: { width: number; height: number }): EditResult {
  const card = findCard(workspace, cardId);
  if (!card) return { ok: false, message: "카드를 찾지 못했습니다." };
  const origin = absoluteOrigin(card, workspace.zones);
  if (!origin) return { ok: false, message: "카드 위치를 계산할 수 없습니다." };
  const width = clamp(size.width, limits.cardMinWidth, Math.min(limits.cardMaxWidth, limits.workspaceWidth - origin.x));
  const height = clamp(size.height, limits.cardMinHeight, Math.min(limits.cardMaxHeight, limits.workspaceHeight - origin.y));
  if (width < limits.cardMinWidth || height < limits.cardMinHeight) return { ok: false, message: "이 위치에서는 카드를 더 키울 수 없습니다." };
  return replaceCard(workspace, { ...card, width, height });
}

export function moveCardToZone(workspace: Workspace, cardId: string, zoneId: string | null): EditResult {
  const card = findCard(workspace, cardId);
  if (!card) return { ok: false, message: "카드를 찾지 못했습니다." };
  if (zoneId === null) {
    const origin = absoluteOrigin(card, workspace.zones);
    if (!origin) return { ok: false, message: "카드 위치를 계산할 수 없습니다." };
    return replaceCard(workspace, { ...card, zoneId: null, x: origin.x, y: origin.y });
  }
  const zone = workspace.zones.find((item) => item.id === zoneId);
  if (!zone) return { ok: false, message: "영역을 찾지 못했습니다." };
  const x = Math.min(24, Math.max(0, zone.width - card.width));
  const y = Math.min(24, Math.max(0, zone.height - card.height));
  return replaceCard(workspace, { ...card, zoneId, x, y });
}

export function setCardText(workspace: Workspace, cardId: string, patch: { title?: string; note?: string }): EditResult {
  const card = findCard(workspace, cardId);
  if (!card) return { ok: false, message: "카드를 찾지 못했습니다." };
  const title = patch.title === undefined ? card.title : clampTitle(patch.title);
  const note = patch.note === undefined ? card.note : Array.from(patch.note).slice(0, limits.note).join("");
  return replaceCard(workspace, { ...card, title, note });
}

export function removeCard(workspace: Workspace, cardId: string): EditResult {
  const card = findCard(workspace, cardId);
  if (!card) return { ok: false, message: "카드를 찾지 못했습니다." };
  return accept(workspace, {
    ...workspace,
    cards: workspace.cards.filter((item) => item.id !== cardId),
    selectedCardId: workspace.selectedCardId === cardId ? null : workspace.selectedCardId,
  });
}

export function restoreCard(workspace: Workspace, card: Card, absolute: Point | null = null): EditResult {
  if (workspace.cards.length >= limits.cards) return { ok: false, message: "카드는 100개까지 놓을 수 있습니다." };
  if (workspace.cards.some((item) => item.id === card.id)) return { ok: false, message: "이미 작업면에 있는 카드입니다." };
  const zoneMissing = card.zoneId !== null && !workspace.zones.some((zone) => zone.id === card.zoneId);
  const candidate = zoneMissing ? { ...card, zoneId: null, x: absolute?.x ?? card.x, y: absolute?.y ?? card.y } : card;
  const origin = zoneMissing ? { x: candidate.x, y: candidate.y } : absoluteOrigin(candidate, workspace.zones);
  const placed = origin ? locate(workspace.zones, origin, candidate.width, candidate.height) : null;
  if (!placed) return { ok: false, message: "빼낸 카드를 다시 놓을 자리가 없습니다." };
  return accept(workspace, {
    ...workspace,
    cards: [...workspace.cards, { ...candidate, zoneId: placed.zoneId, x: placed.x, y: placed.y }],
    selectedCardId: card.id,
  });
}

export function bringCard(workspace: Workspace, cardId: string, direction: "front" | "back"): EditResult {
  const card = findCard(workspace, cardId);
  if (!card) return { ok: false, message: "카드를 찾지 못했습니다." };
  const ordered = [...workspace.cards].sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
  const index = ordered.findIndex((item) => item.id === cardId);
  const swap = direction === "front" ? index + 1 : index - 1;
  if (swap < 0 || swap >= ordered.length) return { ok: true, workspace };
  const next = [...ordered];
  const [item] = next.splice(index, 1);
  next.splice(swap, 0, item);
  const zOf = new Map(next.map((entry, order) => [entry.id, order + 1]));
  return accept(workspace, {
    ...workspace,
    cards: workspace.cards.map((entry) => ({ ...entry, zIndex: zOf.get(entry.id) ?? entry.zIndex })),
  });
}

export function renameZone(workspace: Workspace, zoneId: string, title: string): EditResult {
  const trimmed = title.trim();
  if (textLength(trimmed) < 1 || textLength(trimmed) > limits.zoneTitle) {
    return { ok: false, message: "영역 이름은 1~80자입니다." };
  }
  if (!workspace.zones.some((zone) => zone.id === zoneId)) return { ok: false, message: "영역을 찾지 못했습니다." };
  return accept(workspace, {
    ...workspace,
    zones: workspace.zones.map((zone) => (zone.id === zoneId ? { ...zone, title: trimmed } : zone)),
  });
}

export function moveZone(workspace: Workspace, zoneId: string, dx: number, dy: number): EditResult {
  const zone = workspace.zones.find((item) => item.id === zoneId);
  if (!zone) return { ok: false, message: "영역을 찾지 못했습니다." };
  const delta = clampZoneDelta(zone, workspace.cards, dx, dy);
  return accept(workspace, {
    ...workspace,
    zones: workspace.zones.map((item) => (item.id === zoneId ? translateZone(item, delta.x, delta.y) : item)),
  });
}

export function deleteZone(workspace: Workspace, zoneId: string): EditResult {
  if (!workspace.zones.some((zone) => zone.id === zoneId)) return { ok: false, message: "영역을 찾지 못했습니다." };
  const released = releaseZone(workspace.cards, workspace.zones, zoneId);
  return accept(workspace, { ...workspace, cards: released.cards, zones: released.zones });
}

export function addZone(workspace: Workspace, title: string): EditResult {
  if (workspace.zones.length >= limits.zones) return { ok: false, message: "영역은 8개까지 만들 수 있습니다." };
  const trimmed = title.trim();
  if (textLength(trimmed) < 1 || textLength(trimmed) > limits.zoneTitle) return { ok: false, message: "영역 이름은 1~80자입니다." };
  const zone: Zone = { id: createId(), title: trimmed, x: 48, y: 48, width: 480, height: 360 };
  return accept(workspace, { ...workspace, zones: [...workspace.zones, zone] });
}

export function setNextAction(workspace: Workspace, nextAction: string): EditResult {
  return accept(workspace, { ...workspace, nextAction: Array.from(nextAction).slice(0, limits.nextAction).join("") });
}

export function setMediaPosition(workspace: Workspace, assetId: string, seconds: number): EditResult {
  if (!Number.isFinite(seconds) || seconds < 0) return { ok: false, message: "재생 위치는 0 이상의 숫자여야 합니다." };
  const mediaPositions = [
    ...workspace.mediaPositions.filter((item) => item.assetId !== assetId),
    { assetId, seconds },
  ];
  return accept(workspace, { ...workspace, mediaPositions });
}

export function setViewport(workspace: Workspace, viewport: Viewport): EditResult {
  const scale = clamp(viewport.scale, limits.minZoom, limits.maxZoom);
  return accept(workspace, { ...workspace, viewport: { x: viewport.x, y: viewport.y, scale } });
}

export function focusViewport(workspace: Workspace, cardId: string): Viewport | null {
  const card = findCard(workspace, cardId);
  if (!card) return null;
  const origin = absoluteOrigin(card, workspace.zones);
  if (!origin) return null;
  return {
    ...workspace.viewport,
    x: Math.max(0, origin.x - 48),
    y: Math.max(0, origin.y - 48),
  };
}

export function matchesQuery(query: string, parts: string[]): boolean {
  const tokens = query.toLocaleLowerCase("ko-KR").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = parts.join(" ").toLocaleLowerCase("ko-KR").replace(/\s+/g, " ");
  return tokens.every((token) => haystack.includes(token));
}

function accept(current: Workspace, next: Workspace): EditResult {
  const normalized = normalizeWorkspace(next, current.projectId);
  if (!normalized.ok) return { ok: false, message: normalized.error.message };
  return { ok: true, workspace: normalized.value };
}

function replaceCard(workspace: Workspace, card: Card): EditResult {
  return accept(workspace, {
    ...workspace,
    cards: workspace.cards.map((item) => (item.id === card.id ? card : item)),
  });
}

function findCard(workspace: Workspace, cardId: string): Card | undefined {
  return workspace.cards.find((card) => card.id === cardId);
}

function locate(zones: Zone[], absolute: Point, width: number, height: number): Placed | null {
  const x = clamp(absolute.x, 0, limits.workspaceWidth - width);
  const y = clamp(absolute.y, 0, limits.workspaceHeight - height);
  if (width > limits.workspaceWidth || height > limits.workspaceHeight) return null;
  const zone = [...zones].reverse().find((item) => x >= item.x && y >= item.y && x < item.x + item.width && y < item.y + item.height);
  if (!zone) return { zoneId: null, x, y };
  return { zoneId: zone.id, x: x - zone.x, y: y - zone.y };
}

function clampZoneDelta(zone: Zone, cards: Card[], dx: number, dy: number): Point {
  const members = cards.filter((card) => card.zoneId === zone.id);
  let minX = -zone.x;
  let maxX = limits.workspaceWidth - zone.width - zone.x;
  let minY = -zone.y;
  let maxY = limits.workspaceHeight - zone.height - zone.y;
  for (const card of members) {
    maxX = Math.min(maxX, limits.workspaceWidth - card.width - zone.x - card.x);
    maxY = Math.min(maxY, limits.workspaceHeight - card.height - zone.y - card.y);
  }
  return { x: clamp(dx, minX, maxX), y: clamp(dy, minY, maxY) };
}

function nextZ(cards: Card[]): number {
  return Math.min(limits.maxZIndex, cards.reduce((max, card) => Math.max(max, card.zIndex), 0) + 1);
}

function clampTitle(value: string): string {
  return Array.from(value.trim()).slice(0, limits.cardTitle).join("");
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}
