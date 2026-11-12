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
    this.assistantId = assistantId;
    this.prefix = `ai_assistant_${assistantId}_`;
    this.store = getSafeStorage(storageType);
    this.sessionStore = storageType === 'session' ? this.store : getSafeStorage('session');
    this.userScope = 'guest_';
  }

  setUser(userId = null) {
    this.userScope = userId ? `usr_${String(userId).trim()}_` : 'guest_';
  }

  getUserScope() {
    return this.userScope;
  }

  _getKey(key) {
    if (key === 'hirepool_session' || key === 'is_open') {
      return `${this.prefix}${key}`;
    }
    return `${this.prefix}${this.userScope || ''}${key}`;
  }

  get(key, defaultValue = null) {
    try {
      const fullKey = this._getKey(key);
      let raw = this.store.getItem(fullKey);
      if (raw === null && this.userScope === 'guest_') {
        raw = this.store.getItem(this.prefix + key);
      }
      return raw !== null ? JSON.parse(raw) : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  set(key, value) {
    try {
      const fullKey = this._getKey(key);
      this.store.setItem(fullKey, JSON.stringify(value));
    } catch (err) {
      console.warn('AssistantStorage write failed:', err);
    }
  }

  remove(key) {
    try {
      const fullKey = this._getKey(key);
      this.store.removeItem(fullKey);
      if (this.userScope === 'guest_') {
        this.store.removeItem(this.prefix + key);
      }
    } catch {}
  }

  getConversationId() {
    return this.get('conversation_id', null);
  }

  saveConversationId(conversationId) {
    if (typeof conversationId === 'string' && conversationId.trim()) {
      this.set('conversation_id', conversationId.trim());
    } else {
      this.clearConversationId();
    }
  }

  clearConversationId() {
    this.remove('conversation_id');
  }

  /**
   * Persist only non-sensitive HirePool signup UI progress (`role_selection` or
   * `signup_form` step, selected role, consultancy type, and public agreement metadata)
   * in sessionStorage. Passwords, verification links/tokens, and auth credentials
   * are strictly excluded.
   *
   * @param {object|null} progress
   */
  saveSignupProgress(progress) {
    if (!progress || typeof progress !== 'object') {
      this.clearSignupProgress();
      return;
    }
    const allowedStates = new Set(['role_selection', 'signup_form']);
    const normalizedState = allowedStates.has(progress.state) ? progress.state : null;
    const normalizedRole = ['candidate', 'client', 'consultancy'].includes(progress.selectedRole)
      ? progress.selectedRole
      : null;

    if (!normalizedState) {
      this.clearSignupProgress();
      return;
    }

    const agreement = progress.agreement && typeof progress.agreement === 'object'
      ? {
          id: progress.agreement.id || progress.agreement.version_id || null,
          version: progress.agreement.version || null,
          role: progress.agreement.role || normalizedRole || null,
          title: progress.agreement.title || null,
          summary: progress.agreement.summary || null,
          effectiveDate: progress.agreement.effectiveDate || progress.agreement.effective_date || null
        }
      : null;

    const safePayload = {
      state: normalizedState,
      selectedRole: normalizedRole,
      consultancyType: typeof progress.consultancyType === 'string'
        ? progress.consultancyType.slice(0, 64)
        : null,
      agreement
    };

    try {
      const fullKey = this._getKey('hirepool_signup_progress');
      this.sessionStore.setItem(fullKey, JSON.stringify(safePayload));
    } catch (err) {
      console.warn('AssistantStorage signup progress write failed:', err);
    }
  }

  getSignupProgress() {
    try {
      const fullKey = this._getKey('hirepool_signup_progress');
      const raw = this.sessionStore.getItem(fullKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !['role_selection', 'signup_form'].includes(parsed.state)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  clearSignupProgress() {
    try {
      const fullKey = this._getKey('hirepool_signup_progress');
      this.sessionStore.removeItem(fullKey);
    } catch {}
  }

  clear() {
    try {
      this.clearConversationId();
      this.clearSignupProgress();
      this.remove('messages');
      this.remove('documents');
      this.remove('is_open');
    } catch {}
  }
}
