import { TR, T, D, nowISO, inStock } from './utils.js';
import { B, Bx, SEO } from './constants.js';

const safeUrl = u => { u = T(u); if (!u || /^\s*javascript:/i.test(u)) return ''; return u; };

const normSeo = raw => {
  let u = T(raw);
  if (!u || /^\s*javascript:/i.test(u)) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (/^www\./i.test(u)) return 'https://' + u;
  if (/^sescibaba\.com/i.test(u)) return 'https://' + u;
  return SEO + u.replace(/^\/+/, '');
};

const eans = v => {
  v = (v ?? '').toString().trim();
  if (!v) return [];
  return v.split(/[^0-9]+/g).map(D).filter(x => x.length >= 8);
};

/* ✅ NEW: baştaki 0(lar)ı düşür (en az 8 hane kalsın) */
const stripLead0 = (s) => {
  s = D(s || '');
  if (!s) return '';
  if (!/^0+/.test(s)) return '';
  const t = s.replace(/^0+/, '');
  return (t && t.length >= 8) ? t : '';
};

/* ✅ NEW: Compel EAN adaylarını üret:
   1) önce "0"suzlar
   2) sonra orijinaller
   (dupe temizlenir)
*/
const compelEanCandidates = (raw) => {
  const base = eans(raw);
  const out = [];
  const seen = new Set();

  // önce 0'suz
  for (const e of base) {
    const t = stripLead0(e);
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
  }
  // sonra normal
  for (const e of base) {
    if (e && !seen.has(e)) { seen.add(e); out.push(e); }
  }
  return out;
};

export function buildProductIndexes(L2, C2) {
  const idxB = new Map(), idxW = new Map(), idxS = new Map();

  for (const r of L2) {
    const bark = D(r[C2.barkod] || '');
    const ws = T(r[C2.ws] || '');
    const sup = T(r[C2.sup] || '');
    if (bark) { if (!idxB.has(bark)) idxB.set(bark, []); idxB.get(bark).push(r); }
    if (ws) idxW.set(ws, r);
    if (sup) idxS.set(sup, r);
  }
  return { idxB, idxW, idxS };
}

/* label’lar */
const compelLbl = raw => {
  const s = (raw ?? '').toString().trim();
  if (!s) return '';
  return inStock(s, { source: 'compel' }) ? 'Stokta Var' : 'Stokta Yok';
};
const sesciLbl = (raw, ok) => ok ? (inStock(raw, { source: 'products' }) ? 'Stokta Var' : 'Stokta Yok') : '';
const depoLbl = (ready, dNum) => ready ? (dNum > 0 ? 'Stokta Var' : 'Stokta Yok') : '—';

const stokDur = (compelRaw, sesciRaw, dNum, ok, depotReady) => {
  if (!ok) return '—';
  const a = inStock(compelRaw, { source: 'compel' });
  const b = inStock(sesciRaw, { source: 'products' });
  const exp = depotReady ? (a || (dNum > 0)) : a;
  return b === exp ? 'Doğru' : 'Hatalı';
};

/* ✅ IMPROVE: EAN durumu da baştaki 0 toleranslı */
const eanDur = (aRaw, bRaw, ok) => {
  if (!ok) return '—';

  const aList = eans(aRaw || '');
  const bList = eans(bRaw || '');

  if (!aList.length || !bList.length) return 'Eşleşmedi';

  const A = new Set();
  for (const e of aList) {
    A.add(e);
    const t = stripLead0(e);
    if (t) A.add(t);
  }

  for (const e of bList) {
    if (A.has(e)) return 'Eşleşti';
    const t = stripLead0(e);
    if (t && A.has(t)) return 'Eşleşti';
  }
  return 'Eşleşmedi';
};

function keyOf(r, C1, brandFn) {
  const b = brandFn(r[C1.marka] || '');
  const code = T(r[C1.urunKodu] || '');
  const name = T(r[C1.urunAdi] || '');
  return b + '||' + (code || ('NAME:' + name));
}

/* ✅ CHANGED: önce 0'suz EAN ile dene, olmazsa normal EAN */
function byEan(r1, C1, C2, idxB) {
  const br1 = B(r1[C1.marka] || '');

  for (const e of compelEanCandidates(r1[C1.ean] || '')) {
    const arr = idxB.get(e);
    if (arr?.length) return arr.find(r2 => B(r2[C2.marka] || '') === br1) || arr[0];
  }
  return null;
}

