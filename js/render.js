// js/render.js
import { esc } from './utils.js';
import { COLS } from './match.js';

const $ = id => document.getElementById(id);

const colGrp = w => `<colgroup>${w.map(x => `<col style="width:${x}%">`).join('')}</colgroup>`;

// ✅ 1. tablo başlık metinleri (görünen label’lar)
const HDR1 = {
  "Sıra No": "Sıra",
  "Marka": "Marka",
  "Ürün Adı (Compel)": "Compel Ürün Adı",
  "Ürün Adı (T-Soft)": "Tsoft Ürün Adı",
  "Ürün Kodu (Compel)": "Compel Ürün Kodu",
  "Ürün Kodu (T-Soft)": "T-Soft Ürün Kodu",
  "Stok (Compel)": "Compel",
  "Stok (Depo)": "Depo",
  "Stok (T-Soft)": "T-Soft",
  "Stok Durumu": "Stok Durumu",
  "EAN (Compel)": "Compel EAN",
  "EAN (T-Soft)": "T-Soft EAN",
  "EAN Durumu": "EAN Durumu"
};

const disp = c => HDR1[c] || c;

const fmtHdr = s => {
  s = (s ?? '').toString();
  const m = s.match(/^(.*?)(\s*\([^)]*\))\s*$/);
  if (!m) return esc(s);
  return `<span class="hMain">${esc(m[1].trimEnd())}</span> <span class="hParen">${esc(m[2].trim())}</span>`;
};

const cellName = (txt, href) => {
  const v = (txt ?? '').toString();
  const u = href || '';
  return u
    ? `<a class="nm" href="${esc(u)}" target="_blank" rel="noopener" title="${esc(v)}">${esc(v)}</a>`
    : `<span class="nm" title="${esc(v)}">${esc(v)}</span>`;
};

let _raf = 0, _bound = false;
const sched = () => { if (_raf) cancelAnimationFrame(_raf); _raf = requestAnimationFrame(adjustLayout); };
const firstEl = td => td?.querySelector('.cellTxt,.nm,input,button,select') || null;

const ensureDLWrap = () => {
  let d = document.getElementById('nameListsWrap');
  if (d) return d;
  d = document.createElement('div');
  d.id = 'nameListsWrap';
  d.style.display = 'none';
  document.body.appendChild(d);
  return d;
};

const hid = (s) => {
  s = (s ?? '').toString();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

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

  const applyNameFit = (tableId) => {
    const t = $(tableId); if (!t) return;
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
  };

  applyNameFit('t1');
  applyNameFit('t2');

  if (!_bound) { _bound = true; addEventListener('resize', sched); }
}

