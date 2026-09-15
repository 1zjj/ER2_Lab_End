export const WEEKLY_IMAGE_FIELD = '周报图文';
export const IMAGE_LIMIT = 2 * 1024 * 1024;
const fail = message => Object.assign(new Error(message),{status:400});
export function imageManifest(record) {
  const raw=record?.fields?.[WEEKLY_IMAGE_FIELD];
  if(!raw)return [];
  const text=Array.isArray(raw)?raw.map(v=>v.text||'').join(''):String(raw);
  try {const value=JSON.parse(text);return validateImageRefs(value.images);} catch(_){throw fail('周报图片清单无效，请核对原记录');}
}
export function validateImageRefs(images) {
  if(!Array.isArray(images)||images.length>10)throw fail('每份周报最多10张图片');
  const seen=new Set();return images.map(image=>{
    if(!image||!/^img_[a-f0-9]{64}$/.test(image.id)||seen.has(image.id))throw fail('图片标识无效或重复');seen.add(image.id);
    if(typeof image.caption!=='string'||image.caption.length>200||!['progress','blockers','notes'].includes(image.section))throw fail('图片说明或位置无效');
    return {id:image.id,caption:image.caption,section:image.section};
  });
}
// Accept only bounded PNG/JPEG raster data; remove metadata before private storage.
export function normalizeImage(raw) {
  const b=new Uint8Array(raw);if(!b.length||b.length>IMAGE_LIMIT)throw fail('压缩后图片不能超过2MB');
  const dv=new DataView(b.buffer,b.byteOffset,b.byteLength), parts=[];let width=0,height=0,mime='';
  if(b.length>=33&&[137,80,78,71,13,10,26,10].every((x,i)=>b[i]===x)){
    mime='image/png';parts.push(b.slice(0,8));let p=8,ended=false;
    while(p+12<=b.length){const len=dv.getUint32(p),end=p+12+len;if(end>b.length)throw fail('PNG内容不完整');
      const type=String.fromCharCode(...b.slice(p+4,p+8));
      if(p===8){if(type!=='IHDR'||len!==13)throw fail('PNG头部无效');width=dv.getUint32(p+8);height=dv.getUint32(p+12);}
      if(!['eXIf','tEXt','zTXt','iTXt'].includes(type))parts.push(b.slice(p,end));p=end;
      if(type==='IEND'){ended=true;break;}
    }if(!ended)throw fail('PNG未完整上传');
  }else if(b.length>4&&b[0]===255&&b[1]===216&&b.at(-2)===255&&b.at(-1)===217){
    mime='image/jpeg';parts.push(b.slice(0,2));let p=2,ended=false;
    while(p+4<=b.length){if(b[p]!==255)throw fail('JPEG标记无效');while(b[p]===255)p++;const marker=b[p++];
      if(marker===218){parts.push(b.slice(p-2));ended=true;break;}
      const len=dv.getUint16(p),end=p+len;if(len<2||end>b.length)throw fail('JPEG内容不完整');
      if([192,193,194].includes(marker)){if(len<8)throw fail('JPEG尺寸无效');height=dv.getUint16(p+3);width=dv.getUint16(p+5);}
      if(![225,237,254].includes(marker))parts.push(b.slice(p-2,end));p=end;
    }if(!ended)throw fail('JPEG未完整上传');
  }else throw fail('请上传经过压缩的PNG或JPEG图片');
  if(!width||!height||width>4096||height>4096||width*height>12000000)throw fail('图片尺寸过大或无效');
  const output=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const part of parts){output.set(part,offset);offset+=part.length;}
  return {bytes:output,mime,width,height};
}
