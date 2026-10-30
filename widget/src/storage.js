/**
 * Privacy-conscious client storage manager
 * Uses sessionStorage by default so conversation continuity survives page refresh,
 * but terminates when the browser tab is closed.
 * Falling back to in-memory store if storage is blocked.
 */

class MemoryStore {
  constructor() {
    this.map = new Map();
  }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

function getSafeStorage(storageType = 'session') {
  try {
    const target = storageType === 'local' ? window.localStorage : window.sessionStorage;
    const testKey = '__storage_test__';
    target.setItem(testKey, testKey);
    target.removeItem(testKey);
    return target;
  } catch {
    return new MemoryStore();
  }
}

export class AssistantStorage {
  constructor(assistantId = 'default', storageType = 'session') {
    this.prefix = `ai_assistant_${assistantId}_`;
    this.store = getSafeStorage(storageType);
  }

  get(key, defaultValue = null) {
    try {
      const raw = this.store.getItem(this.prefix + key);
      return raw !== null ? JSON.parse(raw) : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  set(key, value) {
    try {
      this.store.setItem(this.prefix + key, JSON.stringify(value));
    } catch (err) {
      console.warn('AssistantStorage write failed:', err);
    }
  }

  remove(key) {
    try {
      this.store.removeItem(this.prefix + key);
    } catch {}
  }

  clear() {
    try {
      this.remove('conversation_id');
      this.remove('messages');
      this.remove('is_open');
    } catch {}
  }
}
