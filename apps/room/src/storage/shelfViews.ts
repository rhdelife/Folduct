import { normalizeShelfViews, type ShelfViews } from "../domain/shelfViews";
import { run } from "./db";

// 서랍장 구성은 meta 저장소의 키 하나에 둬요. 저장소를 새로 만들지 않아 IndexedDB 판 번호는 그대로예요.
export async function getShelfViews(): Promise<ShelfViews> {
  return normalizeShelfViews(await run<unknown>("meta", "readonly", (store) => store.get("shelfViews")));
}

export function saveShelfViews(views: ShelfViews): Promise<unknown> {
  return run("meta", "readwrite", (store) => store.put(views, "shelfViews"));
}