export function createRenderer({ ui, getDepotNamesForBrand } = {}) {
  function render(R, U, depotReady) {
    /* =========================
       ✅ 1. Liste (t1)
       ========================= */
    const W1 = [4, 8, 14, 14, 7, 7, 6, 6, 6, 6, 8, 8, 6];

    const head = COLS.map(c => {
      const l = disp(c);
      return `<th title="${esc(l)}"><span class="hTxt">${fmtHdr(l)}</span></th>`;
    }).join('');

    const body = (R || []).map(r => `<tr>${COLS.map((c, idx) => {
      const v = r[c] ?? '';
      if (c === "Ürün Adı (Compel)") return `<td class="left nameCell">${cellName(v, r._clink || '')}</td>`;
      if (c === "Ürün Adı (T-Soft)") return `<td class="left nameCell">${cellName(v, r._seo || '')}</td>`;

      const seq = idx === 0, sd = c === "Stok Durumu", ed = c === "EAN Durumu";
      const ean = c === "EAN (Compel)" || c === "EAN (T-Soft)";

      const isBad = (sd && String(v || '') === 'Hatalı') || (ed && String(v || '') === 'Eşleşmedi');
      const cls = [
        seq ? 'seqCell' : '',
        sd || ed ? 'statusBold' : '',
        ean ? 'eanCell' : '',
        isBad ? 'flagBad' : ''
      ].filter(Boolean).join(' ');

      const title = (c === "Stok (Depo)" && depotReady)
        ? `${v} (Depo Toplam: ${r._draw ?? '0'})`
        : v;

      return `<td class="${cls}" title="${esc(title)}"><span class="cellTxt">${esc(v)}</span></td>`;
    }).join('')}</tr>`).join('');

    $('t1').innerHTML = colGrp(W1) + `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;

    /* =========================
       ✅ 2. Liste (t2 - Eşleşmeyenler)
       ========================= */
    const sec = $('unmatchedSection'), btn2 = $('dl2');

    // ✅ başlık metni
    const ut = $('unmatchedTitle');
    if (ut) ut.textContent = 'Compel, T-Soft ve Aide Eşleşmeyen Ürünler Listesi';

    if (!U?.length) { sec.style.display = 'none'; if (btn2) btn2.style.display = 'none'; }
    else { sec.style.display = ''; if (btn2) btn2.style.display = ''; }

    if (U?.length) {
      const UCOLS = [
        "Sıra",
        "Marka",
        "Compel Ürün Adı",
        "T-Soft Ürün Adı",
        "Depo Ürün Adı"
      ];

      const W2 = [6, 12, 30, 26, 26];

      const head2 = UCOLS.map(c =>
        `<th title="${esc(c)}"><span class="hTxt">${fmtHdr(c)}</span></th>`
      ).join('');

      // ✅ datalist’ler: marka bazında (T-Soft unmatched + Depo isimleri)
      const dlWrap = ensureDLWrap();
      const bnToTsoftDl = new Map();
      const bnToDepoDl = new Map();

      for (const r of U) {
        const bn = r?._bn || '';
        if (!bn) continue;
        if (!bnToTsoftDl.has(bn)) bnToTsoftDl.set(bn, `tsoft_${hid(bn)}`);
        if (!bnToDepoDl.has(bn)) bnToDepoDl.set(bn, `depo_${hid(bn)}`);
      }

      const MAX = 5000;

      dlWrap.innerHTML =
        [...bnToTsoftDl.entries()].map(([bn, id]) => {
          const arr = Array.isArray(U.find(x => x?._bn === bn)?._tsoftUn) ? (U.find(x => x?._bn === bn)._tsoftUn) : [];
          const slice = arr.length > MAX ? arr.slice(0, MAX) : arr;
          return `<datalist id="${esc(id)}">` +
            slice.map(x => `<option value="${esc(x?.name || '')}"></option>`).join('') +
            `</datalist>`;
        }).join('') +
        [...bnToDepoDl.entries()].map(([bn, id]) => {
          const arr2 = (typeof getDepotNamesForBrand === 'function') ? (getDepotNamesForBrand(bn) || []) : [];
          const slice2 = arr2.length > MAX ? arr2.slice(0, MAX) : arr2;
          return `<datalist id="${esc(id)}">` +
            slice2.map(nm => `<option value="${esc(nm || '')}"></option>`).join('') +
            `</datalist>`;
        }).join('');

      const body2 = U.map((r, i) => {
        const bn = r._bn || '';
        const tsoftDl = bnToTsoftDl.get(bn) || '';
        const depoDl = bnToDepoDl.get(bn) || '';

        const tCnt = Array.isArray(r._tsoftUn) ? r._tsoftUn.length : 0;
        const dCnt = (typeof getDepotNamesForBrand === 'function') ? ((getDepotNamesForBrand(bn) || []).length) : 0;

        return `<tr id="u_${i}">
          <td class="seqCell" title="${esc(r["Sıra No"])}"><span class="cellTxt">${esc(r["Sıra No"] || '')}</span></td>
          <td title="${esc(r["Marka"])}"><span class="cellTxt">${esc(r["Marka"] || '')}</span></td>

          <td class="left nameCell">${cellName(r["Ürün Adı (Compel)"] || '', r._clink || '')}</td>

          <td class="left" title="T-Soft (products.csv) içinde Compel ile eşleşmeyen ürün adları">
            <input
              type="text"
              ${tsoftDl ? `list="${esc(tsoftDl)}"` : ''}
              placeholder="T-Soft ürün adı…"
              style="width:100%;box-sizing:border-box"
            >
            <div style="opacity:.75;font-weight:900;font-size:12px;margin-top:6px">Liste: ${esc(String(tCnt))}</div>
          </td>

          <td class="left" title="Aide (Depo) ürün adları">
            <input
              type="text"
              ${depoDl ? `list="${esc(depoDl)}"` : ''}
              placeholder="Depo ürün adı…"
              style="width:100%;box-sizing:border-box"
            >
            <div style="opacity:.75;font-weight:900;font-size:12px;margin-top:6px">Liste: ${esc(String(dCnt))}</div>
          </td>
        </tr>`;
      }).join('');

      $('t2').innerHTML = colGrp(W2) + `<thead><tr>${head2}</tr></thead><tbody>${body2}</tbody>`;
    }

    const matched = (R || []).filter(x => x._m).length;
    ui?.setChip?.('sum', `✓${matched} • ✕${(R || []).length - matched}`, 'muted');

    const dl1 = $('dl1');
    if (dl1) dl1.disabled = !(R || []).length;

    if (btn2) btn2.disabled = !(U || []).length;

    sched();
  }

  return { render };
}
