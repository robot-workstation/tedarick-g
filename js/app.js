import {
  TR, esc, T, D, nowISO,
  parseDelimited, pickColumn,
  downloadBlob, toCSV, readFileText,
  inStock
} from './utils.js';

const $ = id => document.getElementById(id);

/* =========================
   ✅ Worker API (Robot 2)
   ========================= */
const API_BASE = "https://robot-workstation.tvkapora.workers.dev"; // gerekirse değiştir

/* =========================
   ✅ Marka seçimi UI
   ========================= */
let BRANDS = [];
let SELECTED = new Set(); // brand.id
let abortCtrl = null;
let scanning = false;

const setBrandStatus = (txt) => {
  const el = $('brandStatus');
  if (el) el.textContent = txt;
};

const renderBrands = () => {
  const list = $('brandList');
  if (!list) return;
  list.innerHTML = '';

  const sorted = [...BRANDS].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), 'tr', { sensitivity: 'base' })
  );

  sorted.forEach((b, i) => {
    const d = document.createElement('div');
    d.className = 'brand' + (SELECTED.has(b.id) ? ' sel' : '');
    d.tabIndex = 0;
    d.dataset.id = String(b.id);

    d.innerHTML = `
      <div class="bRow">
        <span class="bIdx">${i + 1})</span>
        <span class="bNm" title="${esc(b.name)}">${esc(b.name)}</span>
        <span class="bCt">(${esc(b.count)})</span>
      </div>
    `;
    list.appendChild(d);
  });

  setChip('selChip', `Seçili ${SELECTED.size}`, 'muted');
};

const toggleBrand = (id, el) => {
  if (SELECTED.has(id)) {
    SELECTED.delete(id);
    el.classList.remove('sel');
  } else {
    SELECTED.add(id);
    el.classList.add('sel');
  }
  setChip('selChip', `Seçili ${SELECTED.size}`, 'muted');
};

async function loadBrands() {
  setBrandStatus('Markalar yükleniyor…');
  try {
    const res = await fetch(`${API_BASE}/api/brands`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`API /api/brands hata: ${res.status}`);
    BRANDS = await res.json();
    setBrandStatus(`Hazır • Marka: ${BRANDS.length}`);
    renderBrands();
  } catch (e) {
    setBrandStatus('Markalar yüklenemedi (API).');
    console.error(e);
  }
}

$('brandList')?.addEventListener('click', (e) => {
  const el = e.target.closest('.brand');
  if (!el) return;
  const id = Number(el.dataset.id);
  if (!Number.isFinite(id)) return;
  toggleBrand(id, el);
});
$('brandList')?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest('.brand');
  if (!el) return;
  e.preventDefault();
  const id = Number(el.dataset.id);
  if (!Number.isFinite(id)) return;
  toggleBrand(id, el);
});

/* =========================
   ✅ Robot 1 (eşleştirme)
   ========================= */

const ALIAS = new Map([
  ['ALLEN & HEATH', 'ALLEN HEATH'],
  ['MARANTZ PROFESSIONAL', 'MARANTZ'],
  ['RUPERT NEVE DESIGNS', 'RUPERT NEVE'],
  ['RØDE', 'RODE'],
  ['RØDE X', 'RODE']
]);
const bRaw = s => (s ?? '').toString().trim().toLocaleUpperCase(TR).replace(/\s+/g, ' ');
const B = s => ALIAS.get(bRaw(s)) || bRaw(s), Bx = s => bRaw(s);

let L1 = [], L2 = [], L2all = [], map = { meta: { version: 1, createdAt: nowISO(), updatedAt: nowISO() }, mappings: {} };
let C1 = {}, C2 = {}, idxB = new Map(), idxW = new Map(), idxS = new Map(), R = [], U = [];

/* ✅ Depo */
let L4 = [], C4 = {}, idxD = new Map();
let depotReady = false;

const COLS = [
  "Sıra No", "Marka",
  "Ürün Adı (Compel)", "Ürün Adı (Sescibaba)",
  "Ürün Kodu (Compel)", "Ürün Kodu (Sescibaba)",
  "Stok (Compel)", "Stok (Sescibaba)", "Stok (Depo)", "Stok Durumu",
  "EAN (Compel)", "EAN (Sescibaba)", "EAN Durumu"
];

