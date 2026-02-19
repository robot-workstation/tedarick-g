import { esc, T } from './utils.js';

/* UI: render + chips + layout (UI değişiklikleri burada) */
const $ = id => document.getElementById(id);

const colGrp = w => `<colgroup>${w.map(x => `<col style="width:${x}%">`).join('')}</colgroup>`;
const disp = c => c === "Sıra No" ? "Sıra" : c;

const fmtHdr = s => {
  s = (s ?? '').toString();
  const m = s.match(/^(.*?)(\s*\([^)]*\))\s*$/);
  if (!m) return esc(s);
  return `<span class="hMain">${esc(m[1].trimEnd())}</span> <span class="hParen">${esc(m[2].trim())}</span>`;
};

export function setChip(id, t, cls = '') {
  const e = $(id); if (!e) return;
  e.textContent = t; e.title = t;
  e.className = 'chip' + (cls ? ` ${cls}` : '');
}
export function chipVis(id, visible) {
  const e = $(id); if (!e) return;
  e.style.display = visible ? '' : 'none';
}
export function setStatus(t, k = 'ok') { setChip('stChip', t, k); }

export function setGoMode(mode) {
  const goBtn = $('go'); if (!goBtn) return;
  if (mode === 'clear') { goBtn.dataset.mode = 'clear'; goBtn.textContent = 'Temizle'; goBtn.title = 'Temizle'; }
  else { goBtn.dataset.mode = 'list'; goBtn.textContent = 'Listele'; goBtn.title = 'Listele'; }
}

export function setDepoUi(loaded, count) {
  const n4 = $('n4');
  if (n4) {
    n4.textContent = loaded ? 'Yüklendi' : 'Yükle';
    n4.title = loaded ? `Depo yüklü (${count})` : 'Yükle';
  }
  setChip('l4Chip', loaded ? `L4:${count}` : 'L4:-');
}

export function bindFileLabel(inId, outId, empty) {
  const inp = $(inId), out = $(outId); if (!inp || !out) return;
  const upd = () => {
    const f = inp.files?.[0];
    if (!f) { out.textContent = empty; out.title = empty; }
    else { out.textContent = 'Seçildi'; out.title = f.name; }
  };
  inp.addEventListener('change', upd); upd();
}

export function populateDatalists(L2, C2) {
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

/* Layout adjust (aynı mantık) */
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

const cellName = (txt, href) => {
  const v = (txt ?? '').toString(), u = href || '';
  return u
    ? `<a class="nm" href="${esc(u)}" target="_blank" rel="noopener" title="${esc(v)}">${esc(v)}</a>`
    : `<span class="nm" title="${esc(v)}">${esc(v)}</span>`;
};

export function renderTables({ COLS, R, U, depotReady, onManual }) {
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

    $('t2').querySelectorAll('.mx').forEach(b => {
      b.onclick = () => {
        const i = +b.dataset.i;
        const tr = $('t2').querySelector('#u_' + i);
        const ws = tr.querySelector('input[data-f="ws"]').value.trim();
        const sup = tr.querySelector('input[data-f="sup"]').value.trim();
        onManual?.(i, ws, sup);
      };
    });
  }

  const matched = R.filter(x => x._m).length;
  setChip('sum', `Toplam ${R.length} • ✓${matched} • ✕${R.length - matched}`, 'muted');

  $('dl1').disabled = !R.length;
  $('dl3').disabled = false;
  if (btn2) btn2.disabled = !U.length;

  sched();
}
