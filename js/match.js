// js/match.js
import { TR, T, D, nowISO, inStock } from './utils.js';

const $ = id => document.getElementById(id);

/* =========================
   ✅ Eşleştirme Modülü
   ========================= */

export const COLS = [
  "Sıra No", "Marka",
  "Ürün Adı (Compel)", "Ürün Adı (T-Soft)",
  "Ürün Kodu (Compel)", "Ürün Kodu (T-Soft)",
  "Stok (Compel)", "Stok (Depo)", "Stok (T-Soft)", "Stok Durumu",
  "EAN (Compel)", "EAN (T-Soft)", "EAN Durumu"
];

/* =========================
   ✅ Marka normalize + alias
   ========================= */

const bRaw = (s) => {
  let x = (s ?? '').toString().replace(/\u00A0/g, ' ').trim();
  if (!x) return '';

  try { x = x.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch {}

  x = x.replace(/Ø/g, 'O').replace(/ø/g, 'o');
  x = x.toLocaleUpperCase(TR);

  x = x
    .replace(/\u0130/g, 'I') // İ
    .replace(/\u0131/g, 'I') // ı
    .replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/Ş/g, 'S')
    .replace(/Ö/g, 'O')
    .replace(/Ç/g, 'C');

  x = x.replace(/&/g, ' ');
  x = x.replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  return x;
};

const compact = (k) => (k ?? '').toString().replace(/\s+/g, '');

const ALIAS = new Map([
  // RØDE / RODE / RØDE X / RODE X => RODE (tek grup)
  ['RODE', 'RODE'],
  ['RODEX', 'RODE'],

  // Compel ↔ Aide kısa/uzun farkları
  ['DENON', 'DENON DJ'],
  ['DENONDJ', 'DENON DJ'],

  ['FENDER', 'FENDER STUDIO'],
  ['FENDERSTUDIO', 'FENDER STUDIO'],

  ['UNIVERSAL', 'UNIVERSAL AUDIO'],
  ['UNIVERSALAUDIO', 'UNIVERSAL AUDIO'],

  ['WARMAUDIO', 'WARM AUDIO'],
  ['WARMAUDIO', 'WARM AUDIO'],

  // Beyer/Beyerdynamic
  ['BEYER', 'BEYERDYNAMIC'],
  ['BEYERDYNAMIC', 'BEYERDYNAMIC'],

  // Allen & Heath normalize ile ALLEN HEATH olur
  ['ALLENHEATH', 'ALLEN HEATH'],

  // Marantz / Rupert Neve (gerekirse)
  ['MARANTZPROFESSIONAL', 'MARANTZ'],
  ['RUPERTNEVEDESIGNS', 'RUPERT NEVE'],
]);

const B = (s) => {
  const k = bRaw(s);
  if (!k) return '';
  const kc = compact(k);
  return ALIAS.get(kc) || k;
};

const Bx = (s) => bRaw(s);

export const normBrand = B;

/* =========================
   ✅ Aktif parser
   ========================= */
const parseAktif = (v) => {
  const s = (v ?? '').toString().trim().toLowerCase();
  if (!s) return null;
  if (s === 'true' || s === '1' || s === 'yes' || s === 'evet') return true;
  if (s === 'false' || s === '0' || s === 'no' || s === 'hayir' || s === 'hayır') return false;
  return null;
};

/* =========================
   URL / SEO / EAN helpers
   ========================= */

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

const eans = v => {
  v = (v ?? '').toString().trim();
  if (!v) return [];
  return v.split(/[^0-9]+/g).map(D).filter(x => x.length >= 8);
};

