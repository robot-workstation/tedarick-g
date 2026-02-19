// js/render.js
import { esc } from './utils.js';
import { COLS } from './match.js';

const $ = id => document.getElementById(id);

const colGrp = w => `<colgroup>${w.map(x => `<col style="width:${x}%">`).join('')}</colgroup>`;
const disp = c => c === "Sıra No" ? "Sıra" : c;

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

export function createRenderer({ ui, onManual, onDataChange } = {}) {
  function render(R, U, depotReady) {
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

    const sec = $('unmatchedSection'), btn2 = $('dl2');
    if (!U?.length) { sec.style.display = 'none'; if (btn2) btn2.style.display = 'none'; }
    else { sec.style.display = ''; if (btn2) btn2.style.display = ''; }

    if (U?.length) {
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

      $('t2').querySelectorAll('.mx').forEach(b => b.onclick = () => {
        const i = +b.dataset.i;
        const tr = $('t2').querySelector('#u_' + i);
        const ws = tr.querySelector('input[data-f="ws"]').value.trim();
        const sup = tr.querySelector('input[data-f="sup"]').value.trim();
        const ok = onManual?.(i, ws, sup);
        if (ok) onDataChange?.();
      });
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