const setChip = (id, t, cls = '') => {
  const e = $(id);
  if (!e) return;
  e.textContent = t;
  e.title = t;
  e.className = 'chip' + (cls ? ` ${cls}` : '');
};
const setStatus = (t, k = 'ok') => setChip('stChip', t, k);

const safeUrl = u => { u = T(u); if (!u || /^\s*javascript:/i.test(u)) return ''; return u; };
const SEO = 'https://www.sescibaba.com/';
const normSeo = raw => {
  let u = T(raw);
  if (!u || /^\s*javascript:/i.test(u)) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (/^www\./i.test(u)) return 'https://' + u;
  if (/^sescibaba\.com/i.test(u)) return 'https://' + u;
  return SEO + u.replace(/^\/+/, '');
};

const key = (r, fn) => {
  const b = fn(r[C1.marka] || '');
  const code = T(r[C1.urunKodu] || '');
  const name = T(r[C1.urunAdi] || '');
  return b + '||' + (code || ('NAME:' + name));
};
const kNew = r => key(r, B), kOld = r => key(r, Bx);

const eans = v => {
  v = (v ?? '').toString().trim();
  if (!v) return [];
  return v.split(/[^0-9]+/g).map(D).filter(x => x.length >= 8);
};

const colGrp = w => `<colgroup>${w.map(x => `<col style="width:${x}%">`).join('')}</colgroup>`;
const disp = c => c === "Sıra No" ? "Sıra" : c;
const fmtHdr = s => {
  s = (s ?? '').toString();
  const m = s.match(/^(.*?)(\s*\([^)]*\))\s*$/);
  if (!m) return esc(s);
  return `<span class="hMain">${esc(m[1].trimEnd())}</span> <span class="hParen">${esc(m[2].trim())}</span>`;
};

function buildIdx() {
  idxB = new Map(); idxW = new Map(); idxS = new Map();
  for (const r of L2) {
    const bark = D(r[C2.barkod] || ''), ws = T(r[C2.ws] || ''), sup = T(r[C2.sup] || '');
    if (bark) { if (!idxB.has(bark)) idxB.set(bark, []); idxB.get(bark).push(r); }
    if (ws) idxW.set(ws, r);
    if (sup) idxS.set(sup, r);
  }

  const wsDl = $('wsCodes'), supDl = $('supCodes');
  if (wsDl) wsDl.innerHTML = '';
  if (supDl) supDl.innerHTML = '';
  let a = 0, b = 0, MAX = 2e4;
  for (const r of L2) {
    const w = T(r[C2.ws] || ''), p = T(r[C2.sup] || ''), br = T(r[C2.marka] || ''), nm = T(r[C2.urunAdi] || '');
    if (wsDl && w && a < MAX) { const o = document.createElement('option'); o.value = w; o.label = (br + ' - ' + nm).slice(0, 140); wsDl.appendChild(o); a++; }
    if (supDl && p && b < MAX) { const o = document.createElement('option'); o.value = p; o.label = (br + ' - ' + nm).slice(0, 140); supDl.appendChild(o); b++; }
  }
}