export function createMatcher({ getDepotAgg, isDepotReady } = {}) {
  // data
  let L1 = [], L2 = [], L2all = [];
  let C1 = {}, C2 = {};

  // mapping + indexes
  let map = { meta: { version: 1, createdAt: nowISO(), updatedAt: nowISO() }, mappings: {} };
  let idxB = new Map(), idxW = new Map(), idxS = new Map();

  // results
  let R = [], U = [];
  let UT = [];

  const key = (r, fn) => {
    const b = fn(r[C1.marka] || '');
    const code = T(r[C1.urunKodu] || '');
    const name = T(r[C1.urunAdi] || '');
    return b + '||' + (code || ('NAME:' + name));
  };
  const kNew = r => key(r, B);
  const kOld = r => key(r, Bx);

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

  const compelLbl = raw => {
    const s = (raw ?? '').toString().trim();
    if (!s) return '';
    return inStock(s, { source: 'compel' }) ? 'Stokta Var' : 'Stokta Yok';
  };
  const tsoftLbl = (raw, ok) => ok ? (inStock(raw, { source: 'products' }) ? 'Stokta Var' : 'Stokta Yok') : '';
  const depoLbl = (dNum) => {
    if (!isDepotReady?.()) return '—';
    return dNum > 0 ? 'Stokta Var' : 'Stokta Yok';
  };

  const stokDur = (compelRaw, tsoftRaw, dNum, ok) => {
    if (!ok) return '—';
    const a = inStock(compelRaw, { source: 'compel' });
    const b = inStock(tsoftRaw, { source: 'products' });
    const exp = isDepotReady?.() ? (a || (dNum > 0)) : a;
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

    const depAgg = getDepotAgg?.();
    const d = (r2 && depAgg) ? depAgg(sup) : { num: 0, raw: '' };

    return {
      "Sıra No": T(r1[C1.siraNo] || ''), "Marka": T(r1[C1.marka] || ''),
      "Ürün Adı (Compel)": T(r1[C1.urunAdi] || ''), "Ürün Adı (T-Soft)": r2 ? T(r2[C2.urunAdi] || '') : '',
      "Ürün Kodu (Compel)": T(r1[C1.urunKodu] || ''), "Ürün Kodu (T-Soft)": sup,

      "Stok (Compel)": compelLbl(s1raw),
      "Stok (Depo)": r2 ? depoLbl(d.num) : (isDepotReady?.() ? 'Stokta Yok' : '—'),
      "Stok (T-Soft)": tsoftLbl(s2raw, !!r2),
      "Stok Durumu": stokDur(s1raw, s2raw, d.num, !!r2),

      "EAN (Compel)": T(r1[C1.ean] || ''), "EAN (T-Soft)": bark, "EAN Durumu": eanDur(r1[C1.ean] || '', bark, !!r2),

      _s1raw: s1raw, _s2raw: s2raw,
      _dnum: d.num, _draw: d.raw,

      _m: !!r2, _how: r2 ? how : '', _k: kNew(r1), _bn: B(r1[C1.marka] || ''), _seo: seoAbs, _clink: clink
    };
  }

  function runMatch() {
    buildIdx();

    R = []; U = []; UT = [];

    const matchedTsoftKeys = new Set();

    const markMatchedTsoft = (r2) => {
      if (!r2) return;
      const brN = B(r2[C2.marka] || '');
      if (!brN) return;
      const ws = T(r2[C2.ws] || '');
      const sup = T(r2[C2.sup] || '');
      if (ws) matchedTsoftKeys.add(`${brN}||WS:${ws}`);
      if (sup) matchedTsoftKeys.add(`${brN}||SUP:${sup}`);
    };

    for (const r1 of L1) {
      let r2 = byEan(r1), how = r2 ? 'EAN' : '';
      if (!r2) { r2 = byCompelCodeWs(r1); if (r2) how = 'KOD'; }
      if (!r2) { r2 = byMap(r1); if (r2) how = 'JSON'; }

      if (r2 && (how === 'EAN' || how === 'KOD')) markMatchedTsoft(r2);

      const row = outRow(r1, r2, how);
      R.push(row);
      if (!row._m) U.push(row);
    }

    const seen = new Set();
    for (const r2 of L2) {
      const brN = B(r2[C2.marka] || '');
      if (!brN) continue;

      const nm = T(r2[C2.urunAdi] || '');
      if (!nm) continue;

      const ws = T(r2[C2.ws] || '');
      const sup = T(r2[C2.sup] || '');

      const wsHit = ws ? matchedTsoftKeys.has(`${brN}||WS:${ws}`) : false;
      const supHit = sup ? matchedTsoftKeys.has(`${brN}||SUP:${sup}`) : false;

      if (wsHit || supHit) continue;

      const key = (brN + '||' + (sup || '—') + '||' + nm).toLocaleLowerCase(TR).replace(/\s+/g, ' ').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const seoAbs = safeUrl(normSeo(r2[C2.seo] || ''));
      const brandDisp = T(r2[C2.marka] || '') || brN;

      const aktifVal = C2.aktif ? parseAktif(r2[C2.aktif]) : null;

      UT.push({
        _type: 'tsoft',
        _bn: brN,
        "Marka": brandDisp,
        "T-Soft Ürün Adı": nm,
        _seo: seoAbs,
        _sup: sup,
        _ws: ws,
        _aktif: aktifVal // ✅ yeni
      });
    }

    UT.sort((a, b) => {
      const ab = String(a["Marka"] || '').localeCompare(String(b["Marka"] || ''), 'tr', { sensitivity: 'base' });
      if (ab) return ab;
      return String(a["T-Soft Ürün Adı"] || '').localeCompare(String(b["T-Soft Ürün Adı"] || ''), 'tr', { sensitivity: 'base' });
    });

    return { R, U, UT };
  }

  function manualMatch(i, ws, sup) {
    const r = U[i];
    if (!r) return false;

    const r2 = (ws && idxW.get(ws)) || (sup && idxS.get(sup)) || null;
    if (!r2) { alert('Ürün bulunamadı (marka filtresi sebebiyle de olabilir).'); return false; }

    const b1 = r._bn;
    const b2 = B(r2[C2.marka] || '');
    if (b1 && b2 && b1 !== b2) {
      const ok = confirm(`Marka farklı:\n1) ${b1}\n2) ${b2}\nYine de eşleştirilsin mi?`);
      if (!ok) return false;
    }

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
    return true;
  }

  function resetAll() {
    L1 = []; L2 = []; L2all = [];
    C1 = {}; C2 = {};
    idxB = new Map(); idxW = new Map(); idxS = new Map();
    R = []; U = []; UT = [];
    map = { meta: { version: 1, createdAt: nowISO(), updatedAt: nowISO() }, mappings: {} };
  }

  function loadData({ l1, c1, l2, c2, l2All }) {
    L1 = l1 || [];
    L2 = l2 || [];
    L2all = l2All || [];
    C1 = c1 || {};
    C2 = c2 || {};
  }

  function getResults() { return { R, U, UT }; }
  function hasData() { return !!(L1?.length && L2?.length); }

  return {
    resetAll,
    loadData,
    runMatch,
    manualMatch,
    getResults,
    hasData
  };
}
