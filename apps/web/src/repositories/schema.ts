export const SCHEMA_VERSION = 1;
export const DATABASE_NAME = "folduct";
export const DEMO_DATABASE_NAME = "folduct-demo";

export const stores = {
  projects: "projects",
  roots: "roots",
  rootHandles: "rootHandles",
  assets: "assets",
  workspaces: "workspaces",
  scenes: "scenes",
  settings: "settings",
  events: "events",
} as const;

export const requiredStores = Object.values(stores);

export function createSchema(db: IDBDatabase) {
  db.createObjectStore(stores.projects, { keyPath: "id" });

  const roots = db.createObjectStore(stores.roots, { keyPath: "id" });
  roots.createIndex("projectId", "projectId", { unique: false });

  db.createObjectStore(stores.rootHandles, { keyPath: "rootId" });

  const assets = db.createObjectStore(stores.assets, { keyPath: "id" });
  assets.createIndex("projectId", "projectId", { unique: false });
  assets.createIndex("projectPath", ["projectId", "relativePath"], { unique: true });

  db.createObjectStore(stores.workspaces, { keyPath: "projectId" });

  const scenes = db.createObjectStore(stores.scenes, { keyPath: "id" });
  scenes.createIndex("projectCreated", ["projectId", "createdAt"], { unique: false });

  db.createObjectStore(stores.settings, { keyPath: "key" });

  const events = db.createObjectStore(stores.events, { keyPath: "id" });
  events.createIndex("projectId", "projectId", { unique: false });
}

export function schemaComplete(db: IDBDatabase): boolean {
  if (db.version !== SCHEMA_VERSION) return false;
  if (!requiredStores.every((name) => db.objectStoreNames.contains(name))) return false;
  const tx = db.transaction(
    [stores.assets, stores.scenes, stores.roots, stores.events],
    "readonly",
  );
  const assets = tx.objectStore(stores.assets);
  const scenes = tx.objectStore(stores.scenes);
  const roots = tx.objectStore(stores.roots);
  const events = tx.objectStore(stores.events);
  return (
    assets.indexNames.contains("projectId") &&
    assets.indexNames.contains("projectPath") &&
    scenes.indexNames.contains("projectCreated") &&
    roots.indexNames.contains("projectId") &&
    events.indexNames.contains("projectId")
  );
}
