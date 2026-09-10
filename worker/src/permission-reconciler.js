// Durable permission reconciliation. A successful mutation is never evidence
// of effective access: observations and real-account acceptance are separate.
export const PERMISSION_SYNC_VERSION = 'permission-sync-v1';
export class PermissionReconciler {
  constructor(storage, adapter, now = () => Date.now()) {
    this.storage = storage; this.adapter = adapter; this.now = now;
  }
  async status() {
    return { version: PERMISSION_SYNC_VERSION, ...(await this.storage.get('permission:status') || { state: 'disabled' }),
      enabled: (await this.storage.get('permission:enabled')) === true, effectiveAccessCertified: false };
  }
  async record(value) {
    const previous = await this.storage.get('permission:status') || {};
    const next = { ...previous, ...value, checkedAt: new Date(this.now()).toISOString() };
    await this.storage.put('permission:status', next);
    const sequence = (await this.storage.get('permission:sequence') || 0) + 1;
    await this.storage.put('permission:sequence', sequence);
    await this.storage.put('permission:event:' + String(sequence).padStart(12, '0'), next);
    return this.status();
  }
  async enable() {
    // Validate the complete inventory before creating an active recurring task.
    const target = await this.adapter.target();
    if (!target.complete || target.issues.length) return this.record({ state: 'blocked', targetVersion: target.version, issues: target.issues });
    const previous=await this.status();
    const observation = this.adapter.observeBatch
      ? (previous.state==='inspected'&&previous.targetVersion===target.version
        ? await this.storage.get('permission:last-observation') : null)
      : await this.adapter.observe(target);
    if(!observation)return this.record({state:'blocked',issues:[{code:'FRESH_INSPECTION_REQUIRED'}],appliedVersion:null});
    if (!observation.complete || observation.issues.length) return this.record({ state: 'blocked', targetVersion: target.version, issues: observation.issues });
    await this.storage.put('permission:inventory', observation.inventory || []);
    await this.storage.put('permission:enabled', true);
    await this.storage.setAlarm(this.now() + 1000);
    return this.record({ state: 'queued', targetVersion: target.version, issues: [] });
  }
  async disable() {
    await this.storage.put('permission:enabled', false);
    await this.storage.delete('permission:inspect');
    await this.storage.delete('permission:scan');
    await this.storage.deleteAlarm();
    return this.record({ state: 'disabled' });
  }
  async inspect() {
    const target = await this.adapter.target();
    await this.record({state:'inspecting',targetVersion:target.version,resources:target.resources,issues:target.issues,
      plannedChanges:[],inventory:[],warnings:target.warnings||[],appliedVersion:null});
    const observation = target.complete && !target.issues.length ? await this.observe(target) : null;
    if(observation?.pending)return this.record({state:'inspecting',targetVersion:target.version,
      inventory:observation.inventory,issues:observation.issues,scannedNodes:observation.cursor.index,
      discoveredNodes:observation.cursor.pending.length,appliedVersion:null});
    return this.record({ state: target.complete && !target.issues.length && observation?.complete && !observation.issues.length ? 'inspected' : 'blocked',
      targetVersion: target.version, issues: [...target.issues, ...(observation?.issues || [])],
      resources: target.resources, inventory:observation?.inventory||[], warnings:target.warnings||[], plannedChanges: observation?.changes || [], appliedVersion: null });
  }
  async observe(target) {
    if(!this.adapter.observeBatch)return this.adapter.observe(target);
    const observation=await this.adapter.observeBatch(target,await this.storage.get('permission:scan'));
    if(observation.pending){
      await this.storage.put('permission:scan',observation.cursor);
      await this.storage.setAlarm(this.now()+1000);
    }else{
      await this.storage.delete('permission:scan');
      await this.storage.put('permission:last-observation',observation);
    }
    return observation;
  }
  async step() {
    if (!(await this.storage.get('permission:enabled'))) return this.status();
    // Install the recovery alarm before any network operation. A restart after
    // an ambiguous write always re-observes, never blindly replays the write.
    await this.storage.setAlarm(this.now() + 60000);
    try {
      const target = await this.adapter.target();
      if (!target.complete || target.issues.length) return this.record({ state: 'blocked', targetVersion: target.version, issues: target.issues, appliedVersion: null });
      const observed = await this.observe(target);
      if(observed.pending)return this.record({state:'inspecting',targetVersion:target.version,
        inventory:observed.inventory,issues:observed.issues,scannedNodes:observed.cursor.index,
        discoveredNodes:observed.cursor.pending.length,appliedVersion:null});
      if (!observed.complete || observed.issues.length) return this.record({ state: 'blocked', targetVersion: target.version, issues: observed.issues, appliedVersion: null });
      await this.storage.put('permission:inventory', observed.inventory || []);
      // Rebuild the target after observation, including expiry and source edits.
      const latest = await this.adapter.target();
      if (!latest.complete || latest.issues.length || latest.version !== target.version)
        return this.record({ state: 'superseded', targetVersion: latest.version, appliedVersion: null });
      if (!observed.changes.length) {
        await this.storage.delete('permission:pending');
        return this.record({ state: 'native_readback_matched', targetVersion: target.version,
          appliedVersion: target.version, attempts: 0, issues: [], resources: target.resources });
      }
      // Remove/reduce access before issuing new grants. One operation per step
      // bounds each alarm and lets the latest target supersede a queued grant.
      const change = [...observed.changes].sort((a,b) => a.priority - b.priority)[0];
      await this.storage.put('permission:pending', { targetVersion: target.version, change, startedAt: this.now() });
      await this.record({ state: 'applying', targetVersion: target.version, appliedVersion: null });
      await this.adapter.apply(change, target);
      const after = await this.adapter.target();
      // Even a successful response needs a fresh readback. If a source changes
      // during a request, the next serialized step compensates to the new target.
      await this.storage.setAlarm(this.now() + 1000);
      return this.record({ state: after.version === target.version ? 'awaiting_readback' : 'compensation_queued',
        targetVersion: after.version, appliedVersion: null, issues: [] });
    } catch (error) {
      const old = await this.storage.get('permission:status') || {};
      const attempts = (old.attempts || 0) + 1;
      if(attempts>=5){
        await this.storage.put('permission:enabled',false);
        await this.storage.deleteAlarm();
        return this.record({state:'manual_intervention',attempts,appliedVersion:null,
          issues:[{code:error.code||'NATIVE_SYNC_FAILED',status:error.status||503}]});
      }
      await this.storage.setAlarm(this.now() + Math.min(300000, 1000 * 2 ** Math.min(attempts,8)));
      return this.record({ state: 'retry_after_readback', attempts, appliedVersion: null,
        issues: [{ code: error.code || 'NATIVE_SYNC_FAILED', status: error.status || 503 }] });
    }
  }
}
