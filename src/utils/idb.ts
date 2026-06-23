export interface IDBOpenOptions {
  onUpgradeNeeded?: (db: IDBDatabase, event: IDBVersionChangeEvent) => void;
  onBlocked?: (event: Event) => void;
}

/**
 * Opens an IndexedDB connection and wraps the request in a Promise.
 */
export function openDB(
  name: string,
  version: number,
  options?: IDBOpenOptions,
): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, version);

    if (options?.onUpgradeNeeded) {
      request.onupgradeneeded = (event) => {
        options.onUpgradeNeeded!(request.result, event);
      };
    }

    if (options?.onBlocked) {
      request.onblocked = (event) => {
        options.onBlocked!(event);
      };
    }

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Wraps a standard IDBRequest in a Promise.
 */
export function wrapRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Runs a transaction on the database and resolves when the transaction completes.
 */
export function runTransaction(
  db: IDBDatabase,
  storeNames: string | string[],
  mode: IDBTransactionMode,
  callback: (tx: IDBTransaction) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    callback(tx);
  });
}
