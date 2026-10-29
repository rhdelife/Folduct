import { limits } from "./limits";
import type { AssetKind, DeskPosition } from "./models";
import { textLength } from "./text";

export const deskCard = { width: 260, height: 214 };

// 차 일러스트 팔레트: 올리브 찻잔, 테라코타 탁자, 우린 차, 짙은 손잡이, 녹차 티백, 황토
export const coverPalette = ["#36432a", "#b5623f", "#8f2c16", "#5e2413", "#7f8a52", "#a0794a"] as const;

const rasterExtensions = new Set(["png", "jpg", "jpeg", "webp", "gif"]);

export function clampDeskPosition(position: DeskPosition): DeskPosition {
  return {
    x: Math.min(limits.deskWidth - deskCard.width, Math.max(0, position.x)),
    y: Math.min(limits.deskHeight - deskCard.height, Math.max(0, position.y)),
  };
}

export function deskSlots(): DeskPosition[] {
  const columns = 4;
  const rows = 3;
  const gapX = 24;
  const gapY = 20;
  const gridWidth = columns * deskCard.width + (columns - 1) * gapX;
  const gridHeight = rows * deskCard.height + (rows - 1) * gapY;
  const originX = Math.round((limits.deskWidth - gridWidth) / 2);
  const originY = Math.round((limits.deskHeight - gridHeight) / 2);
  const slots: DeskPosition[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      slots.push({
        x: originX + column * (deskCard.width + gapX),
        y: originY + row * (deskCard.height + gapY),
      });
    }
  }
  return slots;
}

function overlaps(a: DeskPosition, b: DeskPosition): boolean {
  return (
    a.x < b.x + deskCard.width &&
    a.x + deskCard.width > b.x &&
    a.y < b.y + deskCard.height &&
    a.y + deskCard.height > b.y
  );
}

export function firstOpenDeskPosition(occupied: DeskPosition[]): DeskPosition | null {
  return deskSlots().find((slot) => occupied.every((item) => !overlaps(slot, item))) ?? null;
}

export function projectInitial(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toLocaleUpperCase("ko-KR") : "프";
}

export function defaultProjectName(rootName: string): string {
  const trimmed = rootName.trim();
  const chars = Array.from(trimmed);
  if (chars.length === 0) return "이름 없는 프로젝트";
  return chars.slice(0, limits.projectName).join("");
}

export function firstActionLine(value: string): string {
  const line = value.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return line;
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index + 1).toLowerCase() : "";
}

export function isCoverImage(file: { displayName: string; kind: AssetKind }): boolean {
  const extension = extensionOf(file.displayName);
  return file.kind === "image" && (rasterExtensions.has(extension) || extension === "svg");
}

export function defaultCoverPath(files: { relativePath: string; displayName: string; kind: AssetKind }[]): string | null {
  const images = files.filter(isCoverImage);
  const raster = images.find((file) => rasterExtensions.has(extensionOf(file.displayName)));
  return (raster ?? images[0])?.relativePath ?? null;
}

export function nameWithinLimit(name: string): boolean {
  const trimmed = name.trim();
  const length = textLength(trimmed);
  return length >= 1 && length <= limits.projectName;
}
