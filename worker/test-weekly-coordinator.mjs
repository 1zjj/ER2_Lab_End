import { WeeklyWriteCoordinator } from './src/weekly-coordinator.js';

// In-process adapter for existing mocked Feishu regression suites. Production
// always requires the Cloudflare namespace; no production in-memory fallback.
export function mockWeeklyCoordinator(env) {
  const instances = new Map(), stores = new Map();
  return {
    idFromName: name => name,
    get(id) {
      if (!instances.has(id)) {
        if (!stores.has(id)) stores.set(id, new Map());
        const map = stores.get(id);
        const storage = { get: async key => structuredClone(map.get(key)),
          put: async (key, value) => { map.set(key, structuredClone(value)); },
          delete: async key => map.delete(key) };
        instances.set(id, new WeeklyWriteCoordinator({ storage }, env));
      }
      return instances.get(id);
    },
    restart() { instances.clear(); },
    stores
  };
}
