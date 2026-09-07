(function (root) {
  'use strict';

  // Browser preferences only. Never use these values for identity or access.
  function create(options) {
    const steps = options.steps.slice();
    const prefix = 'er2-member-guide:v1:' + encodeURIComponent(options.namespace || '') + ':';
    const memory = new Map();
    let owner = '';
    let persistent = true;
    function key(item) { return prefix + encodeURIComponent(owner) + ':' + item; }
    function local() {
      if (!memory.has(owner)) memory.set(owner, {});
      return memory.get(owner);
    }
    function get(item) {
      if (!owner) return false;
      if (persistent) {
        try { local()[item] = options.storage().getItem(key(item)) === '1'; }
        catch (_) { persistent = false; }
      }
      return local()[item] === true;
    }
    function set(item, value) {
      if (!owner) return false;
      local()[item] = value;
      if (persistent) {
        try { options.storage().setItem(key(item), value ? '1' : '0'); }
        catch (_) { persistent = false; }
      }
      return true;
    }
    return {
      bind(id) { owner = typeof id === 'string' ? id.trim() : ''; },
      read() {
        const completedSteps = steps.filter(get);
        const skipped = get('skip');
        return { completedSteps, completedCount: completedSteps.length, total: steps.length,
          completed: completedSteps.length === steps.length, skipped, persistent };
      },
      setStep(id, value) {
        if (!steps.includes(id) || typeof value !== 'boolean' || !owner) return false;
        // Separate keys let tabs update different items without replacing a snapshot.
        set(id, value);
        if (!value) set('skip', false);
        return true;
      },
      skip() { return set('skip', true); },
      ownsStorageKey(value) { return Boolean(owner && (value === null || (typeof value === 'string' && value.startsWith(prefix + encodeURIComponent(owner) + ':')))); }
    };
  }
  root.ER2GuideStore = { create };
})(typeof window === 'undefined' ? globalThis : window);
