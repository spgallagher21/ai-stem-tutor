const DB_NAME = "studyloop-learning";
const DB_VERSION = 1;
const STORE_NAME = "artifacts";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open StudyLoop storage."));
  });
}

async function transact(mode, callback) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const request = callback(store);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("StudyLoop storage operation failed."));
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  });
}

export const artifactKey = (uid, kind, id) => `${uid}:${kind}:${id}`;

export async function saveArtifact(uid, kind, id, value) {
  const key = artifactKey(uid, kind, id);
  await transact("readwrite", (store) => store.put({ key, uid, kind, id, value, updatedAt: Date.now() }));
  return value;
}

export async function getArtifact(uid, kind, id) {
  const row = await transact("readonly", (store) => store.get(artifactKey(uid, kind, id)));
  return row?.value || null;
}

export async function listArtifacts(uid, kind) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result.filter((row) => row.uid === uid && (!kind || row.kind === kind)));
    request.onerror = () => reject(request.error || new Error("Could not list saved learning data."));
    tx.oncomplete = () => db.close();
  });
}

export async function deleteArtifacts(uid, { kind, idPrefix } = {}) {
  const rows = await listArtifacts(uid, kind);
  const targets = rows.filter((row) => !idPrefix || row.id.startsWith(idPrefix));
  await Promise.all(targets.map((row) => transact("readwrite", (store) => store.delete(row.key))));
}

export async function exportLearningData(uid) {
  const artifacts = await listArtifacts(uid);
  return { schemaVersion: 1, exportedAt: new Date().toISOString(), artifacts };
}

