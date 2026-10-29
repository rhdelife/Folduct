import { fail, ok, type Result } from "../domain/result";
import { createSchema, DATABASE_NAME, SCHEMA_VERSION, schemaComplete } from "./schema";

export function openDatabase(name = DATABASE_NAME): Promise<Result<IDBDatabase>> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: Result<IDBDatabase>) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const request = indexedDB.open(name, SCHEMA_VERSION);
    request.onupgradeneeded = (event) => {
      if (event.oldVersion !== 0) {
        request.transaction?.abort();
        finish(fail("schema-mismatch", "지원하지 않는 저장소 버전입니다. 기존 데이터는 유지됩니다."));
        return;
      }
      try {
        createSchema(request.result);
      } catch {
        request.transaction?.abort();
        finish(fail("schema-mismatch", "저장소 구조를 만들지 못했습니다. 기존 데이터는 유지됩니다."));
      }
    };
    request.onerror = () => {
      const error = request.error;
      const higherVersion = error?.name === "VersionError";
      finish(
        fail(
          "schema-mismatch",
          higherVersion
            ? "이미 더 높은 버전의 저장소가 있습니다. 기존 데이터는 지우지 않았습니다."
            : "저장소를 열지 못했습니다. 기존 데이터는 지우지 않았습니다.",
        ),
      );
    };
    request.onsuccess = () => {
      const db = request.result;
      if (!schemaComplete(db)) {
        db.close();
        finish(fail("schema-mismatch", "저장소 구조가 예상과 다릅니다. 기존 데이터는 유지됩니다."));
        return;
      }
      finish(ok(db));
    };
  });
}
