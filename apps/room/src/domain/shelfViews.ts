import { kindLabels, type Kind } from "./model";

// 홈 서랍장의 나누기. 형식별 서랍은 이름·담을 형식을 고치거나 더하고 뺄 수 있고, 사용자가 새 보기(서랍장)를 만들 수도 있어요.
// 서랍은 Folduct 안의 분류일 뿐이라 실제 폴더·파일은 그대로예요. 서랍마다 형식을 골라 두면 그 형식 파일이 저절로 모여요.
export type Drawer = { id: string; name: string; kinds: Kind[] };
export type ShelfView = { id: string; name: string; drawers: Drawer[] };
// kind가 null이면 기본 형식별 서랍(palette colorGroups)을 써요.
export type ShelfViews = { kind: Drawer[] | null; custom: ShelfView[] };

export const allKinds = Object.keys(kindLabels) as Kind[];
export const shelfNameMax = 20;
export const emptyShelfViews: ShelfViews = { kind: null, custom: [] };

const text = (value: unknown, fallback: string) => (typeof value === "string" && value.trim() ? value.trim().slice(0, shelfNameMax) : fallback);

// 같은 판 안에서 이름이 겹치지 않게 뒤에 숫자를 붙여요. 서랍을 이름으로 구분해서예요.
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(name)) return name;
  for (let n = 2; ; n++) if (!used.has(`${name} ${n}`)) return `${name} ${n}`;
}

export function cleanDrawers(value: unknown): Drawer[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  return value.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const name = uniqueName(text(item.name, "서랍"), names);
    names.push(name);
    const kinds = Array.isArray(item.kinds) ? allKinds.filter((kind) => (item.kinds as unknown[]).includes(kind)) : [];
    return [{ id: typeof item.id === "string" && item.id ? item.id : `drawer-${index}`, name, kinds }];
  });
}

// 저장된 값이 깨졌거나 없으면 기본으로 돌아가요.
export function normalizeShelfViews(value: unknown): ShelfViews {
  if (!value || typeof value !== "object") return emptyShelfViews;
  const raw = value as Record<string, unknown>;
  const names: string[] = ["형식별", "컬러별"];
  const custom = Array.isArray(raw.custom)
    ? raw.custom.flatMap((view, index) => {
        if (!view || typeof view !== "object") return [];
        const item = view as Record<string, unknown>;
        const name = uniqueName(text(item.name, "새 서랍장"), names);
        names.push(name);
        return [{ id: typeof item.id === "string" && item.id && item.id !== "kind" && item.id !== "hue" ? item.id : `view-${index}`, name, drawers: cleanDrawers(item.drawers) }];
      })
    : [];
  return { kind: Array.isArray(raw.kind) ? cleanDrawers(raw.kind) : null, custom };
}
