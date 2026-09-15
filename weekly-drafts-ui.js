(function(root){
  'use strict';
  const keys=['progress','learning','evidence','blockers','nextPlan'];
  const labels={progress:'本周完成与结果',learning:'学习与方法',evidence:'产出与证据',blockers:'问题与阻塞',nextPlan:'下一步计划'};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function create(options){
    let epoch=0,dialog=null,dbPromise=null;const bindings=new WeakMap(),urls=new Set(),dirtyKeys=new Set();
    root.addEventListener?.('beforeunload',event=>{if(dirtyKeys.size){event.preventDefault();event.returnValue='';}});
    function owner(){return options.getProfile()?.sub||'';}
    function db(){if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open('er2-weekly-private-drafts',1);r.onupgradeneeded=()=>r.result.createObjectStore('drafts');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return dbPromise;}
    async function localGet(key){const d=await db();return new Promise((resolve,reject)=>{const r=d.transaction('drafts').objectStore('drafts').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
    async function localPut(key,value){const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction('drafts','readwrite');t.objectStore('drafts').put(value,key);t.oncomplete=resolve;t.onerror=()=>reject(t.error);});}
    async function showBackups(person){const d=await db();const list=await new Promise((resolve,reject)=>{const r=d.transaction('drafts').objectStore('drafts').getAllKeys();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      if(owner()!==person)return;const choices=list.filter(k=>k.startsWith(person+':')&&(/:conflict:|:form-backup:/.test(k))).sort().reverse();
      const panel=document.createElement('dialog');panel.className='modal';panel.innerHTML='<div class="modal-head"><h2>本机保留的副本</h2><button class="icon-button" type="button" aria-label="关闭">×</button></div><div class="form-body"><select aria-label="副本">'+choices.map((key,index)=>'<option value="'+index+'">'+esc(key.replace(person+':',''))+'</option>').join('')+'</select><textarea rows="12" readonly aria-label="副本内容"></textarea><div data-backup-images></div></div>';
      const load=async()=>{const data=choices.length?await localGet(choices[Number(panel.querySelector('select').value)||0]):null;if(owner()!==person)return panel.close();panel.querySelector('textarea').value=data?JSON.stringify({weekId:data.weekId,scratch:data.scratch,notes:data.notes,values:data.values},null,2):'暂无保留副本';if(data?.images?.length)imageBox(panel.querySelector('[data-backup-images]'),data.images,'',()=>{},()=>true);};
      panel.querySelector('select').onchange=load;panel.querySelector('button').onclick=()=>panel.close();panel.onclose=()=>panel.remove();document.body.append(panel);panel.showModal();await load();
    }
    async function api(path,init={},binary=false){const session=options.getSession(),generation=epoch;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
      try{const response=await fetch(options.apiBase+path,{...init,headers:{Authorization:'Bearer '+session,...(init.body&&!(init.body instanceof Blob)?{'Content-Type':'application/json'}:{}),...(init.headers||{})},signal:controller.signal});
        if(generation!==epoch||session!==options.getSession())throw Error('登录账号已变化');
        if(response.status===401){options.onUnauthorized?.();throw Error('登录已过期，请保留草稿后重新登录');}
        if(!response.ok){const value=await response.json().catch(()=>({}));throw Object.assign(Error(value.message||'暂时无法同步，请保留本机草稿'),{status:response.status,code:value.code,latest:value.latest});}
        return binary?response.blob():response.json();
      }catch(error){if(controller.signal.aborted)throw Error('同步等待超时，本机草稿已保留；请稍后核对或重试');throw error;}finally{clearTimeout(timer);}
    }
    function blobUrl(blob){const url=URL.createObjectURL(blob);urls.add(url);return url;}
    function reset(){epoch++;dialog?.close();dialog?.remove();dialog=null;for(const url of urls)URL.revokeObjectURL(url);urls.clear();}
    async function compress(file){if(file.size>10*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('请选择10MB以内的JPG、PNG或WebP图片');
      const bitmap=await createImageBitmap(file),scale=Math.min(1,2048/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.82));if(!blob||blob.size>2*1024*1024)throw Error('压缩后仍超过2MB，请缩小图片再上传');return blob;
    }
    async function upload(file,weekId){const blob=await compress(file);return {blob,image:(await api('/api/weekly-drafts/image?weekId='+encodeURIComponent(weekId),{method:'POST',headers:{'Content-Type':blob.type},body:blob})).image};}
    function imageRefs(items){if(items.some(i=>!i.id))throw Error('仍有图片未上传成功，请重试或移除后再提交');return items.map(({id,caption,section})=>({id,caption:caption||'',section}));}
    function imageBox(container,items,weekId,onChange,isLocked=()=>false){
      let inFlight=false,preparing=0,uploadQueue=Promise.resolve();const generation=epoch,person=owner();
      const valid=()=>epoch===generation&&owner()===person&&container.isConnected;
      async function send(item){if(!valid()||isLocked())return;inFlight=true;item.error='';render();
        try{const result=await api('/api/weekly-drafts/image?weekId='+encodeURIComponent(weekId),{method:'POST',headers:{'Content-Type':item.blob.type},body:item.blob});if(!valid())return;item.id=result.image.id;item.error='';}
        catch(error){if(valid())item.error=error.message;}finally{inFlight=false;if(valid()){render();onChange();}}
      }
      async function add(files,section){if(isLocked())return;for(const file of files){if(items.length>=10){alert('每份草稿最多10张图片');break;}preparing++;try{
          const item={localId:crypto.randomUUID(),section,caption:'',blob:await compress(file)};if(!valid())return;items.push(item);onChange();render();uploadQueue=uploadQueue.then(()=>send(item));await uploadQueue;
        }catch(error){if(valid()){container.querySelector('[data-image-status]').textContent=error.message;}}finally{preparing--;}}
      }
      function render(){container.innerHTML='<div class="weekly-image-grid">'+items.map((item,index)=>'<figure><div data-image-preview="'+index+'"></div><input aria-label="图片说明" data-caption="'+index+'" maxlength="200" placeholder="图片说明（选填）" value="'+esc(item.caption)+'"><select aria-label="图片放置位置" data-section="'+index+'">'+[['progress','成果'],['blockers','问题'],['notes','仅留在草稿']].map(([key,label])=>'<option value="'+key+'"'+(item.section===key?' selected':'')+'>'+label+'</option>').join('')+'</select><small>'+esc(item.id?'已上传':item.error||'等待上传')+'</small><button type="button" class="button button-secondary" data-remove="'+index+'">移出当前草稿</button>'+(!item.id?'<button type="button" class="button button-secondary" data-retry="'+index+'"'+(inFlight?' disabled':'')+'>重试上传</button>':'')+'</figure>').join('')+'</div><div class="action-row"><label class="button button-secondary">＋ 添加图片<input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden></label><span data-image-status role="status">'+(inFlight?'正在上传，请等待确认':items.filter(i=>!i.id).length?'仍有图片仅保存在本机':'支持粘贴截图、拖入图片')+'</span></div>';
        items.forEach((item,index)=>{const slot=container.querySelector('[data-image-preview="'+index+'"]');const img=document.createElement('img');img.alt=item.caption||'周报图片';slot.append(img);
          if(item.blob)img.src=blobUrl(item.blob);else if(item.id)api('/api/weekly-drafts/image?id='+encodeURIComponent(item.id),{},true).then(blob=>{if(valid())img.src=blobUrl(blob);}).catch(()=>{if(valid())img.alt='图片暂时无法读取';});});
        container.querySelector('input[type=file]').onchange=e=>add([...e.target.files],'progress');
        container.querySelectorAll('[data-caption]').forEach(input=>input.oninput=()=>{if(!isLocked()){items[Number(input.dataset.caption)].caption=input.value;onChange();}});
        container.querySelectorAll('[data-section]').forEach(input=>input.onchange=()=>{if(!isLocked()){items[Number(input.dataset.section)].section=input.value;onChange();}});
        container.querySelectorAll('[data-remove]').forEach(button=>button.onclick=()=>{if(!isLocked()){items.splice(Number(button.dataset.remove),1);onChange();render();}});
        container.querySelectorAll('[data-retry]').forEach(button=>button.onclick=()=>{const item=items[Number(button.dataset.retry)];uploadQueue=uploadQueue.then(()=>send(item));});
      }
      render();return {add,refresh:render,refs:()=>{if(inFlight||preparing)throw Error('图片正在准备或上传，请稍后提交');return imageRefs(items);}};
    }
    async function open(weekId){
      reset();const generation=epoch,person=owner();if(!person)return;
      dialog=document.createElement('dialog');dialog.className='modal weekly-draft-modal';dialog.innerHTML='<div class="modal-head"><div><p class="kicker">WEEKLY NOTES</p><h2>周报草稿本</h2><p>仅本人可见 · 保存不等于提交</p></div><button class="icon-button" type="button" data-close aria-label="关闭">×</button></div><div class="form-body"><p role="status">正在读取草稿…</p></div>';
      document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-close]').onclick=()=>dialog.close();
      try{const listing=await api('/api/weekly-drafts');weekId=weekId||listing.currentWeek.id;const remote=await api('/api/weekly-drafts/week?weekId='+encodeURIComponent(weekId));if(epoch!==generation)return;
        const key=person+':'+weekId;let local;try{local=await localGet(key);}catch(_){}
        const data=local?.dirty?local:structuredClone(remote.draft);data.notes||=[];data.values||={};data.images||=[];
        let editable=remote.editable,saving=false,dirty=Boolean(local?.dirty),timer=null,conflict=false,localAvailable=true,ignoreClose=false;
        const panel=dialog;const valid=()=>epoch===generation&&owner()===person&&panel.isConnected;
        panel.querySelector('.form-body').innerHTML='<label>所属周<select data-week>'+[...new Set([listing.currentWeek.id,weekId,...listing.weeks.map(w=>w.weekId)])].sort().reverse().map(id=>'<option'+(id===weekId?' selected':'')+'>'+esc(id)+'</option>').join('')+'</select></label><p class="form-hint">'+(editable?'本周和前一周可编辑。跨周不会覆盖旧草稿。':'已超出编辑或补交范围；内容保留供查看、复制和导出。')+'</p><div data-draft-status role="status"></div><button type="button" class="button button-secondary" data-conflict hidden>保留本机副本并载入云端</button><label>随手记录<textarea data-note maxlength="1000" rows="3" placeholder="今天的进展、遇到的问题、下一步想法"></textarea></label><div class="action-row"><select data-kind><option value="progress">进展</option><option value="blockers">问题</option><option value="idea">想法</option></select><button type="button" class="button button-secondary" data-add-note>添加日常记录</button></div><div data-notes></div>'+keys.map(k=>'<label>'+labels[k]+'<textarea data-value="'+k+'" rows="3" maxlength="'+(['progress','evidence'].includes(k)?5000:3000)+'">'+esc(data.values[k]||'')+'</textarea></label>').join('')+'<div data-images></div>';
        const actions=document.createElement('div');actions.className='modal-actions';actions.innerHTML='<button type="button" class="button button-secondary" data-export>导出文字</button><button type="button" class="button button-secondary" data-save>保存草稿</button><button type="button" class="button button-primary" data-prepare>整理到周报</button>';panel.append(actions);
        const status=panel.querySelector('[data-draft-status]');
        if(remote.submission){const tag=document.createElement('p');tag.className='form-hint';tag.textContent=remote.submission.status+'；这里的草稿仍独立保存，修改不会自动覆盖正式周报。';status.before(tag);}
        const backupButton=document.createElement('button');backupButton.type='button';backupButton.className='button button-secondary';backupButton.textContent='本机保留副本';backupButton.onclick=()=>showBackups(person).catch(error=>{status.textContent=error.message;});actions.prepend(backupButton);
        if(listing.cursor){const option=document.createElement('option');option.value='__older__';option.textContent='加载更早周次…';panel.querySelector('[data-week]').append(option);}
        const viewStatus=message=>{if(valid())status.textContent=message;};
        const persist=async()=>{try{await localPut(key,{...data,dirty});}catch(_){localAvailable=false;viewStatus('本机缓存不可用，请勿关闭页面；可手动导出文字。');}};
        const changed=()=>{if(!editable||!valid())return;dirty=true;dirtyKeys.add(key);data.dirty=true;persist().then(()=>{if(localAvailable)viewStatus('本机已保存，等待云端同步');});clearTimeout(timer);timer=setTimeout(save,2000);};
        const images=imageBox(panel.querySelector('[data-images]'),data.images,weekId,changed,()=>!editable||conflict);
        function notes(){panel.querySelector('[data-notes]').innerHTML=data.notes.map((n,i)=>'<article class="weekly-note"><small>'+esc(n.createdAt?new Date(n.createdAt).toLocaleString('zh-CN'): '本机记录')+' · '+esc(({progress:'进展',blockers:'问题',idea:'想法'})[n.kind]||n.kind)+'</small><p>'+esc(n.text).replace(/\n/g,'<br>')+'</p><button class="button button-secondary" type="button" data-use="'+i+'"'+(!editable?' disabled':'')+'>选入'+(n.kind==='blockers'?'问题':'成果')+'</button></article>').join('');panel.querySelectorAll('[data-use]').forEach(b=>b.onclick=()=>{const n=data.notes[Number(b.dataset.use)],field=n.kind==='blockers'?'blockers':'progress';data.values[field]=(data.values[field]||'')+'\n'+n.text;panel.querySelector('[data-value="'+field+'"]').value=data.values[field];changed();});}
        async function save(){if(!valid()||!editable||saving||conflict||!dirty)return;saving=true;let acknowledged=false;viewStatus('正在同步草稿；仍可继续输入');
          const snapshot={values:{...data.values},scratch:data.scratch||'',notes:data.notes.map(({id,text,kind})=>({id,text,kind})),images:data.images.filter(i=>i.id).map(({id,caption,section})=>({id,caption,section}))};
          const serialized=JSON.stringify(snapshot);const requestId=data.pending?.content===serialized?data.pending.id:crypto.randomUUID();data.pending={id:requestId,content:serialized};await persist();
          try{const result=await api('/api/weekly-drafts/week',{method:'PUT',body:JSON.stringify({...snapshot,weekId,baseRevision:data.revision||0,requestId})});if(!valid())return;acknowledged=true;data.revision=result.draft.revision;data.savedAt=result.draft.savedAt;
            const current=JSON.stringify({values:data.values,scratch:data.scratch||'',notes:data.notes.map(({id,text,kind})=>({id,text,kind})),images:data.images.filter(i=>i.id).map(({id,caption,section})=>({id,caption,section}))});
            dirty=current!==serialized;data.dirty=dirty;delete data.pending;if(!dirty&&!data.images.some(i=>!i.id))dirtyKeys.delete(key);await persist();viewStatus(data.images.some(i=>!i.id)?'文字已同步，仍有图片仅在本机':dirty?'新修改等待同步':'云端已保存 · '+new Date(data.savedAt).toLocaleTimeString('zh-CN')+(result.currentWeek&&result.currentWeek.id!==weekId?'（仍归属所选历史周）':''));
          }catch(error){if(valid()){if(error.code==='DRAFT_CONFLICT'){conflict=true;panel.querySelector('[data-conflict]').hidden=false;}viewStatus(error.message+'；未覆盖本机内容。');}}finally{saving=false;if(acknowledged&&dirty&&!conflict&&valid())timer=setTimeout(save,2000);}
        }
        panel.querySelector('[data-conflict]').onclick=async()=>{await localPut(key+':conflict:'+Date.now(),{...data,dirty:true});const latest=await api('/api/weekly-drafts/week?weekId='+encodeURIComponent(weekId));ignoreClose=true;await localPut(key,{...latest.draft,dirty:false});dirtyKeys.delete(key);open(weekId);};
        panel.querySelector('[data-note]').value=data.scratch||'';panel.querySelector('[data-note]').oninput=e=>{data.scratch=e.target.value;changed();};
        panel.querySelector('[data-add-note]').onclick=()=>{if(!editable)return;const input=panel.querySelector('[data-note]');if(!input.value.trim())return;if(data.notes.length>=40){viewStatus('已达40条，当前随手记录仍保留在草稿中。');return;}data.notes.push({id:crypto.randomUUID(),text:input.value,kind:panel.querySelector('[data-kind]').value,createdAt:new Date().toISOString()});input.value='';data.scratch='';notes();changed();};
        panel.querySelectorAll('[data-value]').forEach(input=>input.oninput=()=>{data.values[input.dataset.value]=input.value;changed();});
        panel.querySelector('[data-week]').onchange=async e=>{if(e.target.value==='__older__'){try{const older=await api('/api/weekly-drafts?cursor='+encodeURIComponent(listing.cursor));const marker=e.target.querySelector('[value="__older__"]');for(const week of older.weeks){const option=document.createElement('option');option.value=week.weekId;option.textContent=week.weekId;e.target.insertBefore(option,marker);}listing.cursor=older.cursor;if(!listing.cursor)marker.remove();e.target.value=weekId;}catch(error){viewStatus(error.message);}return;}clearTimeout(timer);await persist();open(e.target.value);};
        panel.querySelector('[data-save]').onclick=()=>{dirty=true;save();};
        panel.querySelector('[data-prepare]').onclick=async()=>{try{const refs=images.refs().filter(i=>i.section!=='notes');await persist();panel.close();options.onPrepare?.(weekId,{values:{...data.values},images:refs});}catch(error){viewStatus(error.message);}};
        panel.querySelector('[data-export]').onclick=()=>{const text=weekId+'\n\n'+(data.scratch||'')+'\n\n'+data.notes.map(n=>n.text).join('\n\n')+'\n\n'+keys.map(k=>labels[k]+'\n'+(data.values[k]||'')).join('\n\n');const a=document.createElement('a');a.href=blobUrl(new Blob([text],{type:'text/plain;charset=utf-8'}));a.download='周报草稿-'+weekId+'.txt';a.click();};
        panel.addEventListener('paste',e=>{const files=[...(e.clipboardData?.items||[])].filter(i=>i.type.startsWith('image/')).map(i=>i.getAsFile());if(files.length){e.preventDefault();images.add(files,e.target.dataset.value==='blockers'?'blockers':'progress');}});
        panel.addEventListener('dragover',e=>e.preventDefault());panel.addEventListener('drop',e=>{e.preventDefault();images.add([...e.dataTransfer.files],'progress');});
        panel.addEventListener('close',()=>{clearTimeout(timer);if(!ignoreClose)persist();});
        if(!editable)panel.querySelectorAll('textarea,[data-add-note],[data-save],[data-prepare],input[type=file]').forEach(el=>el.disabled=true);
        notes();if(dirty)dirtyKeys.add(key);viewStatus(dirty?'检测到本机未同步草稿；内容已保留，点击保存可继续核对。':data.savedAt?'云端已保存 · '+new Date(data.savedAt).toLocaleString('zh-CN'):'本周新草稿；首次记录后创建');
      }catch(error){if(epoch===generation)dialog.querySelector('.form-body').textContent=error.message;}
    }
    function bindForm(form,weekId,initialImages=[]){
      const old=bindings.get(form);if(old){old.container.remove();bindings.delete(form);}
      const container=document.createElement('section');container.className='weekly-form-draft';container.innerHTML='<div class="action-row"><button type="button" class="button button-secondary" data-load>载入云端草稿</button><button type="button" class="button button-secondary" data-save-cloud>保存到云端草稿</button><button type="button" class="button button-secondary" data-notebook>草稿本</button></div><p data-status role="status">本机草稿自动保留；可手动保存到云端跨设备继续。</p><div data-form-images></div>';
      const progressLabel=form.querySelector('textarea[name=progress]')?.closest('label');if(progressLabel)progressLabel.after(container);else form.querySelector('.form-body').append(container);
      const items=structuredClone(initialImages),locked=()=>form.querySelector('[type=submit]')?.disabled,person=owner(),formKey=person+':form:'+weekId;
      let remoteState=null,autoReady=false,cloudBusy=false,cloudDirty=false,cloudTimer=null,pendingSave=null;
      const valid=()=>container.isConnected&&owner()===person;
      const valuesNow=()=>Object.fromEntries(keys.map(k=>[k,form.elements.namedItem(k)?.value||'']));
      function scheduleAuto(){if(!valid())return;cloudDirty=true;dirtyKeys.add(formKey);localPut(formKey,{images:items,values:valuesNow(),dirty:true}).catch(()=>{});clearTimeout(cloudTimer);cloudTimer=setTimeout(()=>saveCloud(false),2000);}
      const imageUI=imageBox(container.querySelector('[data-form-images]'),items,weekId,()=>{container.querySelector('[data-status]').textContent='图片内容有修改，等待同步。';scheduleAuto();},locked);
      const binding={container,images:imageUI,items,formKey};bindings.set(form,binding);
      api('/api/weekly-drafts/week?weekId='+encodeURIComponent(weekId)).then(result=>{if(!valid())return;remoteState=result.draft;const current=valuesNow();
        autoReady=!keys.some(k=>remoteState.values[k])||keys.every(k=>(remoteState.values[k]||'')===current[k]);
        container.querySelector('[data-status]').textContent=autoReady?'本机即时保存，停止输入后自动同步云端。':'云端已有不同内容；请先载入，或点击保存为新版本。本机内容不会清除。';
        if(autoReady&&cloudDirty)saveCloud(false);
      }).catch(error=>{if(valid())container.querySelector('[data-status]').textContent=error.message+'；本机草稿继续保留。';});
      localGet(formKey).then(saved=>{if(!container.isConnected||owner()!==person||!saved?.dirty||!saved.images?.length||locked())return;
        if(items.length&&!confirm('发现本机未提交的图片，是否恢复到当前表单？'))return;
        items.splice(0,items.length,...saved.images);imageUI.refresh();container.querySelector('[data-status]').textContent='已恢复本机图片；未上传的图片请点击重试。';}).catch(()=>{});
      container.querySelector('[data-notebook]').onclick=()=>{if(!locked())open(weekId);};
      container.querySelector('[data-load]').onclick=async()=>{if(locked())return;const status=container.querySelector('[data-status]');try{const result=await api('/api/weekly-drafts/week?weekId='+encodeURIComponent(weekId));
          const backup={values:Object.fromEntries(keys.map(k=>[k,form.elements.namedItem(k)?.value||''])),images:items};await localPut(owner()+':form-backup:'+Date.now(),backup);
          if(keys.some(k=>backup.values[k])&&!confirm('已保留当前内容的本机副本。是否载入云端草稿替换表单？'))return;
          keys.forEach(k=>{if(form.elements.namedItem(k))form.elements.namedItem(k).value=result.draft.values[k]||'';});items.splice(0,items.length,...result.draft.images.filter(i=>i.section!=='notes'));
          bindForm(form,weekId,items);form.dispatchEvent(new Event('input',{bubbles:true}));
        }catch(error){status.textContent=error.message;}};
      async function saveCloud(force){if(!valid()||locked()||cloudBusy||!force&&(!autoReady||!remoteState||!cloudDirty))return;cloudBusy=true;const status=container.querySelector('[data-status]');let acknowledged=false,snapshot;
        try{if(!remoteState)remoteState=(await api('/api/weekly-drafts/week?weekId='+encodeURIComponent(weekId))).draft;
          if(force&&!autoReady&&remoteState.revision&&!confirm('将当前表单另存为新的云端版本，旧版本保留。是否继续？'))return;
          const images=force?imageUI.refs():items.filter(i=>i.id).map(({id,caption,section})=>({id,caption,section}));snapshot={values:valuesNow(),images};const key=JSON.stringify(snapshot);
          if(!pendingSave||pendingSave.key!==key)pendingSave={key,id:crypto.randomUUID()};status.textContent='正在同步草稿…';
          const result=await api('/api/weekly-drafts/week',{method:'PUT',body:JSON.stringify({weekId,...snapshot,scratch:remoteState.scratch||'',notes:remoteState.notes,baseRevision:remoteState.revision,requestId:pendingSave.id})});if(!valid())return;
          acknowledged=true;remoteState=result.draft;autoReady=true;pendingSave=null;cloudDirty=JSON.stringify(snapshot)!==JSON.stringify({values:valuesNow(),images:items.filter(i=>i.id).map(({id,caption,section})=>({id,caption,section}))});
          if(!cloudDirty&&!items.some(i=>!i.id))dirtyKeys.delete(formKey);
          await localPut(formKey,{images:items,values:valuesNow(),dirty:cloudDirty||items.some(i=>!i.id)});
          status.textContent=items.some(i=>!i.id)?'文字已同步，仍有图片等待上传':cloudDirty?'新修改等待同步':'云端已保存 · '+new Date(result.draft.savedAt).toLocaleTimeString('zh-CN');
        }catch(error){if(valid()){if(error.code==='DRAFT_CONFLICT')autoReady=false;status.textContent=error.message+'；本机内容已保留。';}}finally{cloudBusy=false;if(acknowledged&&cloudDirty&&valid())cloudTimer=setTimeout(()=>saveCloud(false),2000);}
      }
      container.querySelector('[data-save-cloud]').onclick=()=>saveCloud(true);
      form.addEventListener('input',event=>{if(keys.includes(event.target.name))scheduleAuto();});
      form.closest('dialog')?.addEventListener('close',()=>clearTimeout(cloudTimer));
      const pasted=e=>{if(!container.isConnected)return;const files=[...(e.clipboardData?.items||[])].filter(i=>i.type.startsWith('image/')).map(i=>i.getAsFile());if(files.length){e.preventDefault();imageUI.add(files,e.target.name==='blockers'?'blockers':'progress');}};
      form.addEventListener('paste',pasted);form.addEventListener('dragover',e=>{if(container.isConnected)e.preventDefault();});form.addEventListener('drop',e=>{if(container.isConnected){e.preventDefault();imageUI.add([...e.dataTransfer.files],e.target.name==='blockers'?'blockers':'progress');}});
    }
    async function mountImages(container){for(const node of container.querySelectorAll('[data-weekly-image]')){if(node.dataset.loaded)continue;node.dataset.loaded='1';
        try{const p=new URLSearchParams({id:node.dataset.weeklyImage,owner:node.dataset.owner,recordId:node.dataset.record,submission:node.dataset.submission});const blob=await api('/api/weekly-drafts/image?'+p,{},true);const img=document.createElement('img');img.alt=node.dataset.caption||'周报图片';img.src=blobUrl(blob);node.replaceChildren(img);
          node.onclick=()=>{const preview=document.createElement('dialog');preview.className='modal';preview.innerHTML='<div class="modal-head"><h2>周报图片</h2><button class="icon-button" type="button" aria-label="关闭">×</button></div>';const full=img.cloneNode();full.style.width='100%';preview.append(full);document.body.append(preview);preview.querySelector('button').onclick=()=>preview.close();preview.onclose=()=>preview.remove();preview.showModal();};
        }catch(_){node.textContent='图片暂时无法读取，点击重试';node.onclick=()=>{delete node.dataset.loaded;mountImages(container);};}}
    }
    return {open,reset,bindForm,mountImages,imagesFor:form=>bindings.get(form)?.images.refs().filter(i=>i.section!=='notes')||[],markSubmitted:form=>{const b=bindings.get(form);if(b){dirtyKeys.delete(b.formKey);localPut(b.formKey,{images:[],dirty:false}).catch(()=>{});}},localGet};
  }
  root.ER2WeeklyDrafts={create};
})(typeof window==='undefined'?globalThis:window);
