const DB_NAME = "ai-stem-tutor-pdfs";
const DB_VERSION = 1;
const STORE_NAME = "pdfs";

function openPdfDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open local PDF storage."));
  });
}

async function withStore(mode, callback) {
  const db = await openPdfDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    let result;
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("Local PDF storage failed."));
    };
    result = callback(store);
  });
}

export async function saveLocalPdf(record) {
  await withStore("readwrite", (store) => store.put(record));
}

export async function getLocalPdf(id) {
  const db = await openPdfDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => {
      db.close();
      resolve(request.result || null);
    };
    request.onerror = () => {
      db.close();
      reject(request.error || new Error("Could not read local PDF."));
    };
  });
}

export async function deleteLocalPdf(id) {
  await withStore("readwrite", (store) => store.delete(id));
}

export async function deleteLocalPdfsByPrefix(prefix) {
  const db = await openPdfDb();
  const ids = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAllKeys();
    request.onsuccess = () => resolve(request.result.filter((id) => String(id).startsWith(prefix)));
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
  await Promise.all(ids.map(deleteLocalPdf));
}

export function clearLocalPdfs() {
  return withStore("readwrite", (store) => store.clear());
}