/* ✅ Depo normalize */
const depotCodeNorm = s =>
  (s ?? '').toString()
    .replace(/\u00A0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleUpperCase(TR);

const depotCodeAlt = n => {
  if (!n) return '';
  if (!/^[0-9]+$/.test(n)) return '';
  return n.replace(/^0+(?=\d)/, '');
};

function depotStockNum(raw) {
  let s = (raw ?? '').toString().trim();
  if (!s) return 0;
  if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(/,/g, '.');
  else s = s.replace(/,/g, '.');
  s = s.replace(/[^0-9.\-]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function buildDepotIdx() {
  idxD = new Map();
  if (!depotReady || !L4.length || !C4.stokKodu) return;

  for (const r of L4) {
    const raw = r[C4.stokKodu] ?? '';
    const k = depotCodeNorm(raw);
    if (!k) continue;

    if (!idxD.has(k)) idxD.set(k, []);
    idxD.get(k).push(r);

    const alt = depotCodeAlt(k);
    if (alt && alt !== k) {
      if (!idxD.has(alt)) idxD.set(alt, []);
      idxD.get(alt).push(r);
    }
  }
}

function depotAgg(code) {
  if (!depotReady) return { num: 0, raw: '' };
  const k = depotCodeNorm(code || '');
  if (!k) return { num: 0, raw: '0' };

  const alt = depotCodeAlt(k);
  const arr = idxD.get(k) || (alt ? idxD.get(alt) : null);
  if (!arr?.length) return { num: 0, raw: '0' };

  let sum = 0;
  for (const r of arr) sum += depotStockNum(r[C4.stok] ?? '');
  return { num: sum, raw: String(sum) };
}

function byEan(r1) {
  const br1 = B(r1[C1.marka] || '');
  for (const e of eans(r1[C1.ean] || '')) {
    const arr = idxB.get(e);
    if (arr?.length) return arr.find(r2 => B(r2[C2.marka] || '') === br1) || arr[0];
  }
  return null;
}
function byCompelCodeWs(r1) {
  const code = T(r1[C1.urunKodu] || ''); if (!code) return null;
  const r2 = idxW.get(code) || null; if (!r2) return null;
  const b1 = B(r1[C1.marka] || ''), b2 = B(r2[C2.marka] || '');
  if (b1 && b2 && b1 !== b2) return null;
  return r2;
}
function byMap(r1) {
  const m = map.mappings || {}, ent = m[kNew(r1)] ?? m[kOld(r1)];
  if (!ent) return null;
  if (typeof ent === 'string') return idxW.get(ent) || idxS.get(ent) || null;
  const ws = T(ent.webServisKodu || ent.ws || ''), sup = T(ent.tedarikciUrunKodu || ent.supplier || '');
  return (ws && idxW.get(ws)) || (sup && idxS.get(sup)) || null;
}

/* ✅ Stok label */
const compelLbl = raw => {
  const s = (raw ?? '').toString().trim();
  if (!s) return '';
  return inStock(s, { source: 'compel' }) ? 'Stokta Var' : 'Stokta Yok';
};
const sesciLbl = (raw, ok) => ok ? (inStock(raw, { source: 'products' }) ? 'Stokta Var' : 'Stokta Yok') : '';
const depoLbl = (dNum) => {
  if (!depotReady) return '—';
  return dNum > 0 ? 'Stokta Var' : 'Stokta Yok';
};

/* ✅ KURAL:
   Beklenen = (Compel VAR) OR (Depo > 0)
*/
const stokDur = (compelRaw, sesciRaw, dNum, ok) => {
  if (!ok) return '—';
  const a = inStock(compelRaw, { source: 'compel' });
  const b = inStock(sesciRaw, { source: 'products' });
  const exp = depotReady ? (a || (dNum > 0)) : a;
  return b === exp ? 'Doğru' : 'Hatalı';
};

const eanDur = (aRaw, bRaw2, ok) => {
  if (!ok) return '—';
  const a = new Set(eans(aRaw || '')), b = eans(bRaw2 || '');
  if (!a.size || !b.length) return 'Eşleşmedi';
  for (const x of b) if (a.has(x)) return 'Eşleşti';
  return 'Eşleşmedi';
};

function outRow(r1, r2, how) {
  const s1raw = T(r1[C1.stok] || ''), s2raw = r2 ? T(r2[C2.stok] || '') : '';
  const sup = r2 ? T(r2[C2.sup] || '') : '', bark = r2 ? T(r2[C2.barkod] || '') : '';
  const seoAbs = r2 ? safeUrl(normSeo(r2[C2.seo] || '')) : '', clink = safeUrl(r1[C1.link] || '');

  const d = r2 ? depotAgg(sup) : { num: 0, raw: '' };

  return {
    "Sıra No": T(r1[C1.siraNo] || ''), "Marka": T(r1[C1.marka] || ''),
    "Ürün Adı (Compel)": T(r1[C1.urunAdi] || ''), "Ürün Adı (Sescibaba)": r2 ? T(r2[C2.urunAdi] || '') : '',
    "Ürün Kodu (Compel)": T(r1[C1.urunKodu] || ''), "Ürün Kodu (Sescibaba)": sup,

    "Stok (Compel)": compelLbl(s1raw),
    "Stok (Sescibaba)": sesciLbl(s2raw, !!r2),
    "Stok (Depo)": r2 ? depoLbl(d.num) : (depotReady ? 'Stokta Yok' : '—'),
    "Stok Durumu": stokDur(s1raw, s2raw, d.num, !!r2),

    "EAN (Compel)": T(r1[C1.ean] || ''), "EAN (Sescibaba)": bark, "EAN Durumu": eanDur(r1[C1.ean] || '', bark, !!r2),

    _s1raw: s1raw, _s2raw: s2raw,
    _dnum: d.num, _draw: d.raw,

    _m: !!r2, _how: r2 ? how : '', _k: kNew(r1), _bn: B(r1[C1.marka] || ''), _seo: seoAbs, _clink: clink
  };
}

function runMatch() {
  R = []; U = [];
  for (const r1 of L1) {
    let r2 = byEan(r1), how = r2 ? 'EAN' : '';
    if (!r2) { r2 = byCompelCodeWs(r1); if (r2) how = 'KOD'; }
    if (!r2) { r2 = byMap(r1); if (r2) how = 'JSON'; }
    const row = outRow(r1, r2, how);
    R.push(row);
    if (!row._m) U.push(row);
  }
  render();
}

const cellName = (txt, href) => {
  const v = (txt ?? '').toString(), u = href || '';
  return u
    ? `<a class="nm" href="${esc(u)}" target="_blank" rel="noopener" title="${esc(v)}">${esc(v)}</a>`
    : `<span class="nm" title="${esc(v)}">${esc(v)}</span>`;
};

let _raf = 0, _bound = false;
const sched = () => { if (_raf) cancelAnimationFrame(_raf); _raf = requestAnimationFrame(adjustLayout); };
const firstEl = td => td?.querySelector('.cellTxt,.nm,input,button') || null;

function fitHeaderText(tableId) {
  const t = $(tableId); if (!t) return;
  const ths = t.querySelectorAll('thead th');
  for (const th of ths) {
    const sp = th.querySelector('.hTxt'); if (!sp) continue;
    sp.style.transform = 'scaleX(1)';
    const avail = Math.max(10, th.clientWidth - 2);
    const need = sp.scrollWidth || 0;
    const s = need > avail ? (avail / need) : 1;
    sp.style.transform = `scaleX(${s})`;
  }
}

function adjustLayout() {
  _raf = 0;
  fitHeaderText('t1'); fitHeaderText('t2');

  const t = $('t1'); if (!t) return;
  const rows = t.querySelectorAll('tbody tr'), G = 6;
  for (const tr of rows) {
    const nameTds = tr.querySelectorAll('td.nameCell'); if (!nameTds.length) continue;
    for (let i = nameTds.length - 1; i >= 0; i--) {
      const td = nameTds[i], nm = td.querySelector('.nm'); if (!nm) continue;
      const next = td.nextElementSibling;
      const tdR = td.getBoundingClientRect(), nmR = nm.getBoundingClientRect();
      let maxRight = tdR.right - G;
      if (next) {
        const el = firstEl(next);
        if (el) { const r = el.getBoundingClientRect(); maxRight = Math.min(tdR.right + next.getBoundingClientRect().width, r.left - G); }
        else maxRight = next.getBoundingClientRect().right - G;
      }
      nm.style.maxWidth = Math.max(40, maxRight - nmR.left) + 'px';
    }
  }
  if (!_bound) { _bound = true; addEventListener('resize', sched); }
}

function render() {
  const W1 = [4, 8, 14, 14, 7, 7, 6, 6, 6, 6, 8, 8, 6];

  const head = COLS.map(c => {
    const l = disp(c);
    return `<th title="${esc(l)}"><span class="hTxt">${fmtHdr(l)}</span></th>`;
  }).join('');

  const body = R.map(r => `<tr>${COLS.map((c, idx) => {
    const v = r[c] ?? '';
    if (c === "Ürün Adı (Compel)") return `<td class="left nameCell">${cellName(v, r._clink || '')}</td>`;
    if (c === "Ürün Adı (Sescibaba)") return `<td class="left nameCell">${cellName(v, r._seo || '')}</td>`;

    const seq = idx === 0, sd = c === "Stok Durumu", ed = c === "EAN Durumu";
    const ean = c === "EAN (Compel)" || c === "EAN (Sescibaba)";
    const cls = [seq ? 'seqCell' : '', sd || ed ? 'statusBold' : '', ean ? 'eanCell' : ''].filter(Boolean).join(' ');

    const title = (c === "Stok (Depo)" && depotReady)
      ? `${v} (Depo Toplam: ${r._draw ?? '0'})`
      : v;

    return `<td class="${cls}" title="${esc(title)}"><span class="cellTxt">${esc(v)}</span></td>`;
  }).join('')}</tr>`).join('');

  $('t1').innerHTML = colGrp(W1) + `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;

  const sec = $('unmatchedSection'), btn2 = $('dl2');
  if (!U.length) { sec.style.display = 'none'; if (btn2) btn2.style.display = 'none'; }
  else { sec.style.display = ''; if (btn2) btn2.style.display = ''; }

  if (U.length) {
    const W2 = [6, 10, 28, 12, 18, 10, 10, 6];
    $('t2').innerHTML = colGrp(W2) + `<thead><tr>
      <th><span class="hTxt">Sıra</span></th><th><span class="hTxt">Marka</span></th><th><span class="hTxt">Ürün Adı</span></th>
      <th><span class="hTxt">Ürün Kodu</span></th><th><span class="hTxt">EAN</span></th><th><span class="hTxt">Web Servis</span></th>
      <th><span class="hTxt">Tedarikçi</span></th><th></th>
    </tr></thead><tbody>` +
      U.map((r, i) => `<tr id="u_${i}">
        <td class="seqCell" title="${esc(r["Sıra No"])}"><span class="cellTxt">${esc(r["Sıra No"])}</span></td>
        <td title="${esc(r["Marka"])}"><span class="cellTxt">${esc(r["Marka"])}</span></td>
        <td class="left" title="${esc(r["Ürün Adı (Compel)"])}"><span class="cellTxt">${esc(r["Ürün Adı (Compel)"] || '')}</span></td>
        <td title="${esc(r["Ürün Kodu (Compel)"])}"><span class="cellTxt">${esc(r["Ürün Kodu (Compel)"])}</span></td>
        <td class="eanCell" title="${esc(r["EAN (Compel)"])}"><span class="cellTxt">${esc(r["EAN (Compel)"])}</span></td>
        <td><input type="text" list="wsCodes" data-i="${i}" data-f="ws" placeholder="ws"></td>
        <td><input type="text" list="supCodes" data-i="${i}" data-f="sup" placeholder="sup"></td>
        <td><button class="mx" data-i="${i}">Eşleştir</button></td>
      </tr>`).join('') + `</tbody>`;
    $('t2').querySelectorAll('.mx').forEach(b => b.onclick = () => manual(+b.dataset.i));
  }

  const matched = R.filter(x => x._m).length;
  setChip('sum', `Toplam ${R.length} • ✓${matched} • ✕${R.length - matched}`, 'muted');

  const dl1 = $('dl1');
  if (dl1) dl1.disabled = !R.length;

  if (btn2) btn2.disabled = !U.length;

  sched();
}

function manual(i) {
  const r = U[i]; if (!r) return;
  const tr = $('t2').querySelector('#u_' + i);
  const ws = tr.querySelector('input[data-f="ws"]').value.trim();
  const sup = tr.querySelector('input[data-f="sup"]').value.trim();
  const r2 = (ws && idxW.get(ws)) || (sup && idxS.get(sup)) || null;
  if (!r2) return alert('Ürün bulunamadı (marka filtresi sebebiyle de olabilir).');

  const b1 = r._bn, b2 = B(r2[C2.marka] || '');
  if (b1 && b2 && b1 !== b2 && !confirm(`Marka farklı:\n1) ${b1}\n2) ${b2}\nYine de eşleştirilsin mi?`)) return;

  map.mappings = map.mappings || {};
  map.mappings[r._k] = {
    webServisKodu: T(r2[C2.ws] || ''),
    tedarikciUrunKodu: T(r2[C2.sup] || ''),
    barkod: T(r2[C2.barkod] || ''),
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
    R[idx] = outRow(stub, r2, 'MANUAL');
    R[idx]._k = r._k; R[idx]._bn = b1;
  }
  U.splice(i, 1);
  render();
}

/* =========================
   ✅ Listele
   ========================= */
const goBtn = $('go');

const setScanState = (on) => {
  scanning = on;
  if (goBtn) goBtn.disabled = on;
  $('f2') && ($('f2').disabled = on);
  $('depoBtn') && ($('depoBtn').disabled = on);
};

/* =========================
   ✅ Compel'i worker'dan çek → L1 oluştur
   ========================= */
async function scanCompel(selectedBrands) {
  const chosen = selectedBrands.map(b => ({ id: b.id, slug: b.slug, name: b.name, count: b.count }));
  if (!chosen.length) throw new Error('Seçili marka yok.');

  // Tümü seçildiyse küçük uyarı
  if (chosen.length === BRANDS.length) {
    const ok = confirm('Tüm markaları taramak üzeresiniz. Emin misiniz?');
    if (!ok) throw new Error('İptal edildi.');
  }

  abortCtrl = new AbortController();
  setScanState(true);

  const rows = [];
  let seq = 0;

  try {
    const res = await fetch(`${API_BASE}/api/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brands: chosen }),
      signal: abortCtrl.signal
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`API /api/scan hata: ${res.status}\n${t}`);
    }

    const rd = res.body?.getReader?.();
    if (!rd) throw new Error('Stream yok (reader alınamadı).');

    const dec = new TextDecoder();
    let buf = '';
    let curBrand = '';
    let curPage = 0;
    let curPages = 0;

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

        if (m.type === 'brandStart' || m.type === 'page') {
          curBrand = m.brand || curBrand;
          curPage = m.page || curPage;
          curPages = m.pages || curPages;
          setStatus(`Taranıyor: ${curBrand} (${curPage}/${curPages})`, 'unk');
        } else if (m.type === 'product') {
          const p = m.data || {};
          seq++;

          rows.push({
            "Sıra No": String(seq),
            "Marka": String(p.brand || ''),
            "Ürün Adı": String(p.title || 'Ürün'),
            "Ürün Kodu": String(p.productCode || ''),
            "Stok": String(p.stock || ''),
            "EAN": String(p.ean || ''),
            "Link": String(p.url || '')
          });

          if (seq % 250 === 0) {
            setChip('l1Chip', `L1:${rows.length}`);
          }
        } else if (m.type === 'brandDone') {
          setStatus(`Marka bitti: ${m.brand} (${m.found ?? ''})`, 'unk');
        } else if (m.type === 'done') {
          // ignore
        } else if (m.type === 'error') {
          console.warn('scan error:', m.message);
        }
      }
    }

    return rows;
  } finally {
    abortCtrl = null;
    setScanState(false);
  }
}

