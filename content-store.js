const DB_NAME = "shelfmarkContentDb";
const DB_VERSION = 1;
const STORE_NAME = "contentRecords";

const memoryStore = new Map();

function clone(value) {
  if (value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function hasIndexedDb() {
  return typeof indexedDB !== "undefined";
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

let dbPromise = null;

async function openDatabase() {
  if (!hasIndexedDb()) {
    return null;
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB."));
    });
  }

  return dbPromise;
}

async function withStore(mode, callback) {
  const db = await openDatabase();
  if (!db) {
    return callback(null);
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);

    let settled = false;
    const finish = (fn) => (value) => {
      if (settled) {
        return;
      }
      settled = true;
      fn(value);
    };

    transaction.oncomplete = finish(resolve);
    transaction.onerror = finish(() => reject(transaction.error || new Error("IndexedDB transaction failed.")));
    transaction.onabort = finish(() => reject(transaction.error || new Error("IndexedDB transaction aborted.")));

    Promise.resolve(callback(store)).catch(finish(reject));
  });
}

export async function putContentRecord(record) {
  const entry = clone(record);

  if (!hasIndexedDb()) {
    memoryStore.set(entry.id, entry);
    return entry;
  }

  await withStore("readwrite", async (store) => {
    store.put(entry);
  });
  return entry;
}

export async function getContentRecord(id) {
  if (!id) {
    return null;
  }

  if (!hasIndexedDb()) {
    return clone(memoryStore.get(id) || null);
  }

  return withStore("readonly", async (store) => {
    const request = store.get(id);
    const result = await requestToPromise(request);
    return clone(result || null);
  });
}

export async function listContentRecords() {
  if (!hasIndexedDb()) {
    return [...memoryStore.values()].map(clone);
  }

  return withStore("readonly", async (store) => {
    const request = store.getAll();
    const result = await requestToPromise(request);
    return (result || []).map(clone);
  });
}

export async function deleteContentRecords(ids = []) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) {
    return;
  }

  if (!hasIndexedDb()) {
    for (const id of uniqueIds) {
      memoryStore.delete(id);
    }
    return;
  }

  await withStore("readwrite", async (store) => {
    for (const id of uniqueIds) {
      store.delete(id);
    }
  });
}
