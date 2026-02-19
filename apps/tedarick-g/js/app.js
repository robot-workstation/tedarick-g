// Tedarick-G: Compel(ve ileride diğerleri) Worker taraması + Compare motoru (2.robot) birleştirme
import { parseDelimited, pickColumn, readFileText, downloadBlob, toCSV, nowISO } from '../../compare/js/utils.js';
import { COLS, B } from '../../compare/js/constants.js';
import { createDepot } from '../../compare/js/depot.js';
import { buildProductIndexes, runMatch, outRow, ensureMapShape } from '../../compare/js/matcher.js';
import * as ui from '../../compare/js/ui.js';

const $ = id => document.getElementById(id);

/* =======================
   Supplier Registry (LS)
   ======================= */
const LS_KEY = 'tg.suppliers';
const LS_ACTIVE = 'tg.activeSupplier';

const DEFAULT_SUPPLIERS = [
  {
    slug: 'compel',
    name: 'Compel',
    apiBase: 'https://robot-workstation.tvkapora.workers.dev', // senin mevcut worker
    origin: 'https://compel.com.tr'
  }
];

function loadSuppliers() {
  try {
    const x = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (Array.isArray(x) && x.length) return x;
  } catch {}
  localStorage.setItem(LS_KEY, JSON.stringify(DEFAULT_SUPPLIERS));
  return [...DEFAULT_SUPPLIERS];
}
function saveSuppliers(list) {
  localStorage.setItem(LS_KEY, JSON.stringify(list || []));
}
function getActiveSlug() {
  return localStorage.getItem(LS_ACTIVE) || 'compel';
}
function setActiveSlug(slug) {
  localStorage.setItem(LS_ACTIVE, slug);
}

/* =======================
   State
   ======================= */
let suppliers = loadSuppliers();
let active = suppliers.find(s => s.slug === getActiveSlug()) || suppliers[0];
setActiveSlug(active.slug);

let brands = [];            // /api/brands
let sel = new Set();        // brand id set
let scanProducts = [];      // worker scan sonucu (product mesajları)
let lastScanKey = '';       // selection hash
let abortCtrl = null;

let L1 = [], L2 = [], L2all = [];
let C1 = {
  siraNo: 'Sıra No',
  marka: 'Marka',
  urunAdi: 'Ürün Adı',
  urunKodu: 'Ürün Kodu',
  stok: 'Stok',
  ean: 'EAN',
  link: 'Link'
};
let C2 = {};
let idxB = new Map(), idxW = new Map(), idxS = new Map();
let R = [], U = [];
let map = ensureMapShape({});

const depot = createDepot();

/* =======================
   UI helpers
   ======================= */
function setSelLabel() {
  $('selLabel').textContent = `Seçili Tedarikçi: ${active?.name || ''}`;
}
function esc(s){return String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");}

function renderSupplierSelect() {
  const selEl = $('supplierSel');
  selEl.innerHTML = suppliers
    .map(s => `<option value="${esc(s.slug)}"${s.slug===active.slug?' selected':''}>${esc(s.name)}</option>`)
    .join('');
  setSelLabel();
}

function renderBrands() {
  const grid = $('brandGrid');
  grid.innerHTML = '';

  // TR sort
  const list = [...brands].sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'tr',{sensitivity:'base'}));

  for (const b of list) {
    const d = document.createElement('div');
    d.className = 'brand' + (sel.has(b.id) ? ' sel' : '');
    d.dataset.id = String(b.id);
    d.tabIndex = 0;
    d.innerHTML = `<span class="nm" title="${esc(b.name)}">${esc(b.name)}</span><span class="ct">(${esc(b.count)})</span>`;
    d.onclick = () => {
      const id = Number(b.id);
      if (sel.has(id)) { sel.delete(id); d.classList.remove('sel'); }
      else { sel.add(id); d.classList.add('sel'); }
    };
    d.onkeydown = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      d.onclick();
    };
    grid.appendChild(d);
  }
}

/* =======================
   Worker scan (NDJSON)
   ======================= */
function selectionKey() {
  const ids = [...sel].sort((a,b)=>a-b);
  return active.slug + '::' + ids.join(',');
}

