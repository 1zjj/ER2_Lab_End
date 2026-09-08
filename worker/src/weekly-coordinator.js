import { executeWeeklyRequest } from './index.js';

// One globally unique object per table/person (journals are partitioned by week). The promise queue is needed
// because outgoing Feishu fetches yield; Durable Object requests can interleave.
// The durable journal contains IDs and hashes only, never weekly-report text.
export class WeeklyWriteCoordinator {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.queue = Promise.resolve();
  }

  fetch(request) {
    if (request.method === 'GET' && new URL(request.url).pathname === '/_weekly-storage-check') {
      return this.state.storage.get('health').then(() => Response.json({ ok: true }));
    }
    const result = this.queue.then(() => executeWeeklyRequest(request, this.env, this.state.storage));
    this.queue = result.catch(() => {});
    return result;
  }
}
