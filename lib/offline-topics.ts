import type { KnowledgePoint, Topic } from "./types";

export type OfflineTopic = { key: string; userId: string; topic: Topic; categoryName: string; points: KnowledgePoint[]; savedAt: string };

const DATABASE = "interview-master-offline";
const STORE = "topics";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function read<T>(operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = operation(database.transaction(STORE, "readonly").objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
}

async function write(operation: (store: IDBObjectStore) => void): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      operation(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { database.close(); }
}

export function saveOfflineTopic(userId: string, topic: Topic, categoryName: string, points: KnowledgePoint[]): Promise<void> {
  return write(store => store.put({ key: `${userId}:${topic.id}`, userId, topic, categoryName, points, savedAt: new Date().toISOString() } satisfies OfflineTopic));
}

export function getOfflineTopic(userId: string, topicId: string): Promise<OfflineTopic | undefined> {
  return read(store => store.get(`${userId}:${topicId}`));
}

export async function listOfflineTopics(userId: string): Promise<OfflineTopic[]> {
  const all = await read<OfflineTopic[]>(store => store.getAll());
  return all.filter(item => item.userId === userId);
}

export async function listOfflineTopicIds(userId: string): Promise<string[]> {
  const keys = await read<IDBValidKey[]>(store => store.getAllKeys());
  const prefix = `${userId}:`;
  return keys.filter((key): key is string => typeof key === "string" && key.startsWith(prefix)).map(key => key.slice(prefix.length));
}

export function removeOfflineTopic(userId: string, topicId: string): Promise<void> {
  return write(store => store.delete(`${userId}:${topicId}`));
}
