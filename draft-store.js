(function (root) {
  'use strict';
  function create(storage) {
    let owner = '';
    function clear() {
      const keys = [];
      for (let i = 0; i < storage.length; i++) keys.push(storage.key(i));
      keys.filter(k => /^(er2-draft-|er2-request-|er2-private:)/.test(k || '')).forEach(k => storage.removeItem(k));
      storage.removeItem('er2-draft-owner');
      owner = '';
    }
    function bind(id) {
      id = String(id || '');
      if (!id) { clear(); return; }
      if (storage.getItem('er2-draft-owner') !== id) clear();
      owner = id;
      storage.setItem('er2-draft-owner', id);
      // Remove pre-migration drafts: their owner cannot be established.
      const keys = [];
      for (let i = 0; i < storage.length; i++) keys.push(storage.key(i));
      keys.filter(k => /^(er2-draft-|er2-request-)/.test(k || '') && k !== 'er2-draft-owner').forEach(k => storage.removeItem(k));
    }
    function key(kind, scope) {
      if (!owner || !scope) return '';
      return 'er2-private:' + encodeURIComponent(owner) + ':' + encodeURIComponent(kind) + ':' + encodeURIComponent(scope);
    }
    return { clear, bind, key,
      get(kind, scope) { const k = key(kind, scope); return k ? storage.getItem(k) : null; },
      set(kind, scope, value) { const k = key(kind, scope); if (k) storage.setItem(k, value); },
      remove(kind, scope) { const k = key(kind, scope); if (k) storage.removeItem(k); }
    };
  }
  root.ER2DraftStore = { create };
})(typeof window === 'undefined' ? globalThis : window);