async function loadBrands() {
  ui.setStatus('Markalar yükleniyor…', 'unk');
  brands = [];
  sel.clear();
  renderBrands();

  const url = `${active.apiBase}/api/brands`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    ui.setStatus('Marka alınamadı', 'bad');
    const t = await res.text().catch(()=> '');
    console.warn('brands err', res.status, t);
    return;
  }
  brands = await res.json();
  ui.setStatus('Hazır', 'ok');
  renderBrands();
}

function setStopEnabled(on) {
  $('btnStop').disabled = !on;
}

async function scanSelectedBrands() {
  if (!sel.size) throw new Error('En az 1 marka seç.');
  const chosen = brands.filter(b => sel.has(b.id));
  if (!chosen.length) throw new Error('Marka seçimi boş.');

  // zaten güncelse tekrar tarama yok
  const key = selectionKey();
  if (key === lastScanKey && scanProducts.length) return;

  lastScanKey = key;
  scanProducts = [];

  abortCtrl = new AbortController();
  setStopEnabled(true);
  ui.setStatus('Taranıyor…', 'unk');

  const res = await fetch(`${active.apiBase}/api/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ brands: chosen }),
    signal: abortCtrl.signal
  });

  if (!res.ok) {
    const t = await res.text().catch(()=> '');
    throw new Error(`Tarama hata: ${res.status}\n${t}`);
  }

  const rd = res.body?.getReader?.();
  if (!rd) throw new Error('Stream yok (body reader bulunamadı).');

  const dec = new TextDecoder();
  let buf = '';

  while (true) {
    const { value, done } = await rd.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });

    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;

      const m = JSON.parse(line);

      if (m.type === 'brandStart') {
        ui.setStatus(`${m.brand} (1/${m.pages})`, 'unk');
      } else if (m.type === 'page') {
        ui.setStatus(`${m.brand} (${m.page}/${m.pages})`, 'unk');
      } else if (m.type === 'product') {
        if (m.data) scanProducts.push(m.data);
      } else if (m.type === 'brandDone') {
        ui.setStatus(`${m.brand} bitti`, 'unk');
      } else if (m.type === 'error') {
        console.warn('scan error', m.message);
      } else if (m.type === 'done') {
        // ok
      }
    }
  }

  ui.setStatus('Tarama bitti', 'ok');
  setStopEnabled(false);
  abortCtrl = null;
}

$('btnStop').onclick = () => { if (abortCtrl) abortCtrl.abort(); };

/* =======================
   Compare pipeline (2.robot)
   ======================= */
function buildL1FromScan() {
  // worker product: {brand,title,productCode,stock,ean,url}
  let n = 0;
  return scanProducts.map(p => {
    n++;
    return {
      'Sıra No': String(n),
      'Marka': String(p.brand || ''),
      'Ürün Adı': String(p.title || 'Ürün'),
      'Ürün Kodu': String(p.productCode || ''),
      'Stok': String(p.stock || ''),
      'EAN': String(p.ean || ''),
      'Link': String(p.url || '')
    };
  });
}

async function loadSescibabaCsv() {
  const f = $('f2').files?.[0];
  if (!f) throw new Error('Sescibaba Stok CSV seç.');

  const t = await readFileText(f);
  const p = parseDelimited(t);
  if (!p.rows.length) throw new Error('Sescibaba CSV boş.');

  const s2 = p.rows[0];
  C2 = {
    ws: pickColumn(s2, ['Web Servis Kodu', 'WebServis Kodu', 'WebServisKodu']),
    urunAdi: pickColumn(s2, ['Ürün Adı', 'Urun Adi', 'Ürün Adi']),
    sup: pickColumn(s2, ['Tedarikçi Ürün Kodu', 'Tedarikci Urun Kodu', 'Tedarikçi Urun Kodu']),
    barkod: pickColumn(s2, ['Barkod', 'BARKOD']),
    stok: pickColumn(s2, ['Stok']),
    marka: pickColumn(s2, ['Marka']),
    seo: pickColumn(s2, ['SEO Link', 'Seo Link', 'SEO', 'Seo'])
  };

  const need = (o, a) => a.filter(k => !o[k]);
  const m2 = need(C2, ['ws','sup','barkod','stok','marka','urunAdi','seo']);
  if (m2.length) throw new Error('Sescibaba sütun eksik: ' + m2.join(', '));

  L2all = p.rows;

  // Compel tarafında seçilen markalara göre filtreleme (2.robotla aynı)
  const brandsSet = new Set(L1.map(r => B(r[C1.marka] || '')).filter(Boolean));
  L2 = L2all.filter(r => brandsSet.has(B(r[C2.marka] || '')));

  ({ idxB, idxW, idxS } = buildProductIndexes(L2, C2));
  ui.populateDatalists(L2, C2);

  ui.setChip('l2Chip', `L2:${L2.length}/${L2all.length}`);
}

async function loadMapJsonIfAny() {
  const j = $('f3').files?.[0];
  if (!j) {
    map = ensureMapShape({});
    ui.chipVis('jsonChip', false);
    return;
  }
  try {
    const t = await readFileText(j);
    map = ensureMapShape(JSON.parse(t));
    const n = Object.keys(map.mappings || {}).length;
    ui.setChip('jsonChip', `JSON:${n}`, 'muted');
    ui.chipVis('jsonChip', true);
  } catch {
    alert('JSON okunamadı, mapping kullanılmadan devam.');
    map = ensureMapShape({});
    ui.chipVis('jsonChip', false);
  }
}

function rerunCompare() {
  const out = runMatch({ L1, C1, C2, idxB, idxW, idxS, map, depot });
  R = out.R; U = out.U;

  ui.renderTables({
    COLS,
    R,
    U,
    depotReady: depot.state.ready,
    onManual
  });

  // L1 chip
  ui.setChip('l1Chip', `L1:${L1.length}`);
  $('dl1').disabled = !R.length;
  $('dl3').disabled = false;
  ui.setStatus('Hazır', 'ok');
}

function onManual(i, ws, sup) {
  const r = U[i]; if (!r) return;
  const r2 = (ws && idxW.get(ws)) || (sup && idxS.get(sup)) || null;
  if (!r2) return alert('Ürün bulunamadı (marka filtresi sebebiyle de olabilir).');

  const b1 = r._bn, b2 = B(r2[C2.marka] || '');
  if (b1 && b2 && b1 !== b2 && !confirm(`Marka farklı:\n1) ${b1}\n2) ${b2}\nYine de eşleştirilsin mi?`)) return;

  map.mappings = map.mappings || {};
  map.mappings[r._k] = {
    webServisKodu: String(r2[C2.ws] || '').trim(),
    tedarikciUrunKodu: String(r2[C2.sup] || '').trim(),
    barkod: String(r2[C2.barkod] || '').trim(),
    updatedAt: nowISO()
  };
  map.meta = map.meta || {};
  map.meta.updatedAt = nowISO();

  const idx = R.findIndex(x => x._k === r._k);
  if (idx >= 0) {
    const stub = {
      [C1.siraNo]: r["Sıra No"],
      [C1.marka]: r["Marka"],
      [C1.urunAdi]: r["Ürün Adı (Compel)"],
      [C1.urunKodu]: r["Ürün Kodu (Compel)"],
      [C1.stok]: r._s1raw || '',
      [C1.ean]: r["EAN (Compel)"],
      [C1.link]: r._clink || ''
    };
    R[idx] = outRow({ r1: stub, r2, how: 'MANUAL', C1, C2, depot });
    R[idx]._k = r._k; R[idx]._bn = b1;
  }

  U.splice(i, 1);
  ui.renderTables({ COLS, R, U, depotReady: depot.state.ready, onManual });
}

/* =======================
   Depo modal (2.robot aynısı)
   ======================= */
const depoModal = $('depoModal');
const depoPaste = $('depoPaste');

const showDepo = () => { depoModal.style.display = 'flex'; depoModal.setAttribute('aria-hidden','false'); setTimeout(()=>depoPaste?.focus(),0); };
const hideDepo = () => { depoModal.style.display = 'none'; depoModal.setAttribute('aria-hidden','true'); };

$('depoBtn').onclick = showDepo;
$('depoClose').onclick = hideDepo;
$('depoClear').onclick = () => { depoPaste.value=''; depoPaste.focus(); };
$('depoLoad').onclick = () => {
  const res = depot.loadFromText(depoPaste.value || '');
  if (!res.ok) return alert(res.message);
  ui.setDepoUi(true, depot.state.L4.length);
  ui.setStatus('Depo yüklendi', 'ok');
  if (L1.length && L2.length) rerunCompare();
  hideDepo();
};

addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && depoModal?.style.display === 'flex') hideDepo();
});

/* =======================
   Exports (2.robot aynısı)
   ======================= */
$('dl1').onclick = () => {
  const clean = R.map(r => Object.fromEntries(COLS.map(c => [c, r[c]])));
  downloadBlob('sonuc-eslestirme.csv', new Blob([toCSV(clean, COLS)], { type: 'text/csv;charset=utf-8' }));
};
$('dl2').onclick = () => {
  const cols = ["Sıra No", "Marka", "Ürün Adı (Compel)", "Ürün Kodu (Compel)", "Stok (Compel)", "EAN (Compel)"];
  const clean = U.map(r => Object.fromEntries(cols.map(c => [c, r[c]])));
  downloadBlob('eslesmeyenler.csv', new Blob([toCSV(clean, cols)], { type: 'text/csv;charset=utf-8' }));
};
$('dl3').onclick = () => {
  map.meta = map.meta || {};
  map.meta.updatedAt = nowISO();
  downloadBlob('mapping.json', new Blob([JSON.stringify(map, null, 2)], { type: 'application/json;charset=utf-8' }));
};

/* =======================
   Go button
   ======================= */
ui.setGoMode('list');

$('go').onclick = async () => {
  // clear mode (compare ui.js toggle mantığı)
  if ($('go').dataset.mode === 'clear') return location.reload();

  try {
    // 1) scan
    await scanSelectedBrands();
    L1 = buildL1FromScan();
    ui.setChip('l1Chip', `L1:${L1.length}`);

    // 2) sescibaba + map
    await loadSescibabaCsv();
    await loadMapJsonIfAny();

    // 3) compare
    rerunCompare();

    // chips
    ui.setChip('l4Chip', depot.state.ready ? `L4:${depot.state.L4.length}` : 'L4:-');
    ui.setChip('l1Chip', `L1:${L1.length}`);
    ui.setChip('l2Chip', `L2:${L2.length}/${L2all.length}`);

    // go mode -> clear
    ui.setGoMode('clear');
  } catch (e) {
    if (abortCtrl?.signal?.aborted) {
      ui.setStatus('Durduruldu', 'unk');
    } else {
      ui.setStatus('Hata', 'bad');
      alert(String(e?.message || e));
    }
    setStopEnabled(false);
    abortCtrl = null;
  }
};

/* =======================
   File labels (2.robot)
   ======================= */
ui.bindFileLabel('f2', 'n2', 'Yükle');
ui.bindFileLabel('f3', 'n3', 'Yükle');
ui.setDepoUi(false, 0);

/* =======================
   Brand select buttons
   ======================= */
$('btnAll').onclick = () => { brands.forEach(b=>sel.add(b.id)); renderBrands(); };
$('btnNone').onclick = () => { sel.clear(); renderBrands(); };

/* =======================
   Supplier change + add supplier modal
   ======================= */
$('supplierSel').onchange = async () => {
  const slug = $('supplierSel').value;
  const found = suppliers.find(s => s.slug === slug);
  if (!found) return;
  active = found;
  setActiveSlug(active.slug);
  setSelLabel();
  // reset scan cache
  scanProducts = [];
  lastScanKey = '';
  await loadBrands();
};

const supModal = $('supModal');
const showSup = () => { supModal.style.display='flex'; supModal.setAttribute('aria-hidden','false'); setTimeout(()=>$('supName')?.focus(),0); };
const hideSup = () => { supModal.style.display='none'; supModal.setAttribute('aria-hidden','true'); };

$('btnAddSupplier').onclick = showSup;
$('supClose').onclick = hideSup;

function normalizeSlug(s){
  return String(s||'').trim().toLowerCase().replace(/[^a-z0-9\-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'');
}

$('supSave').onclick = () => {
  const name = String($('supName').value||'').trim();
  const slug = normalizeSlug($('supSlug').value||name);
  const apiBase = String($('supApi').value||'').trim();
  const origin = String($('supOrigin').value||'').trim();

  if (!name || !slug) return alert('Ad/Slug boş olamaz.');
  if (!apiBase) return alert('Worker API Base gerekli.');

  const exist = suppliers.find(x => x.slug === slug);
  if (exist) {
    exist.name = name; exist.apiBase = apiBase; exist.origin = origin || exist.origin;
  } else {
    suppliers.push({ slug, name, apiBase, origin });
  }
  saveSuppliers(suppliers);
  active = suppliers.find(s=>s.slug===slug) || suppliers[0];
  setActiveSlug(active.slug);
  renderSupplierSelect();
  hideSup();
  loadBrands().catch(()=>{});
};

function workerTemplate({ origin, cfg }) {
  // minimal: Compel worker template + ORIGIN + markalarPath override (cfg.markalarPath)
  const markalarPath = (cfg && cfg.markalarPath) ? String(cfg.markalarPath) : '/markalar';
  return `// Generated by Tedarick-G (template)
