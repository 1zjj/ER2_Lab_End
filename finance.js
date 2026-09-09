(function () {
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=c=>'¥'+(Number(c||0)/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const blank=()=>({name:'',quantity:'',unitPrice:'',purchaseDate:''});
  const button=(action,label,primary=false,extra='')=>`<button type="button" class="button ${primary?'button-primary':'button-secondary'}" data-finance="${action}" ${extra}>${label}</button>`;
  function card(){return '<section class="panel finance-card" aria-labelledby="finance-title"><p class="kicker">APPLICATIONS</p><div class="panel-title"><h2 id="finance-title">预算与报销</h2></div><p>购买前告知老师；报销确认后自动登记设备。</p><div data-finance-card-actions><span class="finance-muted">正在核验办理权限…</span></div></section>';}
  function create(options){
    let meta=null,dialog=null,current=null,files=[],busy=false,dirty=false,listReview=false,page=0,lastWrite=null,identity='',epoch=0,autoOpened=false;
    const apiBase=String(options.apiBase||'').replace(/\/$/,'');
    const profile=()=>options.getProfile()||{};
    async function api(path,body,extra={}){
      const session=options.getSession();if(!session)throw Error('请先登录');
      const headers={Authorization:'Bearer '+session,...extra.headers};
      if(body!==undefined&&!(body instanceof FormData))headers['Content-Type']='application/json';
      const response=await fetch(apiBase+'/api/finance'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body),signal:AbortSignal.timeout(65000)});
      if(session!==options.getSession())throw Error('登录身份已变化，请重新打开');
      if(extra.binary){if(!response.ok){const e=await response.json().catch(()=>({}));throw Error(e.message||'资料无法下载');}return response.blob();}
      const value=await response.json().catch(()=>({}));
      if(!response.ok){if(response.status===401)options.onUnauthorized?.();const err=Error(value.message||'财务服务暂时不可用');err.status=response.status;throw err;}return value;
    }
    async function write(path,body){const content=JSON.stringify({path,body});if(!lastWrite||lastWrite.content!==content)lastWrite={content,id:crypto.randomUUID()};const result=await api(path,{...body,requestId:lastWrite.id});lastWrite=null;return result;}
    function message(text,error=false){const el=dialog?.querySelector('[data-finance-message]');if(el){el.textContent=text;el.classList.toggle('finance-error',error);}}
    async function run(fn){if(busy)return;busy=true;const controls=[...dialog.querySelectorAll('button,input,textarea,select')].map(el=>[el,el.disabled]);controls.forEach(([el])=>el.disabled=true);try{await fn();}catch(e){message(e.name==='TimeoutError'?'等待结果超时，请先查看我的记录，或保留当前内容重试。':e.message,true);}finally{busy=false;controls.forEach(([el,disabled])=>{if(el.isConnected)el.disabled=disabled;});}}
    function ensureDialog(){if(dialog)return;dialog=document.createElement('dialog');dialog.className='finance-dialog';dialog.setAttribute('aria-labelledby','finance-dialog-title');document.body.append(dialog);
      dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('click',event=>{const b=event.target.closest('[data-finance]');if(b&&!b.disabled)handle(b.dataset.finance,b);});
      dialog.addEventListener('input',()=>{dirty=true;total();});
      dialog.addEventListener('change',event=>{if(event.target.matches('[data-finance-upload]'))upload(event.target);});
      dialog.addEventListener('submit',event=>{event.preventDefault();save(true);});
    }
    function close(){if(busy)return;if(dirty&&!window.confirm('当前内容尚未保存，确定关闭？'))return;dialog.close();dialog.innerHTML='';current=null;files=[];dirty=false;}
    function shell(title,content){ensureDialog();dialog.innerHTML=`<div class="finance-head"><div><p class="kicker">预算与报销</p><h2 id="finance-dialog-title">${escape(title)}</h2></div>${button('close','关闭')}</div><div class="finance-body">${content}</div><p class="finance-message" data-finance-message role="status" aria-live="polite"></p>`;if(!dialog.open)dialog.showModal();}
    async function mount(){
      const actor=profile().personId||'';if(identity!==actor){identity=actor;meta=null;current=null;lastWrite=null;files=[];dirty=false;autoOpened=false;dialog?.close();if(dialog)dialog.innerHTML='';}
      const generation=++epoch,root=document.querySelector('[data-finance-card-actions]');if(!root)return;
      root.onclick=event=>{const b=event.target.closest('[data-finance]');if(b)handle(b.dataset.finance,b);};
      try{const loaded=await api('');if(generation!==epoch||!root.isConnected)return;meta=loaded;
        root.innerHTML='<div class="finance-actions">'+(meta.access.canSubmit?button('purchase','采购申请',false,meta.ready?'':'disabled')+button('claim','费用报销',true,meta.ready?'':'disabled')+button('records','我的记录'):'')+
          (meta.access.canReview?button('review','审核'+(meta.pending?' · '+meta.pending:'')):'')+(meta.access.canViewAll?button('all','全量记录'):'')+(meta.access.canSummary?button('summary','月度花费'):'')+'</div>'+
          (!meta.ready?'<p class="finance-muted">财务权限与设备清单正在准备，完成后开放办理。</p>':'')+(meta.access.canConfigure?'<details class="finance-admin"><summary>财务设置</summary>'+button('setup','查看财务配置')+'</details>':'');
        if(!autoOpened&&new URL(location.href).searchParams.get('page')==='finance'){autoOpened=true;await listing(false);}
      }catch(e){if(generation===epoch&&root.isConnected)root.innerHTML='<p class="finance-muted">预算与报销暂时无法载入。</p>'+button('refresh','重试');}
    }
    function lineHTML(line,index,locked=false){const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);return `<fieldset class="finance-line" data-line><legend>购买明细 ${index+1}</legend><div class="finance-fields"><label>名称<span>必填</span><input name="name" maxlength="300" required value="${escape(line.name)}" ${locked?'disabled':''}></label><label>数量<span>必填</span><input name="quantity" type="number" inputmode="decimal" step="0.001" min="0.001" max="9999999" required value="${escape(line.quantity)}" ${locked?'disabled':''}></label><label>采购价格（单价）<span>必填 · 元</span><input name="unitPrice" type="number" inputmode="decimal" step="0.01" min="0" max="999999999.99" required value="${escape(line.unitPrice)}" ${locked?'disabled':''}></label><label>采购日期<span>必填</span><input name="purchaseDate" type="date" min="1990-01-01" max="${today}" required value="${escape(line.purchaseDate)}" ${locked?'disabled':''}></label></div>${!locked?button('remove-line','移除此项'):''}</fieldset>`;}
    const editable=d=>!d.id||['draft','returned'].includes(d.status);
    function renderDocument(d,attachments=[],history=[]){
      current=d;files=attachments;dirty=false;const own=!d.id||d.personId===profile().personId,locked=!own||!editable(d),claim=d.kind==='claim';
      shell(claim?'费用报销':'采购申请',`<p class="finance-muted">${d.id?escape(d.id)+' · '+escape(meta.statuses[d.status])+' · '+escape(d.ownerName):'申报人：'+escape(profile().name)+'（按登录账号自动记录）'}</p>`+
        (d.returnReason?`<p class="finance-return">退回原因：${escape(d.returnReason)}</p>`:'')+
        (d.syncError?`<p class="finance-return">${escape(d.syncError)}</p>`:'')+
        `<form data-finance-form>${claim?'<p>每项填写以下四项信息。财务确认已报销后，将自动记入设备清单。</p><div data-finance-lines>'+d.lines.map((l,i)=>lineHTML(l,i,locked)).join('')+'</div>'+(!locked?button('add-line','＋ 添加购买明细'):''):
          `<p>老师了解购买内容并回复同意后，相关资料继续通过飞书群聊沟通。</p><label>准备购买什么<textarea name="content" maxlength="3000" required ${locked?'disabled':''}>${escape(d.content)}</textarea></label><div class="finance-fields"><label>预计金额（元）<input name="estimate" type="number" min="0" max="999999999.99" step="0.01" required value="${d.estimate==null?'':escape(d.estimate/100)}" ${locked?'disabled':''}></label><label>用途或项目<input name="purpose" maxlength="1500" required value="${escape(d.purpose)}" ${locked?'disabled':''}></label></div>`}
        <div class="finance-total">${claim?'本单合计':'预计金额'}<strong data-finance-total>${money(d.totalCents)}</strong></div>
        <section class="finance-materials"><h3>相关资料</h3><p>可上传发票、订单或付款凭证，也可记录群聊资料说明。</p><label>资料说明或链接（选填）<textarea name="materials" maxlength="5000" ${locked?'disabled':''}>${escape(d.materials)}</textarea></label><ul data-finance-files></ul>${!locked?'<label class="finance-file-label">添加资料（每份不超过20MB，最多20份）<input type="file" data-finance-upload multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.doc,.docx,.xls,.xlsx,.txt,.zip"></label>':''}</section>`+
        (!locked?'<div class="finance-actions">'+button('draft','保存草稿')+`<button type="submit" class="button button-primary">${claim?'提交财务审核':'提交给老师'}</button></div>`:'')+'</form>'+
        (meta.access.canReview&&claim&&d.status==='submitted'&&!own?'<section class="finance-review"><h3>财务审核</h3><p>请核对购买信息、资料真实性及是否重复报销。确认后视为已报销，并开始登记设备。</p>'+button('equipment-check','核对是否已有设备')+'<div data-finance-equipment-check></div><label>退回原因<textarea data-finance-reason maxlength="2000"></textarea></label><div class="finance-actions">'+button('return','退回修改')+button('approve','确认已报销并入库',true)+'</div></section>':'')+
        (meta.access.canReview&&claim&&d.status==='submitted'&&own?'<p class="finance-muted">本人不能审核此单，请由指定代审人员处理。</p>':'')+
        (meta.access.canReview&&['approved','sync_error'].includes(d.status)&&!own?button('retry','重试未完成的入库'):'')+
        (history.length?'<details class="finance-history"><summary>处理记录</summary><ol>'+history.map(l=>'<li>'+escape(l.time.replace('T',' ').slice(0,16))+' · '+escape(l.name)+' · '+escape(l.action)+(l.note?'：'+escape(l.note):'')+'</li>').join('')+'</ol></details>':'')+
        '<div class="finance-actions">'+button('records','返回我的记录')+(meta.access.canReview?button('review','返回审核列表'):'')+'</div>');
      renderFiles(locked);total();
    }
    function renderFiles(locked){const el=dialog.querySelector('[data-finance-files]');el.innerHTML=files.map(a=>`<li><span>${escape(a.name)} <small>${(a.size/1024).toFixed(0)}KB</small></span>${current.id&&current.attachmentIds.includes(a.id)?button('download','下载',false,`data-file="${escape(a.id)}"`):''}${!locked?button('remove-file','移除',false,`data-file="${escape(a.id)}"`):''}</li>`).join('');}
    function readForm(){const form=dialog.querySelector('[data-finance-form]'),data={kind:current.kind,materials:form.elements.materials.value,attachmentIds:files.map(f=>f.id)};
      if(current.id){data.id=current.id;data.revision=current.revision;}
      if(current.kind==='claim')data.lines=[...form.querySelectorAll('[data-line]')].map(el=>Object.fromEntries(['name','quantity','unitPrice','purchaseDate'].map(k=>[k,el.querySelector('[name="'+k+'"]').value])));
      else Object.assign(data,{content:form.elements.content.value,estimate:form.elements.estimate.value,purpose:form.elements.purpose.value});return data;
    }
    function total(){const form=dialog?.querySelector('[data-finance-form]');if(!form)return;const data=readForm();const sum=data.kind==='claim'?data.lines.reduce((sum,l)=>sum+Math.round(Number(l.quantity||0)*Math.round(Number(l.unitPrice||0)*100)),0):Math.round(Number(data.estimate||0)*100);const el=dialog.querySelector('[data-finance-total]');if(el)el.textContent=money(sum);}
    async function save(submit){const form=dialog.querySelector('[data-finance-form]');if(submit&&!form.reportValidity())return;const data=readForm();await run(async()=>{const r=await write('/save',{...data,submit});dirty=false;renderDocument(r.document,files);message(submit?'已提交，可在我的记录中查看处理进度。':'草稿已保存。');mount();});}
    async function upload(input){const chosen=[...input.files];if(!chosen.length)return;if(files.length+chosen.length>20){message('每单最多20份资料。',true);return;}
      await run(async()=>{for(const file of chosen){if(file.size>20*1024*1024||!file.size)throw Error('每份资料须为1字节至20MB');const form=new FormData();form.append('file',file);const a=await api('/upload',form,{headers:{'X-Request-ID':crypto.randomUUID()}});files.push(a);dirty=true;renderFiles(false);}message('资料已上传，保存或提交单据后完成关联。');});input.value='';}
    async function listing(review,newPage=0){if(dirty&&!window.confirm('当前内容未保存，确定离开？'))return;dirty=false;listReview=review;page=newPage;const all=review==='all',title=all?'全量财务记录':review?'财务审核':'我的记录';shell(title,'<p>正在载入…</p>');await run(async()=>{const r=await api('/records?review='+(review===true)+'&all='+all+'&page='+page);shell(title,
      (review===true?'<p>待审核单据需逐项核实。退回修改不入库；确认已报销后自动入库。</p>':'')+
      '<div class="finance-records">'+(r.records.length?r.records.map(d=>`<article><div><strong>${escape(d.id)}</strong><p>${escape(d.kind==='claim'?'费用报销':'采购申请')} · ${escape(d.ownerName)} · ${escape(meta.statuses[d.status])}</p>${d.syncError?'<p class="finance-error">'+escape(d.syncError)+'</p>':''}${d.noticeError?'<p class="finance-muted">'+escape(d.noticeError)+'</p>':''}</div><div><strong>${money(d.totalCents)}</strong>${button('detail','查看',false,`data-id="${escape(d.id)}"`)}</div></article>`).join(''):'<p class="finance-muted">暂无记录。</p>')+'</div><div class="finance-actions">'+(page?button('prev','上一页'):'')+(r.more?button('next','下一页'):'')+button(all?'all':review?'review':'records','刷新列表')+'</div>');});}
    async function detail(id){await run(async()=>{const r=await api('/record?id='+encodeURIComponent(id));renderDocument(r.document,r.attachments,r.history);});}
    async function review(action){if(action==='approve'&&!current.equipmentChecked){message('请先核对设备清单，避免重复登记。',true);return;}if(action==='return'&&!dialog.querySelector('[data-finance-reason]').value.trim()){message('请填写退回原因。',true);return;}if(action==='approve'&&!window.confirm('确认此单真实、准确且未重复报销，并且已完成报销？确认后将自动登记设备。'))return;
      const reason=dialog.querySelector('[data-finance-reason]')?.value||'';await run(async()=>{const equipmentDecisions=Object.fromEntries([...dialog.querySelectorAll('[data-equipment-decision]')].map(el=>[el.dataset.equipmentDecision,el.value]));const duplicateReason=dialog.querySelector('[data-duplicate-reason]')?.value||'';const r=await write('/review',{id:current.id,revision:current.revision,action,reason,equipmentDecisions,duplicateReason});renderDocument(r.document,files);message(action==='approve'?'已确认，设备正在登记。可刷新记录查看结果。':'已退回修改。');mount();});}
    async function summary(month){if(!meta?.access.canSummary)return;const m=month||new Date(Date.now()+8*3600000).toISOString().slice(0,7);shell('月度花费',`<label>采购月份<input type="month" data-finance-month value="${escape(m)}"></label>${button('load-summary','查看汇总')}<div data-finance-summary></div>`);await run(async()=>{const r=await api('/summary?month='+encodeURIComponent(m));dialog.querySelector('[data-finance-summary]').innerHTML=`<div class="finance-total">已确认报销<strong>${money(r.totalCents)}</strong></div><p>尚未确认：${money(r.pendingCents)}。按采购日期归属月份，历史迁入设备不计入本期新增报销。</p><p>${r.syncIssues?'有 '+r.syncIssues+' 张单据正在处理设备入库。':''}</p><div class="finance-table"><table><thead><tr><th>申报人</th><th>名称</th><th>数量</th><th>金额</th></tr></thead><tbody>${r.items.map(l=>`<tr><td>${escape(l.owner)}</td><td>${escape(l.name)}</td><td>${escape(l.quantity)}</td><td>${money(l.amountCents)}</td></tr>`).join('')}</tbody></table></div>`;});}
    async function setup(){shell('财务配置','<p>正在读取配置…</p>');await run(async()=>{const r=await api('/setup');const binding=r.settings?.equipmentBinding;const equipmentUrl=binding?'https://lcnywl4yrecr.feishu.cn/wiki/'+binding.wiki+'?table='+binding.table:'';
      shell('财务配置','<p>设备副本通过核验后，财务确认的报销明细将记入该表。</p><label>设备档案表链接<input type="url" data-finance-equipment-url value="'+escape(equipmentUrl)+'" placeholder="粘贴包含具体数据表的飞书链接"></label><label class="finance-check"><input type="checkbox" data-finance-equipment-permissions>已核实设备表仅授权成员可访问，工作台应用可编辑</label><div class="finance-actions">'+button('bind-equipment','核验并绑定设备副本')+button('inspect','核对来源、设备与权限')+button('prepare','准备财务资料表')+'</div><details><summary>当前核对结果</summary><pre data-finance-inspection>'+escape(JSON.stringify(r,null,2))+'</pre></details><p>启用前须完成设备副本核验及四张财务资料表的权限检查。</p><label class="finance-check"><input type="checkbox" data-finance-native>已核实四张财务资料表仅财务及指定管理员可访问</label><label class="finance-check"><input type="checkbox" data-finance-reminders '+(r.settings?.reminders?'checked':'')+'>启用每月20日、27日10:00提醒及次月1日10:00教授汇总（北京时间）</label><div class="finance-actions">'+button('activate','启用办理',true)+button('disable','暂停办理')+'</div>');});}
    async function setupAction(action){await run(async()=>{const r=await api('/setup',{action,equipmentUrl:dialog.querySelector('[data-finance-equipment-url]')?.value,nativeEquipmentPermissionsVerified:dialog.querySelector('[data-finance-equipment-permissions]')?.checked,nativePermissionsVerified:dialog.querySelector('[data-finance-native]')?.checked,reminders:dialog.querySelector('[data-finance-reminders]')?.checked});dialog.querySelector('[data-finance-inspection]').textContent=JSON.stringify(r,null,2);message('已完成当前操作。');mount();});}
    async function handle(action,el){
      if(busy)return;
      if(action==='close')return close();if(action==='refresh')return mount();
      if(['claim','purchase'].includes(action)){if(!meta?.ready)return;return renderDocument({kind:action,lines:[blank()],content:'',purpose:'',estimate:null,materials:'',attachmentIds:[],totalCents:0});}
      if(action==='all'){if(!meta?.access.canViewAll)return;return listing('all');}
      if(action==='records'||action==='review')return listing(action==='review');
      if(action==='next'||action==='prev')return listing(listReview,page+(action==='next'?1:-1));
      if(action==='detail')return detail(el.dataset.id);
      if(action==='summary'||action==='load-summary')return summary(dialog?.querySelector('[data-finance-month]')?.value);
      if(action==='setup')return setup();if(['inspect','prepare','activate','disable','bind-equipment'].includes(action))return setupAction(action);
      if(action==='equipment-check')return run(async()=>{const r=await api('/equipment-check?id='+encodeURIComponent(current.id));const found=r.matches.filter(m=>m.records.length);dialog.querySelector('[data-finance-equipment-check]').innerHTML=found.length?'<p>发现名称、数量、单价、日期均相同的设备，请逐项核对。</p>'+found.map(m=>'<label>第 '+(m.index+1)+' 项：'+escape(m.name)+'<select data-equipment-decision="'+m.index+'"><option value="">请选择处理方式</option>'+m.records.map(record=>'<option value="'+escape(record.id)+'" '+(record.reimbursed?'disabled':'')+'>关联原设备 '+escape(record.id)+(record.reimbursed?'（已报销，不可重复关联）':'（尚未报销）')+'</option>').join('')+'<option value="new">确认是另一笔采购，新建记录</option></select></label>').join('')+'<label>如确认是另一笔采购，请说明依据<textarea data-duplicate-reason maxlength="2000"></textarea></label>':'<p>未发现四项采购信息均相同的设备。</p>';current.equipmentChecked=true;message('已核对设备清单。');});
      if(action==='draft')return save(false);if(action==='approve'||action==='return')return review(action);
      if(action==='retry')return run(async()=>{await write('/retry',{id:current.id});message('已安排重试未完成的设备登记。');});
      if(action==='add-line'){const root=dialog.querySelector('[data-finance-lines]'),n=root.children.length;if(n>=50){message('每单最多50项。',true);return;}root.insertAdjacentHTML('beforeend',lineHTML(blank(),n));dirty=true;}
      if(action==='remove-line'){if(dialog.querySelectorAll('[data-line]').length<=1){message('至少保留一项购买明细。',true);return;}el.closest('[data-line]').remove();dialog.querySelectorAll('[data-line] legend').forEach((l,i)=>l.textContent='购买明细 '+(i+1));dirty=true;total();}
      if(action==='remove-file'){files=files.filter(f=>f.id!==el.dataset.file);renderFiles(false);dirty=true;}
      if(action==='download')return run(async()=>{const f=files.find(f=>f.id===el.dataset.file);const blob=await api('/attachment?document='+encodeURIComponent(current.id)+'&id='+encodeURIComponent(f.id),undefined,{binary:true});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=f.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);});
    }
    window.addEventListener('er2-session-denied',()=>{epoch++;meta=null;files=[];current=null;dirty=false;dialog?.close();if(dialog)dialog.innerHTML='';});
    window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
    return {mount};
  }
  window.ER2Finance={create,card};
})();
