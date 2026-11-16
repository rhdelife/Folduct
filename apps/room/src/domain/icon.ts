import { ductShapeCount, faceFrames, type FaceExpr } from "../art/duct";
import { faceColors } from "./face";

// 사용자가 만든 아이콘. 그림은 저장하지 않고 프로도 펜의 부품 번호만 둬요. 그래서 누가 만들어도 프로도 그림체예요.
export type DuctIcon = { id: string; name: string; shape: number; color: number; length: number; expr: FaceExpr; at: number };

// 고를 수 있는 표정. 눈 깜빡임처럼 움직일 때만 쓰는 칸은 뺐어요.
export const iconExprs: { expr: FaceExpr; label: string }[] = [
  { expr: "base", label: "기본" },
  { expr: "happy", label: "웃음" },
  { expr: "sleepy", label: "졸림" },
  { expr: "wide", label: "놀람" },
  { expr: "worried", label: "걱정" },
  { expr: "tilt", label: "갸웃" },
  { expr: "lookR", label: "옆보기" },
  { expr: "shut", label: "눈 감음" },
];

export const iconNameMax = 20;
export const iconLimit = 200;

// 방 썸네일로 고른 아이콘의 자리. 방 cover 칸에 이 모양으로 넣어요.
export const iconCoverId = (id: string) => `icon:${id}`;
export const iconOfCover = (cover: string | null | undefined): string | null => (cover?.startsWith("icon:") ? cover.slice(5) : null);

export const newIcon = (id: string, at: number): DuctIcon => ({ id, name: "", shape: 0, color: 0, length: 0.6, expr: "happy", at });

const inRange = (value: unknown, count: number): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) < count;

// 저장소에서 읽은 값은 믿지 않아요. 망가진 칸은 버리거나 기본값으로 돌려요.
export function normalizeIcons(value: unknown): DuctIcon[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((raw): DuctIcon[] => {
    const icon = (raw ?? {}) as Partial<DuctIcon>;
    if (typeof icon.id !== "string" || !icon.id || seen.has(icon.id)) return [];
    seen.add(icon.id);
    const length = typeof icon.length === "number" && Number.isFinite(icon.length) ? Math.min(1, Math.max(0, icon.length)) : 0.6;
    return [{
      id: icon.id,
      name: typeof icon.name === "string" ? icon.name.trim().slice(0, iconNameMax) : "",
      shape: inRange(icon.shape, ductShapeCount) ? icon.shape : 0,
      color: inRange(icon.color, faceColors.length) ? icon.color : 0,
      length,
      expr: faceFrames.includes(icon.expr as FaceExpr) ? (icon.expr as FaceExpr) : "base",
      at: typeof icon.at === "number" && Number.isFinite(icon.at) ? icon.at : 0,
    }];
  }).slice(0, iconLimit);
}