// Cloudflare Worker (Module): /api/brands + /api/scan (NDJSON)
const ORIGIN = ${JSON.stringify(origin || "https://example.com")};
const MARKALAR_PATH = ${JSON.stringify(markalarPath)};

// Fallback boş (UI bozulmasın diye)
const FALLBACK_BRANDS = [];

function corsHeaders(){return{
 "access-control-allow-origin":"*",
 "access-control-allow-methods":"GET,POST,OPTIONS",
 "access-control-allow-headers":"content-type",
 "access-control-max-age":"86400"}}

function json(data,status=200,extraHeaders={}){
 return new Response(JSON.stringify(data),{status,headers:{
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store",
  ...corsHeaders(),...extraHeaders}})
}
function textResponse(body,status=200,extraHeaders={}){
 return new Response(body,{status,headers:{
  "content-type":"text/plain; charset=utf-8",
  "cache-control":"no-store",
  ...corsHeaders(),...extraHeaders}})
}

function decodeHtmlEntities(s){
 s=String(s??"");
 const map={"&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"',"&#39;":"'","&nbsp;":" "};
 s=s.replace(/&(amp|lt|gt|quot|nbsp);|&#39;/g,m=>map[m]??m);
 s=s.replace(/&#x([0-9a-f]+);/gi,(_,hex)=>{const cp=parseInt(hex,16);if(!Number.isFinite(cp))return"";try{return String.fromCodePoint(cp)}catch{return""}});
 s=s.replace(/&#(\\d+);/g,(_,num)=>{const cp=parseInt(num,10);if(!Number.isFinite(cp))return"";try{return String.fromCodePoint(cp)}catch{return""}});
 return s
}
function stripTags(s){return String(s??"").replace(/<[^>]+>/g," ").replace(/\\s+/g," ").trim()}

async function cachedFetch(url, ctx, cacheSeconds=300){
 const cache=caches.default;
 const req=new Request(url,{method:"GET",headers:{
  "user-agent":"Mozilla/5.0",
  accept:"text/html,application/xhtml+xml",
  "accept-language":"tr-TR,tr;q=0.9,en;q=0.8"}});
 const cached=await cache.match(req); if(cached) return cached.clone();
 const resp=await fetch(req,{cf:{cacheTtl:cacheSeconds,cacheEverything:true}});
 if(resp.ok) ctx.waitUntil(cache.put(req, resp.clone()));
 return resp
}

// ⚠️ Varsayılan: Compel benzeri /brand/{id}-{slug}. Gerekirse burayı düzenlersin.
function parseBrandsFromMarkalar(html){
 const byId=new Map();
 const aRe=/<a\\b[^>]*href="([^"]*\\/brand\\/(\\d+)-([^"\\/?#]+)[^"]*)"[^>]*>([\\s\\S]*?)<\\/a>/gi;
 let m;
 while((m=aRe.exec(html))!==null){
  const id=Number(m[2]); const slug=decodeURIComponent(m[3]||"");
  const raw=decodeHtmlEntities(stripTags(m[4]));
  if(!Number.isFinite(id)||!slug) continue;
  const obj=byId.get(id)||{id,slug,name:"",count:null};
  const c=raw.match(/(\\d+)\\s*ürün/i);
  if(c) obj.count=Number(c[1]);
  else if(raw && raw.length<=60) obj.name=raw;
  byId.set(id,obj);
 }
 const out=[];
 for(const o of byId.values()){
  if(!o.name) o.name=decodeHtmlEntities(o.slug.replace(/[-_]+/g," ")).trim()||("Brand "+o.id);
  if(typeof o.count!=="number"||!Number.isFinite(o.count)) continue;
  out.push({id:o.id,slug:o.slug,name:o.name,count:o.count});
 }
 return out
}
function brandUrl(b){return \`\${ORIGIN}/brand/\${b.id}-\${b.slug}\`}
function parseLastPage(html){
 let max=1; const re=/\\?page=(\\d+)/g; let m;
 while((m=re.exec(html))!==null){const n=Number(m[1]); if(Number.isFinite(n)&&n>max) max=n}
 return max
}
function titleFromUrl(url){
 try{const u=new URL(url);const last=u.pathname.split("/").filter(Boolean).pop()||"";const base=last.replace(/\\.html$/i,"");
  if(!base) return ""; return decodeHtmlEntities(decodeURIComponent(base.replace(/[-_]+/g," ").trim()));
 }catch{return""}
}
function parseProductsFromBrandHtml(html, brandName){
 const products=[]; const seen=new Set();
 const articleRe=/<article\\b[^>]*\\bproduct-miniature\\b[^>]*>[\\s\\S]*?<\\/article>/gi;
 let art;
 while((art=articleRe.exec(html))!==null){
  const block=art[0];
  const urlMatch=
   block.match(/href="(https?:\\/\\/[^"]+?\\.html[^"]*)"/i)||
   block.match(/href="(\\/[^"]+?\\.html[^"]*)"/i)||
   block.match(/href="(https?:\\/\\/[^"]+\\/index\\.php\\?[^"]*controller=product[^"]*)"/i)||
   block.match(/href="(\\/index\\.php\\?[^"]*controller=product[^"]*)"/i);
  if(!urlMatch) continue;
  let url=urlMatch[1]; if(url.startsWith("/")) url=ORIGIN+url;

  let title=
   (block.match(/data-product-name="([^"]+)"/i)||[])[1]||
   (block.match(/aria-label="([^"]+)"/i)||[])[1]||
   (block.match(/class="[^"]*\\bproduct-title\\b[^"]*"[^>]*>\\s*<a[^>]*>([\\s\\S]*?)<\\/a>/i)||[])[1]||
   "";
  title=decodeHtmlEntities(stripTags(title));
  if(!title) title=titleFromUrl(url)||"Ürün";

  let stockCount=null,inStock=null;
  const stokDurumu=block.match(/Stok\\s*Durumu\\s*:\\s*(\\d+)/i);
  if(stokDurumu){stockCount=Number(stokDurumu[1]); inStock=stockCount>0}
  else if(/Stokta\\s*Yok/i.test(block)){inStock=false; stockCount=0}
  else if(/Sepete\\s*Ekle/i.test(block)){inStock=true}
  const stockText=inStock===true?(stockCount!=null?\`\${stockCount} Stokta Var\`:"Stokta Var"):inStock===false?"Stokta Yok":"Bilinmiyor";

  let ean="";
  const eanFromUrl=url.match(/(\\d{13})(?=\\.html($|\\?))/); if(eanFromUrl) ean=eanFromUrl[1];
  if(!ean){const e1=block.match(/ean13[^0-9]{0,10}(\\d{13})/i); if(e1) ean=e1[1];
   const e2=block.match(/\\bEAN\\b[^0-9]{0,10}(\\d{13})/i); if(!ean && e2) ean=e2[1];}

  let productCode=
   (block.match(/Ürün\\s*Kodu[^A-Z0-9]{0,20}([A-Z0-9._-]{2,})/i)||[])[1]||
   (block.match(/Referans[^A-Z0-9]{0,20}([A-Z0-9._-]{2,})/i)||[])[1]||
   (block.match(/SKU[^A-Z0-9]{0,20}([A-Z0-9._-]{2,})/i)||[])[1]||
   (block.match(/data-product-reference="([^"]+)"/i)||[])[1]||
   "";
  productCode=decodeHtmlEntities(productCode).trim();
  if(!productCode){
   const pid=(block.match(/data-id-product="(\\d+)"/i)||[])[1]||(block.match(/data-product-id="(\\d+)"/i)||[])[1]||"";
   if(pid) productCode=pid
  }

  if(!seen.has(url)){
   seen.add(url);
   products.push({brand:brandName,title,productCode,stock:stockText,ean,url});
  }
 }
 return products
}

async function handleBrands(ctx){
 const url=\`\${ORIGIN}\${MARKALAR_PATH}\`;
 const resp=await cachedFetch(url, ctx, 300);
 if(!resp.ok) return json(FALLBACK_BRANDS,200,{"x-brand-source":"fallback_http"});
 const html=await resp.text();
 const brands=parseBrandsFromMarkalar(html);
 if(!brands.length) return json(FALLBACK_BRANDS,200,{"x-brand-source":"fallback_parse"});
 return json(brands,200,{"x-brand-source":"markalar"})
}

async function handleScan(request, ctx){
 let body; try{body=await request.json()}catch{return json({error:"Bad JSON"},400)}
 const selected=Array.isArray(body?.brands)?body.brands:[];
 if(!selected.length) return json({error:"No brands"},400);

 const encoder=new TextEncoder();
 const stream=new ReadableStream({
  start(controller){
   const send=obj=>controller.enqueue(encoder.encode(JSON.stringify(obj)+"\\n"));
   const safeClose=()=>{try{controller.close()}catch{}};
   (async()=>{
    try{
     const brands=[...selected].sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"tr",{sensitivity:"base"}));
     for(const b of brands){
      const base=brandUrl(b);
      const resp1=await cachedFetch(base, ctx, 300);
      if(!resp1.ok){send({type:"error",message:\`\${b.name} alınamadı: \${resp1.status}\`}); continue;}
      const html1=await resp1.text();
      const pages=parseLastPage(html1);
      send({type:"brandStart",brand:b.name,page:1,pages});
      let found=0;
      for(const p of parseProductsFromBrandHtml(html1,b.name)){found++; send({type:"product",data:p});}
      for(let page=2; page<=pages; page++){
       send({type:"page",brand:b.name,page,pages});
       const url=\`\${base}?page=\${page}\`;
       const r=await cachedFetch(url, ctx, 300);
       if(!r.ok){send({type:"error",message:\`\${b.name} sayfa \${page} alınamadı: \${r.status}\`}); continue;}
       const html=await r.text();
       for(const p of parseProductsFromBrandHtml(html,b.name)){found++; send({type:"product",data:p});}
      }
      const expected=Number(b.count);
      send({type:"brandDone",brand:b.name,expected:Number.isFinite(expected)?expected:null,found});
     }
     send({type:"done"}); safeClose();
    }catch(e){
     send({type:"error",message:String(e?.message||e)}); safeClose();
    }
   })();
  }
 });

 return new Response(stream,{headers:{
  "content-type":"application/x-ndjson; charset=utf-8",
  "cache-control":"no-store",
  ...corsHeaders()
 }})
}

export default {
 async fetch(request, env, ctx){
  const url=new URL(request.url);
  if(request.method==="OPTIONS") return new Response(null,{status:204,headers:corsHeaders()});
  if(request.method==="GET" && (url.pathname==="/" || url.pathname==="")) return textResponse("API aktif.",200);
  if(request.method==="GET" && url.pathname==="/api/brands") return await handleBrands(ctx);
  if(request.method==="POST" && url.pathname==="/api/scan") return await handleScan(request, ctx);
  if(request.method==="GET" && url.pathname==="/health") return textResponse("ok",200);
  return textResponse("Not found",404);
 }
};`;
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/javascript;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1200);
}

$('supDownload').onclick = () => {
  const name = String($('supName').value||'').trim();
  const slug = normalizeSlug($('supSlug').value||name);
  const origin = String($('supOrigin').value||'').trim();
  if (!origin) return alert('Origin gerekli.');

  let cfg = {};
  try {
    const raw = String($('supCfg').value||'').trim();
    if (raw) cfg = JSON.parse(raw);
  } catch {
    return alert('Config JSON geçersiz.');
  }

  const code = workerTemplate({ origin, cfg });
  downloadText(`worker-${slug || 'supplier'}.js`, code);
};

/* =======================
   Init
   ======================= */
renderSupplierSelect();
ui.setStatus('Hazır', 'ok');
ui.setChip('l1Chip','L1:-'); ui.setChip('l2Chip','L2:-'); ui.setChip('l4Chip','L4:-');
ui.chipVis('jsonChip', false);

// ilk yükte markaları çek
loadBrands().catch(e => {
  ui.setStatus('Marka yükleme hatası', 'bad');
  console.warn(e);
});