/* =========================
   ✅ Ana generate: Sescibaba oku + Compel tara → eşleştir
   ========================= */
async function generate() {
  const b = $('f2')?.files?.[0];

  if (!SELECTED.size) return alert('En az 1 marka seç.');
  if (!b) return alert('Lütfen Sescibaba Stok CSV seç.');

  setStatus('Okunuyor…', 'unk');
  setChip('l1Chip', 'L1:—'); setChip('l2Chip', 'L2:—');

  try {
    // mapping dosyası UI kaldırıldı ama eşleştirme yine çalışsın diye temiz map ile başlıyoruz
    map = { meta: { version: 1, createdAt: nowISO(), updatedAt: nowISO() }, mappings: {} };

    // 1) Sescibaba CSV + Compel scan (paralel)
    const t2Promise = readFileText(b);

    const selectedBrands = BRANDS.filter(x => SELECTED.has(x.id));
    const scanPromise = scanCompel(selectedBrands);

    const [t2, scannedL1] = await Promise.all([t2Promise, scanPromise]);

    // L1: standart kolon seti
    L1 = scannedL1;
    C1 = {
      siraNo: "Sıra No",
      marka: "Marka",
      urunAdi: "Ürün Adı",
      urunKodu: "Ürün Kodu",
      stok: "Stok",
      ean: "EAN",
      link: "Link"
    };
    setChip('l1Chip', `L1:${L1.length}`);

    // L2 parse
    const p2 = parseDelimited(t2);
    if (!p2.rows.length) return alert('Sescibaba CSV boş görünüyor.');
    const s2 = p2.rows[0];

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
    const m2 = need(C2, ['ws', 'sup', 'barkod', 'stok', 'marka', 'urunAdi', 'seo']);
    if (m2.length) { setStatus('Sütun eksik', 'bad'); console.warn('L2 missing', m2); return; }

    L2all = p2.rows;

    // Robot 1 filtresi: L1 markalarına göre L2 daralt
    const brands = new Set(L1.map(r => B(r[C1.marka] || '')).filter(Boolean));
    L2 = L2all.filter(r => brands.has(B(r[C2.marka] || '')));

    buildIdx();
    buildDepotIdx();
    runMatch();

    setStatus('Hazır', 'ok');
    setChip('l2Chip', `L2:${L2.length}/${L2all.length}`);
  } catch (e) {
    console.error(e);
    if (String(e?.message || '').includes('İptal edildi')) {
      setStatus('İptal edildi', 'unk');
    } else if (abortCtrl?.signal?.aborted) {
      setStatus('Durduruldu', 'unk');
    } else {
      setStatus('Hata (konsol)', 'bad');
      alert(e?.message || String(e));
    }
  }
}

