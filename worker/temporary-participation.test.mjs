import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { authority, memberFeatures, isInternalMember } from './src/authorization.js';
import { owesWeekly } from './src/weekly-access.js';
const env={TEMPORARY_WEEKLY_VOLUNTARY_READING_PERSON_IDS:'P-007,P-008'};
const record=(i,type='临时',boundary='团队内')=>({record_id:'r'+i,fields:{'人员编号':'P-00'+i,'姓名':'模拟'+i,'飞书成员':[{id:'ou_'+i}],'成员类别':type,'人员边界':boundary,'人员状态':'在组'}});
const people=[record(1,'PI'),record(2,'RA'),record(3,'博士'),record(4,'博士'),record(5,'临时','团队外'),record(6,'联合培养','团队外'),record(7),record(8),record(9)];
for(const p of people){
  const context=authority(people,[],[],p.fields['飞书成员'][0].id);
  const before=JSON.stringify(context);
  if(['P-007','P-008'].includes(context.personId)){
    const f=memberFeatures(context,env);
    assert.equal(f.literatureRead,true);assert.equal(f.literatureSubmit,true);assert.equal(f.literatureTargetRequired,false);
    assert.equal(owesWeekly(context,env),true);assert.equal(isInternalMember(context),false);
    assert.deepEqual(context.roles,['collaborator']);assert.deepEqual(context.grants,{});
  }else{
    assert.deepEqual(memberFeatures(context,env),memberFeatures(context,{}));
    assert.equal(owesWeekly(context,env),owesWeekly(context,{}));
  }
  assert.equal(JSON.stringify(context),before);
}
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const start=app.indexOf('  function renderLiteratureSection('),end=app.indexOf('  function courseTone(',start);
const state={dashboard:{profile:{name:'模拟'},capabilities:{features:{literatureSubmit:true,literatureTargetRequired:false}},literature:{items:[],mineCount:0,minimum:0,completed:null,canSubmit:true,targetRequired:false}}};
const c=vm.createContext({state,escapeHtml:String,tag:()=>'',modulePlaceholder:()=>''});
vm.runInContext(app.slice(start,end),c);
const voluntary=c.renderLiteratureSection();
assert.match(voluntary,/分享文献/);assert.match(voluntary,/自愿分享/);
assert.doesNotMatch(voluntary,/progressbar|每人每周至少|还需 \d|literature-count/);
delete state.dashboard.capabilities.features.literatureTargetRequired;
state.dashboard.literature={items:[],mineCount:0,minimum:3,completed:false,canSubmit:true,targetRequired:true};
assert.match(c.renderLiteratureSection(),/每人每周至少 3 篇/);
assert.match(c.renderLiteratureSection(),/progressbar/);
console.log('PASS P-007/P-008 opt-in, no role/project mutation, original six and other temporary members unchanged, voluntary UI without quota');
