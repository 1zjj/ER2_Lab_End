import { executeWeeklyRequest, executeLiteratureRequest } from './index.js';
import { executePermissionSync, permissionAlarm } from './permission-sync.js';

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
    const path = new URL(request.url).pathname;
    // Read progress while an alarm scans Feishu. This is a fresh authenticated
    // storage read and never enters the mutation queue or shares report data.
    if(path==='/api/admin/permission-sync'&&request.method==='GET')return executePermissionSync(request,this.env,this.state.storage);
    const execute = path === '/api/admin/permission-sync' ? executePermissionSync : path === '/api/literature' ? executeLiteratureRequest : executeWeeklyRequest;
    const result = this.queue.then(() => execute(request, this.env, this.state.storage));
    this.queue = result.catch(() => {});
    return result;
  }
  alarm() {
    const result=this.queue.then(()=>permissionAlarm(this.state.storage,this.env));
    this.queue=result.catch(()=>{});
    return result;
  }
}
