import assert from 'node:assert/strict';
import { PermissionReconciler } from './src/permission-reconciler.js';
function fixture(){
  const data=new Map();let alarm=null,version='grant-1',wanted='edit',actual=null,throwAfter=false,changeDuring=false,blocked=false;
  const writes=[],reads=[];
  const storage={get:async k=>structuredClone(data.get(k)),put:async(k,v)=>data.set(k,structuredClone(v)),delete:async k=>data.delete(k),setAlarm:async n=>{alarm=n;},deleteAlarm:async()=>{alarm=null;}};
  const adapter={target:async()=>({version,complete:!blocked,issues:blocked?[{code:'UNVERIFIED_REFERENCE'}]:[],resources:[{node:'fixture'}]}),
    observe:async()=>{reads.push(actual);return {complete:true,issues:[],inventory:[{node:'fixture'}],changes:actual===wanted?[]:[{priority:wanted?2:0,permission:wanted}]};},
    apply:async c=>{writes.push(c.permission);actual=c.permission;if(changeDuring){version='revoke-2';wanted=null;changeDuring=false;}if(throwAfter){throwAfter=false;throw Error('response lost');}}};
  const engine=()=>new PermissionReconciler(storage,adapter,()=>1000);
  return {storage,adapter,engine,writes,reads,get actual(){return actual;},get alarm(){return alarm;},block(){blocked=true;},expire(){version='revoke-2';wanted=null;},race(){changeDuring=true;},loseResponse(){throwAfter=true;}};
}
{
 const f=fixture();assert.equal((await f.engine().status()).enabled,false);await f.engine().step();assert.equal(f.writes.length,0);
 f.block();assert.equal((await f.engine().enable()).state,'blocked');assert.equal((await f.engine().status()).enabled,false);assert.equal(f.writes.length,0);
}
{
 const f=fixture();await f.engine().enable();f.loseResponse();await f.engine().step();assert.equal(f.actual,'edit');assert.equal((await f.engine().status()).state,'retry_after_readback');assert.ok(f.alarm);
 // Reconstruct the object as if the worker restarted after an unknown result.
 await f.engine().step();assert.deepEqual(f.writes,['edit']);assert.equal((await f.engine().status()).state,'native_readback_matched');assert.equal((await f.engine().status()).effectiveAccessCertified,false);
 f.expire();await f.engine().step();assert.equal(f.actual,null);assert.equal((await f.engine().status()).appliedVersion,null);
 await f.engine().step();assert.equal((await f.engine().status()).appliedVersion,'revoke-2');
}
{
 const f=fixture();await f.engine().enable();f.race();await f.engine().step();assert.equal((await f.engine().status()).state,'compensation_queued');
 await f.engine().step();assert.deepEqual(f.writes,['edit',null]);assert.equal(f.actual,null);await f.engine().step();assert.equal((await f.engine().status()).appliedVersion,'revoke-2');
}
{
 const f=fixture();await f.engine().enable();let first=true;
 const observe=f.adapter.observe;f.adapter.observe=async target=>{const r=await observe(target);if(first){first=false;f.expire();}return r;};
 assert.equal((await f.engine().step()).state,'superseded');assert.equal(f.writes.length,0,'queued old grant is not sent after newer revoke');
 await f.engine().disable();await f.engine().step();assert.equal(f.alarm,null);
}
{
 const f=fixture();f.adapter.observe=async()=>({complete:false,issues:[{code:'INCOMPLETE_ACL'}],changes:[]});
 assert.equal((await f.engine().enable()).enabled,false);assert.equal(f.writes.length,0);
}
console.log('PASS durable native sync: disabled by default, incomplete inventory blocks activation, ambiguous-write readback after restart, expiry, obsolete task rejection and in-flight grant compensation');
