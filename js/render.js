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

  // ✅ artık hem t1 hem t2 aynı şekilde “nameCell” fit alır
  applyNameFit('t1');
  applyNameFit('t2');

  if (!_bound) { _bound = true; addEventListener('resize', sched); }
}

const sugBtn = (s, i) => {
  const sup = (s?.sup ?? '').toString();
  const label = (s?.label ?? s?.name ?? '').toString();
  const title = (s?.name ?? '').toString();
  if (!sup || !label) return '';
  // ✅ küçük "chip gibi" buton (inline style ile)
  return `<button type="button"
    class="sug"
    data-i="${i}"
    data-sup="${esc(sup)}"
    title="${esc(title)}"
    style="height:24px;padding:0 8px;font-size:12px;border-radius:999px;font-weight:900;display:inline-flex;align-items:center;gap:6px;margin:2px 6px 0 0;"
  >${esc(label)}</button>`;
};

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

    /* =========================
       ✅ Eşleşmeyen Ürünler Listesi (t2)
       - Görünüm: t1 ile aynı tarz (header + nameCell + eanCell + seqCell)
       - Sütunlar:
         Sıra | Marka | Ürün Adı (Compel) | Ürün Kodu (Compel) | EAN (Compel) | Stok T-Soft | (Eşleştir)
       - Web Servis kaldırıldı
       - Stok T-Soft hücresinde öneriler (products.csv içinden, seçili marka/markalarda)
       ========================= */
    if (U?.length) {
      const UCOLS = [
        "Sıra",
        "Marka",
        "Ürün Adı (Compel)",
        "Ürün Kodu (Compel)",
        "EAN (Compel)",
        "Stok T-Soft",
        ""
      ];

      const W2 = [6, 12, 34, 16, 14, 12, 6];

      const head2 = UCOLS.map(c => {
        if (!c) return `<th></th>`;
        return `<th title="${esc(c)}"><span class="hTxt">${fmtHdr(c)}</span></th>`;
      }).join('');

      const body2 = U.map((r, i) => {
        const sugs = Array.isArray(r._sug) ? r._sug : [];
        const sugHtml = sugs.length
          ? `<div style="display:flex;flex-wrap:wrap;align-items:center;margin-top:6px">${sugs.slice(0, 5).map(s => sugBtn(s, i)).join('')}</div>`
          : `<div style="opacity:.75;font-weight:900;margin-top:6px">Öneri yok</div>`;

        return `<tr id="u_${i}">
          <td class="seqCell" title="${esc(r["Sıra No"])}"><span class="cellTxt">${esc(r["Sıra No"])}</span></td>
          <td title="${esc(r["Marka"])}"><span class="cellTxt">${esc(r["Marka"] || '')}</span></td>
          <td class="left nameCell">${cellName(r["Ürün Adı (Compel)"] || '', r._clink || '')}</td>
          <td title="${esc(r["Ürün Kodu (Compel)"])}"><span class="cellTxt">${esc(r["Ürün Kodu (Compel)"] || '')}</span></td>
          <td class="eanCell" title="${esc(r["EAN (Compel)"])}"><span class="cellTxt">${esc(r["EAN (Compel)"] || '')}</span></td>

          <td class="left" title="T-Soft önerileri (seçili markalarda)">
            <div style="display:flex;flex-direction:column;gap:6px">
              <input type="text" list="supCodes" data-i="${i}" data-f="sup" placeholder="sup">
              ${sugHtml}
            </div>
          </td>

          <td><button class="mx" data-i="${i}">Eşleştir</button></td>
        </tr>`;
      }).join('');

      $('t2').innerHTML = colGrp(W2) + `<thead><tr>${head2}</tr></thead><tbody>${body2}</tbody>`;

      // ✅ “Eşleştir” (ws yok, sadece sup)
      $('t2').querySelectorAll('.mx').forEach(b => b.onclick = () => {
        const i = +b.dataset.i;
        const tr = $('t2').querySelector('#u_' + i);
        const sup = tr.querySelector('input[data-f="sup"]').value.trim();
        const ok = onManual?.(i, '', sup);
        if (ok) onDataChange?.();
      });

      // ✅ öneri butonu: sup input'u doldur
      $('t2').querySelectorAll('.sug').forEach(btn => btn.onclick = () => {
        const i = +btn.dataset.i;
        const sup = (btn.dataset.sup || '').trim();
        if (!sup) return;
        const tr = $('t2').querySelector('#u_' + i);
        const inp = tr?.querySelector('input[data-f="sup"]');
        if (!inp) return;
        inp.value = sup;
        inp.focus();
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
