export const TR='tr-TR';
export const esc=s=>(s??'').toString().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");
export const T=s=>(s??'').toString().trim();
export const D=s=>(s??'').toString().replace(/[^\d]/g,'').trim();
export const nowISO=()=>new Date().toISOString();

export function detectDelimiter(h){
  const c=['\t',';',',','|'];let best=c[0],m=-1;
  for(const d of c){const k=h.split(d).length-1;if(k>m){m=k;best=d}}
  return best
}

export function parseDelimited(text){
  const lines=text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
  const first=lines.find(x=>x.trim())||'';const delim=detectDelimiter(first);
  const split=line=>{
    const out=[];let cur='',q=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];
      if(ch==='"'){if(q&&line[i+1]==='"'){cur+='"';i++}else q=!q}
      else if(!q&&ch===delim){out.push(cur);cur=''}
      else cur+=ch
    }
    out.push(cur);return out.map(v=>v.trim())
  };
  let hdr=null,rows=[];
  for(const line of lines){
    if(!line||!line.trim())continue;
    if(!hdr){hdr=split(line);continue}
    const vals=split(line),obj={};
    for(let i=0;i<hdr.length;i++)obj[hdr[i]]=vals[i]??'';
    rows.push(obj)
  }
  return{hdr:hdr||[],rows}
}

export const normHeader=h=>(h??'').toString().trim().toLocaleUpperCase(TR).replace(/\s+/g,' ');
export function pickColumn(rowObj,wanted){
  const map=new Map(Object.keys(rowObj).map(k=>[normHeader(k),k]));
  for(const w of wanted){const k=map.get(normHeader(w));if(k)return k}
  return null
}

export function downloadBlob(filename,blob){
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1200)
}

export function toCSV(rows,cols,delimiter=','){
  const q=v=>{
    v=(v??'').toString();
    return(v.includes('"')||v.includes('\n')||v.includes('\r')||v.includes(delimiter))?('"'+v.replace(/"/g,'""')+'"'):v
  };
  return cols.map(q).join(delimiter)+'\n'+rows.map(r=>cols.map(c=>q(r[c])).join(delimiter)).join('\n')
}

export async function readFileText(file){
  return new Promise((res,rej)=>{
    const fr=new FileReader();
    fr.onload=()=>res(fr.result);
    fr.onerror=()=>rej(fr.error);
    fr.readAsText(file,'UTF-8')
  })
}

export function stockToNumber(raw,{source}={}){
  const s=(raw??'').toString().trim();if(!s)return 0;
  if(source==='products'&&s==='-')return 0;
  const up=s.toLocaleUpperCase(TR);
  if(source==='compel'){
    if(/(STOK\s*YOK|YOK|TÜKEND[İI]|TUKENDI|OUT\s*OF\s*STOCK|NONE|N\/A|NA)/i.test(up))return 0;
    if(/(VAR|STOKTA|MEVCUT|AVAILABLE|IN\s*STOCK|EVET|YES|TRUE)/i.test(up))return 1;
  }
  let t=s;
  if(t.includes('.')&&t.includes(','))t=t.replace(/\./g,'').replace(/,/g,'.');
  else t=t.replace(/,/g,'.');
  t=t.replace(/[^0-9.\-]/g,'');
  const n=parseFloat(t);
  return Number.isFinite(n)?n:0
}
export const inStock=(raw,opts)=>stockToNumber(raw,opts)>0;