/* =========================
   ✅ Çıktılar
   ========================= */
$('dl1')?.addEventListener('click', () => {
  const clean = R.map(r => Object.fromEntries(COLS.map(c => [c, r[c]])));
  downloadBlob('sonuc-eslestirme.csv', new Blob([toCSV(clean, COLS)], { type: 'text/csv;charset=utf-8' }));
});

$('dl2')?.addEventListener('click', () => {
  const cols = ["Sıra No", "Marka", "Ürün Adı (Compel)", "Ürün Kodu (Compel)", "Stok (Compel)", "EAN (Compel)"];
  const clean = U.map(r => Object.fromEntries(cols.map(c => [c, r[c]])));
  downloadBlob('eslesmeyenler.csv', new Blob([toCSV(clean, cols)], { type: 'text/csv;charset=utf-8' }));
});

/* =========================
   ✅ Listele
   ========================= */
if (goBtn) {
  goBtn.onclick = async () => {
    await generate();
  };
}

/* =========================
   ✅ Depo Yapıştırma Modal (aynı)
   ========================= */
const depoBtn = $('depoBtn');
const depoModal = $('depoModal');
const depoPaste = $('depoPaste');
const depoLoad = $('depoLoad');
const depoClose = $('depoClose');
const depoClear = $('depoClear');