function byCompelCodeWs(r1, C1, C2, idxW) {
  const code = T(r1[C1.urunKodu] || ''); if (!code) return null;
  const r2 = idxW.get(code) || null; if (!r2) return null;
  const b1 = B(r1[C1.marka] || ''), b2 = B(r2[C2.marka] || '');
  if (b1 && b2 && b1 !== b2) return null;
  return r2;
}

function byMap(r1, C1, map, idxW, idxS) {
  const m = map.mappings || {};
  const kNew = keyOf(r1, C1, B);
  const kOld = keyOf(r1, C1, Bx);
  const ent = m[kNew] ?? m[kOld];
  if (!ent) return null;

  if (typeof ent === 'string') return idxW.get(ent) || idxS.get(ent) || null;
  const ws = T(ent.webServisKodu || ent.ws || ''), sup = T(ent.tedarikciUrunKodu || ent.supplier || '');
  return (ws && idxW.get(ws)) || (sup && idxS.get(sup)) || null;
}

export function outRow({ r1, r2, how, C1, C2, depot }) {
  const s1raw = T(r1[C1.stok] || '');
  const s2raw = r2 ? T(r2[C2.stok] || '') : '';

  const sup = r2 ? T(r2[C2.sup] || '') : '';
  const bark = r2 ? T(r2[C2.barkod] || '') : '';
  const seoAbs = r2 ? safeUrl(normSeo(r2[C2.seo] || '')) : '';
  const clink = safeUrl(r1[C1.link] || '');

  const d = r2 ? depot.agg(sup) : { num: 0, raw: '' };
  const depotReady = !!depot.state.ready;

  const row = {
    "Sıra No": T(r1[C1.siraNo] || ''), "Marka": T(r1[C1.marka] || ''),
    "Ürün Adı (Compel)": T(r1[C1.urunAdi] || ''), "Ürün Adı (Sescibaba)": r2 ? T(r2[C2.urunAdi] || '') : '',
    "Ürün Kodu (Compel)": T(r1[C1.urunKodu] || ''), "Ürün Kodu (Sescibaba)": sup,

    "Stok (Compel)": compelLbl(s1raw),
    "Stok (Sescibaba)": sesciLbl(s2raw, !!r2),
    "Stok (Depo)": r2 ? depoLbl(depotReady, d.num) : (depotReady ? 'Stokta Yok' : '—'),
    "Stok Durumu": stokDur(s1raw, s2raw, d.num, !!r2, depotReady),

    "EAN (Compel)": T(r1[C1.ean] || ''), "EAN (Sescibaba)": bark, "EAN Durumu": eanDur(r1[C1.ean] || '', bark, !!r2),

    _s1raw: s1raw, _s2raw: s2raw,
    _dnum: d.num, _draw: d.raw,
    _m: !!r2, _how: r2 ? how : '',
    _k: keyOf(r1, C1, B),
    _bn: B(r1[C1.marka] || ''),
    _seo: seoAbs, _clink: clink
  };

  return row;
}

export function runMatch({ L1, C1, C2, idxB, idxW, idxS, map, depot }) {
  const R = [], U = [];
  for (const r1 of L1) {
    let r2 = byEan(r1, C1, C2, idxB), how = r2 ? 'EAN' : '';
    if (!r2) { r2 = byCompelCodeWs(r1, C1, C2, idxW); if (r2) how = 'KOD'; }
    if (!r2) { r2 = byMap(r1, C1, map, idxW, idxS); if (r2) how = 'JSON'; }

    const row = outRow({ r1, r2, how, C1, C2, depot });
    R.push(row);
    if (!row._m) U.push(row);
  }
  return { R, U };
}

export function ensureMapShape(map) {
  let out = map;
  if (!out || typeof out !== 'object') out = {};
  if (out?.mappings) {
    out.meta = out.meta || { version: 1, createdAt: nowISO(), updatedAt: nowISO() };
    out.meta.updatedAt = nowISO();
    return out;
  }
  return { meta: { version: 1, createdAt: nowISO(), updatedAt: nowISO() }, mappings: (out || {}) };
}
