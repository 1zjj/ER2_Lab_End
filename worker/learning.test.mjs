import assert from 'node:assert/strict';
import { learningActor, learningRecipient, learningAccess, learningInput } from './src/learning-policy.js';
import { executeLearning, deliverLearningNotices } from './src/learning.js';

export const people = [
  ['P-001','陈铮一','ou_professor','PI',['管理员','教授周报接收']],
  ['P-002','朱俊杰','ou_junjie','RA',['管理员','课程审核']],
  ['P-003','学生甲','ou_student','博士',[]],
  ['P-004','学生乙','ou_other','博士',['管理员','课程审核']]
].map(([id,name,sub,kind,duties]) => ({ record_id: 'rec-' + id, fields: { '人员编号':id,'姓名':name,'飞书成员':[{id:sub}],
  '人员状态':'在组','人员边界':'团队内','成员类别':kind,'系统职责':duties } }));
export const env = { LEARNING_REVIEWER_PERSON_ID:'P-002', LEARNING_PROFESSOR_PERSON_ID:'P-001', FRONTEND_URL:'https://example.test/' };
const context = sub => ({ actor: learningActor(people, sub), people, access: learningAccess(learningActor(people, sub), people, env) });
class Storage {
  data = new Map(); alarm = 0;
  async get(key) { if (Array.isArray(key)) return new Map(key.filter(k=>this.data.has(k)).map(k=>[k,structuredClone(this.data.get(k))])); return structuredClone(this.data.get(key)); }
  async put(key,value) { this.data.set(key,structuredClone(value)); }
  async delete(key) { return this.data.delete(key); }
  async list({prefix='',startAfter='',end='',reverse=false,limit=1000}={}) {
    let entries=[...this.data].filter(([k])=>k.startsWith(prefix)&&(!startAfter||k>startAfter)&&(!end||k<end)).sort(([a],[b])=>a.localeCompare(b,'en',{sensitivity:'variant'}));
    // Storage uses raw UTF-8 lexical order.
    entries.sort(([a],[b])=>a<b?-1:a>b?1:0); if(reverse) entries.reverse(); return new Map(structuredClone(entries.slice(0,limit)));
  }
  async setAlarm(value) { this.alarm=value; }
  async transaction(fn) { const old=structuredClone(this.data); try { return await fn(this); } catch(e) { this.data=old; throw e; } }
}
const storage=new Storage();
const request=(path,body)=>new Request('https://worker.test/api/learning'+path, body ? { method:'POST',body:JSON.stringify(body) } : {});
const run=(sub,path,body)=>executeLearning(request(path,body),env,storage,async()=>context(sub)).then(r=>r.json());
const submit=(lesson,extra={})=>({requestId:'request-learning-'+lesson,trackId:'A',lessonId:lesson,gains:'本课学习收获 '+lesson,...extra});
assert.equal(learningAccess(context('ou_professor').actor,people,env).canReview,false);
assert.equal(learningAccess(context('ou_other').actor,people,env).canReview,false,'Another manager or course reviewer cannot read students');
assert.equal(learningRecipient(people,env,'reviewer').sub,'ou_junjie');
assert.equal(learningRecipient(people,env,'professor').sub,'ou_professor');
assert.throws(()=>learningInput(submit('01',{gains:' '}),'submit'));
assert.throws(()=>learningInput(submit('01',{subject:'ou_other'}),'submit'));
assert.throws(()=>learningInput(submit('01',{trackId:'B'}),'submit'));
for (const [field,value] of [['人员状态','离组'],['人员编号',''],['人员边界','团队外']]) {
  const copy=structuredClone(people); copy[2].fields[field]=value; assert.throws(()=>learningActor(copy,'ou_student'));
}
assert.throws(()=>learningActor([...people,people[2]],'ou_student'));
const first=await run('ou_student','/submit',submit('01'));
assert.equal(first.saved,true); assert.equal(first.records.length,1);
assert.deepEqual((await run('ou_student','/submit',submit('01'))).event,first.event,'lost-response retry does not duplicate');
await assert.rejects(run('ou_student','/submit',submit('01',{gains:'different'})),e=>e.status===409);
await assert.rejects(run('ou_student','/submit',submit('01',{requestId:'another-learning-request'})),e=>e.status===409);
for(const sub of ['ou_other','ou_professor']) {
  assert.equal((await run(sub,'/record?subject=ou_student&track=A&lesson=01')).record.subject,'ou_student');
  assert.equal((await run(sub,'/inbox')).records.length,1);
  await assert.rejects(run(sub,'/reply',{requestId:'bad-reply-request-1',trackId:'A',lessonId:'01',subject:'ou_student',text:'bad'}),e=>e.status===403);
}
await assert.rejects(run('ou_student','/inbox'),e=>e.status===403);
for(let n=2;n<=10;n++) await run('ou_student','/submit',submit(String(n).padStart(2,'0')));
assert.equal((await run('ou_student','')).records.length,10,'all ten complete without any reply');
assert.equal([...storage.data.keys()].filter(k=>k.startsWith('complete:')).length,1);
await run('ou_junjie','/reply',{requestId:'teacher-reply-request',trackId:'A',lessonId:'01',subject:'ou_student',text:'老师回复'});
await run('ou_student','/append',{requestId:'student-append-request',trackId:'A',lessonId:'01',text:'学生补充'});
let detail=await run('ou_student','/record?track=A&lesson=01');
assert.deepEqual(detail.events.map(e=>e.kind),['submit','reply','append']);
assert.equal(detail.events[0].gains,'本课学习收获 01');
for(let n=0;n<33;n++) await run('ou_student','/append',{requestId:'student-long-history-'+n,trackId:'A',lessonId:'01',text:'补充'+n});
detail=await run('ou_student','/record?track=A&lesson=01');
assert.equal(detail.events.length,30); assert.equal(detail.next,7);
const older=await run('ou_student','/record?track=A&lesson=01&before='+detail.next);
assert.equal(older.events.length,6); assert.equal(older.events[0].gains,'本课学习收获 01');
const messages=[];
const services={getTenantToken:async()=> 'fake',listRecords:async(...args)=> { assert.equal(args[2],'MEMBERS_TABLE_ID'); return people; },
  feishuRequest:async(path,options)=>{assert.equal(path,'/im/v1/messages?receive_id_type=open_id');messages.push(options.body);return {code:0,data:{message_id:'mock-'+messages.length}};}};