const setDepoUi = (loaded) => {
  const n4 = $('n4');
  if (n4) {
    n4.textContent = loaded ? 'Yüklendi' : 'Yükle';
    n4.title = loaded ? `Depo yüklü (${L4.length})` : 'Yükle';
  }
  setChip('l4Chip', loaded ? `L4:${L4.length}` : 'L4:-');
};

const showDepo = () => {
  if (!depoModal) return;
  depoModal.style.display = 'flex';
  depoModal.setAttribute('aria-hidden', 'false');
  setTimeout(() => depoPaste?.focus(), 0);
};
const hideDepo = () => {
  if (!depoModal) return;
  depoModal.style.display = 'none';
  depoModal.setAttribute('aria-hidden', 'true');
};

/* noisy paste parser */
function depotFromNoisyPaste(text) {
  const FirmaDefault = "Sescibaba";
  const N = s => !s || /^(Tümü|Sesçibaba Logo|Şirketler|Siparişler|Onay Bekleyen|Sipariş Listesi|İade Listesi|Sesçibaba Stokları|Stok Listesi|Ara|Previous|Next|E-Commerce Management.*|Showing\b.*|Marka\s+Model\s+Stok\s+Kodu.*|\d+)$/.test(s);

  const out = [];
  const lines = (text || '').split(/\r\n|\r|\n/);

  for (let l of lines) {
    l = (l || '').replace(/\u00A0/g, " ").trim();
    if (N(l)) continue;

    if (!l.includes("\t")) continue;

    const a = l.split("\t").map(x => x.trim()).filter(Boolean);
    if (a.length < 6) continue;

    let m = '', mo = '', k = '', ac = '', s = '', w = '', f = FirmaDefault;

    if (a.length === 6) {
      m = a[0]; mo = a[1]; k = a[2]; ac = a[3]; s = a[4]; w = a[5];
    } else {
      m = a[0];
      f = a.at(-1) || FirmaDefault;
      w = a.at(-2) || '';
      s = a.at(-3) || '';
      const mid = a.slice(1, -3);
      if (mid.length < 3) continue;
      mo = mid.slice(0, -2).join(" ");
      k = mid.at(-2) || '';
      ac = mid.at(-1) || '';
    }

    const stokStr = String(s ?? '').trim();
    if (!stokStr || !/^-?\d+(?:[.,]\d+)?$/.test(stokStr)) continue;

    out.push({
      "Marka": m,
      "Model": mo,
      "Stok Kodu": k,
      "Açıklama": ac,
      "Stok": stokStr,
      "Ambar": w,
      "Firma": f
    });
  }

  return out;
}

