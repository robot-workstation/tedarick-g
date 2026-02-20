// js/render.js
import { esc, stockToNumber } from './utils.js';
import { COLS } from './match.js';

const $ = id => document.getElementById(id);
const colGrp = w => `<colgroup>${w.map(x => `<col style="width:${x}%">`).join('')}</colgroup>`;

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

let _cssAdded = false;
function ensureCss() {
  if (_cssAdded) return;
  _cssAdded = true;

  const st = document.createElement('style');
  st.textContent = `
@keyframes namePulse {
  0%   { text-shadow: 0 0 0 rgba(134,239,172,0); }
  55%  { text-shadow: 0 0 14px rgba(134,239,172,.75); }
  100% { text-shadow: 0 0 0 rgba(134,239,172,0); }
}
.namePulse { animation: namePulse 1000ms ease-in-out infinite; will-change: text-shadow; }

.tagFlex{ display:flex; gap:10px; align-items:center; justify-content:space-between; }
.tagLeft{ min-width:0; flex:1 1 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tagRight{ flex:0 0 auto; text-align:right; white-space:nowrap; opacity:.92; font-weight:1100; }
.tagLeft .nm, .tagLeft .cellTxt{ display:inline-block; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

.sepL{
  border-left:1px solid rgba(147,197,253,.55) !important;
  box-shadow: inset 1px 0 0 rgba(0,0,0,.35);
}

#listTitle, #unmatchedTitle{
  font-weight: 1300 !important;
  font-size: 20px !important;
  letter-spacing: .02em;
}

/* ✅ header scale için daha sağlam */
#t1 thead th .hTxt, #t2 thead th .hTxt{
  display:inline-block;
  transform-origin:left center;
}

/* ✅ sadece iki kolon başlığı: ince + sıkı */
th.hdrThin{
  font-weight: 700 !important;
}
th.hdrTight .hTxt{
  letter-spacing: -0.02em;
  font-size: 12px;
}

/* sticky header */
#t1 thead th, #t2 thead th{
  position: sticky !important;
  top: var(--theadTop, 0px) !important;
  z-index: 120 !important;
  background: #0b0d12 !important;
  box-shadow: 0 1px 0 rgba(31,36,48,.9);
}
`;
  document.head.appendChild(st);
}
ensureCss();

const cellName = (txt, href, pulse = false) => {
  const v = (txt ?? '').toString();
  const u = href || '';
  const cls = `nm${pulse ? ' namePulse' : ''}`;
  return u
    ? `<a class="${cls}" href="${esc(u)}" target="_blank" rel="noopener" title="${esc(v)}">${esc(v)}</a>`
    : `<span class="${cls}" title="${esc(v)}">${esc(v)}</span>`;
};

let _raf = 0, _bound = false;
const sched = () => { if (_raf) cancelAnimationFrame(_raf); _raf = requestAnimationFrame(adjustLayout); };
const firstEl = td => td?.querySelector('.cellTxt,.nm,input,button,select,div') || null;

function enforcePageSticky() {
  const wraps = document.querySelectorAll('.tableWrap');
  for (const w of wraps) {
    w.style.overflow = 'visible';
    w.style.overflowX = 'visible';
    w.style.overflowY = 'visible';
  }
  document.documentElement.style.setProperty('--theadTop', '0px');
}

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

  enforcePageSticky();
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
          if (el) {
            const r = el.getBoundingClientRect();
            maxRight = Math.min(tdR.right + next.getBoundingClientRect().width, r.left - G);
          } else {
            maxRight = next.getBoundingClientRect().right - G;
          }
        }
        nm.style.maxWidth = Math.max(40, maxRight - nmR.left) + 'px';
      }
    }
  };

  applyNameFit('t1');
  applyNameFit('t2');

  if (!_bound) { _bound = true; addEventListener('resize', sched); }
}

const fmtNum = (n) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return '0';
  if (Math.round(x) === x) return String(x);
  return String(x);
};