for(let n=0;n<4;n++) await deliverLearningNotices(env,storage,services);
const completion=messages.filter(m=>m.receive_id==='ou_professor');
assert.equal(completion.length,1); assert.equal(JSON.parse(completion[0].content).text,'学生甲同学已完成Track A的学习');
assert.equal(messages.filter(m=>m.receive_id==='ou_other').length,0);
assert.ok(messages.some(m=>m.receive_id==='ou_student'));
const sent=messages.length; await deliverLearningNotices(env,storage,services);assert.equal(messages.length,sent);
await run('ou_student','/append',{requestId:'notification-failure-request',trackId:'A',lessonId:'01',text:'通知失败也要保存'});
await deliverLearningNotices(env,storage,{...services,feishuRequest:async()=>{throw Error('timeout')}});
assert.equal((await run('ou_student','/record?track=A&lesson=01')).events.at(-1).text,'通知失败也要保存');
for(const [key,n] of storage.data) if(key.startsWith('notice:')&&n.status==='pending') await storage.put(key,{...n,firstAttempt:Date.now()-3600000,nextAttempt:0});
await deliverLearningNotices(env,storage,services);assert.equal(messages.length,sent,'do not retry uncertain delivery outside deduplication window');
assert.equal((await run('ou_junjie','/inbox')).notificationIssues.length,1);
assert.equal(people[2].fields['人员状态'],'在组');
console.log('PASS learning policy, private access, identity, idempotency, append-only history, pagination, completion and isolated notifications');
