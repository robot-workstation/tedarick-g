// js/match.js
import { TR, esc, T, D, nowISO, inStock } from './utils.js';

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

const ALIAS = new Map([
  ['ALLEN & HEATH', 'ALLEN HEATH'],
  ['MARANTZ PROFESSIONAL', 'MARANTZ'],
  ['RUPERT NEVE DESIGNS', 'RUPERT NEVE'],
  ['RØDE', 'RODE'],
  ['RØDE X', 'RODE']
]);

const bRaw = s => (s ?? '').toString().trim().toLocaleUpperCase(TR).replace(/\s+/g, ' ');
const B = s => ALIAS.get(bRaw(s)) || bRaw(s);
const Bx = s => bRaw(s);

export const normBrand = B;

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

/* =========================
   ✅ Unmatched için T-Soft öneri (isim benzerliği)
   ========================= */
const RX_TXT = /[^0-9a-zA-ZğüşiİöçĞÜŞÖÇ]+/g;
const normTxt = s => T(s).toLocaleLowerCase(TR).replace(RX_TXT, ' ').replace(/\s+/g, ' ').trim();
const toks = s => normTxt(s).split(' ').filter(x => x && x.length >= 2);

const diceScore = (a, b) => {
  if (!a?.length || !b?.length) return 0;
  const A = new Set(a);
  let inter = 0;
  for (const t of b) if (A.has(t)) inter++;
  return (2 * inter) / (a.length + b.length);
};

export function createMatcher({ getDepotAgg, isDepotReady } = {}) {
  // data
  let L1 = [], L2 = [], L2all = [];
  let C1 = {}, C2 = {};

  // mapping + indexes
  let map = { meta: { version: 1, createdAt: nowISO(), updatedAt: nowISO() }, mappings: {} };
  let idxB = new Map(), idxW = new Map(), idxS = new Map();

  // ✅ name index (brand -> candidates)
  let idxN = new Map();
  let idxNAll = [];

  // results
  let R = [], U = [];

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
    idxN = new Map(); idxNAll = [];

    for (const r of L2) {
      const bark = D(r[C2.barkod] || ''), ws = T(r[C2.ws] || ''), sup = T(r[C2.sup] || '');
      if (bark) { if (!idxB.has(bark)) idxB.set(bark, []); idxB.get(bark).push(r); }
      if (ws) idxW.set(ws, r);
      if (sup) idxS.set(sup, r);

      // ✅ name candidates
      const br = B(r[C2.marka] || '');
      const nm = T(r[C2.urunAdi] || '');
      if (br && nm) {
        const ent = {
          name: nm,
          sup,
          ws,
          stok: T(r[C2.stok] || ''),
          _txt: normTxt(nm),
          _tok: toks(nm)
        };
        if (!idxN.has(br)) idxN.set(br, []);
        idxN.get(br).push(ent);
        idxNAll.push(ent);
      }
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

  function suggestTsoftByName(r1, limit = 5) {
    const br1 = B(r1[C1.marka] || '');
    const qName = T(r1[C1.urunAdi] || '');
    if (!br1 || !qName) return [];

    const list = idxN.get(br1) || [];
    if (!list.length) return [];

    const qTxt = normTxt(qName);
    const qTok = toks(qName);

    const scored = [];
    for (const c of list) {
      if (!c?.name) continue;

      let s = diceScore(qTok, c._tok);
      if (qTxt && c._txt) {
        if (c._txt.includes(qTxt) && qTxt.length >= 6) s += 0.18;
        else if (qTxt.includes(c._txt) && c._txt.length >= 6) s += 0.10;
      }

      if (s <= 0) continue;

      const stokVar = inStock(c.stok, { source: 'products' });
      scored.push({
        name: c.name,
        sup: c.sup || '',
        ws: c.ws || '',
        stok: c.stok || '',
        stokVar,
        score: s,
        label: `${stokVar ? 'Var' : 'Yok'} • ${c.name}`
      });
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit);

    // çok zayıfsa hiç önerme
    if (top.length && top[0].score < 0.12) return top.slice(0, 2);
    return top;
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

  // ✅ Beklenen = (Compel VAR) OR (Depo > 0)
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

    // ✅ unmatched ise (r2 yoksa) önerileri hazırla
    const sug = !r2 ? suggestTsoftByName(r1, 5) : [];

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

      _m: !!r2, _how: r2 ? how : '', _k: kNew(r1), _bn: B(r1[C1.marka] || ''), _seo: seoAbs, _clink: clink,

      // ✅ renderer bunu kullanacak
      _sug: sug
    };
  }

  function runMatch() {
    buildIdx();

    R = []; U = [];
    for (const r1 of L1) {
      let r2 = byEan(r1), how = r2 ? 'EAN' : '';
      if (!r2) { r2 = byCompelCodeWs(r1); if (r2) how = 'KOD'; }
      if (!r2) { r2 = byMap(r1); if (r2) how = 'JSON'; }

      const row = outRow(r1, r2, how);
      R.push(row);
      if (!row._m) U.push(row);
    }

    return { R, U };
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
    idxN = new Map(); idxNAll = [];
    R = []; U = [];
    map = { meta: { version: 1, createdAt: nowISO(), updatedAt: nowISO() }, mappings: {} };
  }

  function loadData({ l1, c1, l2, c2, l2All }) {
    L1 = l1 || [];
    L2 = l2 || [];
    L2all = l2All || [];
    C1 = c1 || {};
    C2 = c2 || {};
  }

  function getResults() { return { R, U }; }
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