function loadDepotFromText(text) {
  const raw = (text ?? '').toString();
  if (!raw.trim()) return alert('Depo verisi boş.');

  let ok = false;
  try {
    const p = parseDelimited(raw);
    const rows = p?.rows || [];
    if (rows.length) {
      const sample = rows[0];
      const stokKodu = pickColumn(sample, ['Stok Kodu', 'StokKodu', 'STOK KODU', 'Stock Code']);
      const stok = pickColumn(sample, ['Stok', 'Miktar', 'Qty', 'Quantity']);
      if (stokKodu && stok) {
        L4 = rows;
        C4 = {
          stokKodu,
          stok,
          ambar: pickColumn(sample, ['Ambar', 'Depo', 'Warehouse']),
          firma: pickColumn(sample, ['Firma', 'Şirket', 'Company'])
        };
        ok = true;
      }
    }
  } catch {
    ok = false;
  }

  if (!ok) {
    const r2 = depotFromNoisyPaste(raw);
    if (!r2.length) return alert('Depo verisi çözümlenemedi. (Tablolu kopya bekleniyordu.)');
    L4 = r2;
    C4 = { stokKodu: 'Stok Kodu', stok: 'Stok', ambar: 'Ambar', firma: 'Firma' };
    ok = true;
  }

  depotReady = true;
  buildDepotIdx();
  setDepoUi(true);
  setStatus('Depo yüklendi', 'ok');

  if (L1.length && L2.length) runMatch();
}

if (depoBtn) depoBtn.onclick = showDepo;
if (depoClose) depoClose.onclick = hideDepo;
if (depoClear) depoClear.onclick = () => { if (depoPaste) depoPaste.value = ''; depoPaste?.focus(); };
if (depoLoad) depoLoad.onclick = () => { loadDepotFromText(depoPaste?.value || ''); hideDepo(); };

addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && depoModal?.style.display === 'flex') hideDepo();
});

// başlangıç UI
setDepoUi(false);

/* =========================
   ✅ Dosya kutusu (Sescibaba)
   ========================= */
const bind = (inId, outId, empty) => {
  const inp = $(inId), out = $(outId); if (!inp || !out) return;
  const upd = () => {
    const f = inp.files?.[0];
    if (!f) { out.textContent = empty; out.title = empty; }
    else { out.textContent = 'Seçildi'; out.title = f.name; }
  };
  inp.addEventListener('change', upd); upd();
};
bind('f2', 'n2', 'Yükle');

/* =========================
   ✅ ilk yük: markalar
   ========================= */
loadBrands();
