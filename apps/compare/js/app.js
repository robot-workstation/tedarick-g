
import {
  parseDelimited, pickColumn,
  downloadBlob, toCSV, readFileText,
  nowISO
} from './utils.js';

import { COLS, B } from './constants.js';
import { createDepot } from './depot.js';
import { buildProductIndexes, runMatch, outRow, ensureMapShape } from './matcher.js';
import * as ui from './ui.js';

const $ = id => document.getElementById(id);

let L1 = [], L2 = [], L2all = [];
let C1 = {}, C2 = {};
let map = { meta: { version: 1, createdAt: nowISO(), updatedAt: nowISO() }, mappings: {} };

let idxB = new Map(), idxW = new Map(), idxS = new Map();
let R = [], U = [];

const depot = createDepot();

/* ============ Depo modal UI ============ */
const depoModal = $('depoModal');
const depoPaste = $('depoPaste');

const showDepo = () => {
  depoModal.style.display = 'flex';
  depoModal.setAttribute('aria-hidden', 'false');
  setTimeout(() => depoPaste?.focus(), 0);
};
const hideDepo = () => {
  depoModal.style.display = 'none';
  depoModal.setAttribute('aria-hidden', 'true');
};

$('depoBtn').onclick = showDepo;
$('depoClose').onclick = hideDepo;
$('depoClear').onclick = () => { depoPaste.value = ''; depoPaste.focus(); };
$('depoLoad').onclick = () => {
  const res = depot.loadFromText(depoPaste.value || '');
  if (!res.ok) return alert(res.message);
  ui.setDepoUi(true, depot.state.L4.length);
  ui.setStatus('Depo yüklendi', 'ok');
  if (L1.length && L2.length) rerun();
  hideDepo();
};
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && depoModal?.style.display === 'flex') hideDepo();
});

/* ============ Listele/Temizle ============ */
ui.setGoMode('list');
$('go').onclick = async () => {
  if ($('go').dataset.mode === 'clear') return location.reload();
  await generate();
};

/* ============ File label bind ============ */
ui.bindFileLabel('f1', 'n1', 'Yükle');
ui.bindFileLabel('f2', 'n2', 'Yükle');
ui.bindFileLabel('f3', 'n3', 'Yükle');

ui.setDepoUi(false, 0);
ui.setStatus('Hazır', 'ok');

/* ============ Download ============ */
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

function rerun() {
  const out = runMatch({ L1, C1, C2, idxB, idxW, idxS, map, depot });
  R = out.R; U = out.U;
  ui.renderTables({ COLS, R, U, depotReady: depot.state.ready, onManual });
}

/* ============ Manual match ============ */
function onManual(i, ws, sup) {
  const r = U[i]; if (!r) return;
  const r2 = (ws && idxW.get(ws)) || (sup && idxS.get(sup)) || null;
  if (!r2) return alert('Ürün bulunamadı (marka filtresi sebebiyle de olabilir).');

  const b1 = r._bn, b2 = B(r2[C2.marka] || '');
  if (b1 && b2 && b1 !== b2 && !confirm(`Marka farklı:\n1) ${b1}\n2) ${b2}\nYine de eşleştirilsin mi?`)) return;

  map.mappings = map.mappings || {};
  map.mappings[r._k] = {
    webServisKodu: (r2[C2.ws] || '').toString().trim(),
    tedarikciUrunKodu: (r2[C2.sup] || '').toString().trim(),
    barkod: (r2[C2.barkod] || '').toString().trim(),
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

/* ============ Generate ============ */
async function generate() {
  const a = $('f1').files[0], b = $('f2').files[0], j = $('f3').files[0];
  if (!a || !b) return alert('Lütfen 1) ve 2) CSV dosyalarını seç.');

  ui.setStatus('Okunuyor…', 'unk');
  ui.setChip('l1Chip', 'L1:—');
  ui.setChip('l2Chip', 'L2:—');
  ui.chipVis('jsonChip', false);

  try {
    const [t1, t2, t3] = await Promise.all([
      readFileText(a),
      readFileText(b),
      j ? readFileText(j) : Promise.resolve(null)
    ]);

    // JSON map
    if (t3) {
      try {
        map = ensureMapShape(JSON.parse(t3));
      } catch {
        alert('JSON okunamadı, mapping kullanılmadan devam.');
        map = ensureMapShape({});
      }
    } else {
      map = ensureMapShape({});
    }

    const p1 = parseDelimited(t1), p2 = parseDelimited(t2);
    if (!p1.rows.length || !p2.rows.length) return alert('CSV boş görünüyor.');

    const s1 = p1.rows[0], s2 = p2.rows[0];

    C1 = {
      siraNo: pickColumn(s1, ['Sıra No', 'Sira No', 'SIRA NO']),
      marka: pickColumn(s1, ['Marka']),
      urunAdi: pickColumn(s1, ['Ürün Adı', 'Urun Adi', 'Ürün Adi']),
      urunKodu: pickColumn(s1, ['Ürün Kodu', 'Urun Kodu']),
      stok: pickColumn(s1, ['Stok']),
      ean: pickColumn(s1, ['EAN', 'Ean']),
      link: pickColumn(s1, ['Link', 'LINK', 'Ürün Linki', 'Urun Linki'])
    };
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
    const m1 = need(C1, ['siraNo', 'marka', 'urunAdi', 'urunKodu', 'stok', 'ean', 'link']);
    const m2 = need(C2, ['ws', 'sup', 'barkod', 'stok', 'marka', 'urunAdi', 'seo']);
    if (m1.length || m2.length) { ui.setStatus('Sütun eksik', 'bad'); console.warn('L1', m1, 'L2', m2); return; }

    L1 = p1.rows;
    L2all = p2.rows;

    const brands = new Set(L1.map(r => B(r[C1.marka] || '')).filter(Boolean));
    L2 = L2all.filter(r => brands.has(B(r[C2.marka] || '')));

    ({ idxB, idxW, idxS } = buildProductIndexes(L2, C2));
    ui.populateDatalists(L2, C2);

    rerun();

    ui.setStatus('Hazır', 'ok');
    ui.setChip('l1Chip', `L1:${L1.length}`);
    ui.setChip('l2Chip', `L2:${L2.length}/${L2all.length}`);

    const n = Object.keys(map.mappings || {}).length;
    ui.setChip('jsonChip', `JSON:${n}`, 'muted');
    ui.chipVis('jsonChip', true);

    ui.setGoMode('clear');
  } catch (e) {
    console.error(e);
    ui.setStatus('Hata (konsol)', 'bad');
  }
}
