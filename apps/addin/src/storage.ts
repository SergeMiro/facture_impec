// Where the session token lives (docs/OFFICE.md §4): OfficeRuntime.storage when the shared runtime
// offers it, else localStorage keyed with Office's partition key. Never the workbook's settings,
// which travel inside the .xlsx file.

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    get: async (key) => map.get(key) ?? null,
    set: async (key, value) => {
      map.set(key, value);
    },
    remove: async (key) => {
      map.delete(key);
    },
  };
}

function browserStore(prefix: string): KeyValueStore | null {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    return {
      get: async (key) => storage.getItem(prefix + key),
      set: async (key, value) => storage.setItem(prefix + key, value),
      remove: async (key) => storage.removeItem(prefix + key),
    };
  } catch {
    // Blocked storage (private window, strict settings): the session lasts as long as the pane.
    return null;
  }
}

export function tokenStore(): KeyValueStore {
  if (typeof OfficeRuntime !== 'undefined' && OfficeRuntime.storage) {
    const storage = OfficeRuntime.storage;
    return {
      get: (key) => storage.getItem(key),
      set: (key, value) => storage.setItem(key, value),
      remove: (key) => storage.removeItem(key),
    };
  }
  const partition = typeof Office !== 'undefined' ? (Office.context?.partitionKey ?? '') : '';
  return browserStore(`${partition}facture-impec:`) ?? memoryStore();
}