export function createRenderer({ ui } = {}) {
  function render(R, Ux, depotReady) {
    /* =========================
       t1 (Ana liste)
       ========================= */

    // t1 seperatör noktaları (mevcut)
    const T1_SEP_LEFT = new Set(["Stok (Compel)", "EAN (Compel)"]);

    // ✅ bu iki kolon başlığına özel class
    const IS_TIGHT_HDR = (c) => (c === "Ürün Kodu (Compel)" || c === "Ürün Kodu (T-Soft)");

    const W1 = [4, 8, 14, 14, 7, 7, 6, 6, 6, 6, 8, 8, 6];

    const head = COLS.map(c => {
      const l = disp(c);
      const cls = [
        T1_SEP_LEFT.has(c) ? 'sepL' : '',
        IS_TIGHT_HDR(c) ? 'hdrThin hdrTight' : ''
      ].filter(Boolean).join(' ');
      return `<th class="${cls}" title="${esc(l)}"><span class="hTxt">${fmtHdr(l)}</span></th>`;
    }).join('');

    const body = (R || []).map(r => `<tr>${COLS.map((c, idx) => {
      const v = r[c] ?? '';

      if (c === "Ürün Adı (Compel)") return `<td class="left nameCell">${cellName(v, r._clink || '')}</td>`;
      if (c === "Ürün Adı (T-Soft)") return `<td class="left nameCell">${cellName(v, r._seo || '')}</td>`;

      const seq = idx === 0, sd = c === "Stok Durumu", ed = c === "EAN Durumu";
      const ean = c === "EAN (Compel)" || c === "EAN (T-Soft)";

      const isBad = (sd && String(v || '') === 'Hatalı') || (ed && String(v || '') === 'Eşleşmedi');
      const cls = [
        T1_SEP_LEFT.has(c) ? 'sepL' : '',
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
       t2 (Eşleşmeyenler)
       ========================= */
    const sec = $('unmatchedSection');
    const ut = $('unmatchedTitle');
    if (ut) ut.textContent = 'Compel, T-Soft ve Aide Eşleşmeyen Ürünler Listesi';

    const U = Array.isArray(Ux) ? Ux : [];

    if (!U.length) {
      if (sec) sec.style.display = 'none';
    } else {
      if (sec) sec.style.display = '';
      const UCOLS = ["Sıra", "Marka", "Compel Ürün Adı", "T-Soft Ürün Adı", "Aide Ürün Adı"];
      const W2 = [6, 12, 26, 28, 28];

      const head2 = UCOLS.map(c => {
        const sep = (c === "T-Soft Ürün Adı" || c === "Aide Ürün Adı") ? ' sepL' : '';
        return `<th class="${sep.trim()}" title="${esc(c)}"><span class="hTxt">${fmtHdr(c)}</span></th>`;
      }).join('');

      const body2 = U.map((r, i) => {
        const seq = r["Sıra"] ?? String(i + 1);
        const brand = r["Marka"] ?? '';

        const cNm = r["Compel Ürün Adı"] ?? '';
        const cLn = r._clink || '';
        const cPulse = !!r._pulseC;

        const tNm = r["T-Soft Ürün Adı"] ?? '';
        const tLn = r._seo || '';

        const dNm = r["Aide Ürün Adı"] ?? r["Depo Ürün Adı"] ?? '';
        const dPulse = !!r._pulseD;

        const cRaw = r._cstokraw ?? '';
        const cNum = stockToNumber(cRaw, { source: 'compel' });
        const cTag = cNm ? (cNum <= 0 ? '(Stok Yok)' : `(Stok: ${fmtNum(cNum)})`) : '';

        const tAct = r._taktif;
        const tStock = Number(r._tstok ?? 0);
        const tTag = tNm
          ? (tAct === true ? `(Aktif: ${fmtNum(tStock)} Stok)` : (tAct === false ? '(Pasif)' : ''))
          : '';

        const dNum = Number(r._dstok ?? 0);
        const dTag = dNm ? (dNum <= 0 ? '(Stok Yok)' : `(Stok: ${fmtNum(dNum)})`) : '';

        const compelCell = cNm
          ? `<div class="tagFlex">
               <span class="tagLeft">${cellName(cNm, cLn, cPulse)}</span>
               <span class="tagRight">${esc(cTag)}</span>
             </div>`
          : `<span class="cellTxt">—</span>`;

        const tsoftCell = tNm
          ? `<div class="tagFlex">
               <span class="tagLeft">${cellName(tNm, tLn, false)}</span>
               <span class="tagRight">${esc(tTag)}</span>
             </div>`
          : `<span class="cellTxt">—</span>`;

        const aideCell = dNm
          ? `<div class="tagFlex" title="${esc(dNm)}">
               <span class="cellTxt tagLeft${dPulse ? ' namePulse' : ''}">${esc(dNm)}</span>
               <span class="tagRight">${esc(dTag)}</span>
             </div>`
          : `<span class="cellTxt">—</span>`;

        return `<tr id="u_${i}">
          <td class="seqCell" title="${esc(seq)}"><span class="cellTxt">${esc(seq)}</span></td>
          <td title="${esc(brand)}"><span class="cellTxt">${esc(brand)}</span></td>
          <td class="left nameCell">${compelCell}</td>
          <td class="left nameCell sepL">${tsoftCell}</td>
          <td class="left sepL">${aideCell}</td>
        </tr>`;
      }).join('');

      $('t2').innerHTML = colGrp(W2) + `<thead><tr>${head2}</tr></thead><tbody>${body2}</tbody>`;
    }

    const matched = (R || []).filter(x => x._m).length;
    ui?.setChip?.('sum', `✓${matched} • ✕${(R || []).length - matched}`, 'muted');

    const dl1 = $('dl1');
    if (dl1) dl1.disabled = !(R || []).length;

    enforcePageSticky();
    sched();
  }

  return { render };
}
