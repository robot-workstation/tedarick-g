import { TR, T, parseDelimited, pickColumn } from './utils.js';

const $ = id => document.getElementById(id);

/* =========================
   ✅ Depo Modülü
   ========================= */
export function createDepot({ ui, onDepotLoaded } = {}) {
  // state
  let L4 = [];
  let C4 = {};
  let idxD = new Map();
  let depotReady = false;

  // dom
  const depoBtn = $('depoBtn');
  const depoModal = $('depoModal');
  const depoInner = $('depoInner');
  const depoPaste = $('depoPaste');
  const depoLoad = $('depoLoad');
  const depoClose = $('depoClose');
  const depoClear = $('depoClear');
  const depoSpin = $('depoSpin');

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

  const syncDepoSpin = () => {
    if (!depoSpin) return;
    const has = (depoPaste?.value || '').trim().length > 0;
    depoSpin.style.display = has ? 'none' : 'block';
  };

  const setDepoUi = (loaded) => {
    const n4 = $('n4');
    if (n4) {
      n4.textContent = loaded ? 'Yüklendi' : 'Yükle';
      n4.title = loaded ? `Aide yüklü (${L4.length})` : 'Yükle';
    }
    ui?.setChip?.('l4Chip', loaded ? `Aide:${L4.length}` : 'Aide:-');
  };

  /* ✅ Popover yerleşimi: tsoft ile aynı mantık/ölçü */
  const isOpen = () => depoModal?.style.display === 'block';

  const placePopover = () => {
    if (!depoBtn || !depoInner) return;

    depoInner.style.position = 'fixed';
    depoInner.style.left = '12px';
    depoInner.style.top = '12px';
    depoInner.style.visibility = 'hidden';

    requestAnimationFrame(() => {
      const a = depoBtn.getBoundingClientRect();
      const r = depoInner.getBoundingClientRect();

      const root = getComputedStyle(document.documentElement);
      const M = parseFloat(root.getPropertyValue('--popM')) || 12;
      const G = parseFloat(root.getPropertyValue('--popGap')) || 10;

      let left = Math.max(M, Math.min(a.left, window.innerWidth - r.width - M));

      // ✅ önce üst, sığmazsa alt
      let top = a.top - r.height - G;
      if (top < M) top = a.bottom + G;
      top = Math.max(M, Math.min(top, window.innerHeight - r.height - M));

      depoInner.style.left = left + 'px';
      depoInner.style.top = top + 'px';
      depoInner.style.visibility = 'visible';
    });
  };

  const showDepo = () => {
    if (!depoModal) return;
    depoModal.style.display = 'block';
    depoModal.setAttribute('aria-hidden', 'false');
    syncDepoSpin();
    placePopover();
    setTimeout(() => depoPaste?.focus(), 0);
  };

  const hideDepo = () => {
    if (!depoModal) return;
    depoModal.style.display = 'none';
    depoModal.setAttribute('aria-hidden', 'true');

    if (depoInner) {
      depoInner.style.position = '';
      depoInner.style.left = '';
      depoInner.style.top = '';
      depoInner.style.visibility = '';
    }
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
    ui?.setStatus?.('Depo yüklendi', 'ok');

    onDepotLoaded?.();
  }

  function reset() {
    depotReady = false;
    L4 = [];
    C4 = {};
    idxD = new Map();
    if (depoPaste) depoPaste.value = '';
    syncDepoSpin();
    setDepoUi(false);
  }

  // events
  if (depoBtn) depoBtn.onclick = showDepo;
  if (depoClose) depoClose.onclick = hideDepo;

  // backdrop click -> kapat
  depoModal?.addEventListener('click', (e) => {
    if (e.target === depoModal) hideDepo();
  });

  if (depoPaste) {
    depoPaste.addEventListener('input', syncDepoSpin);
    depoPaste.addEventListener('paste', () => setTimeout(syncDepoSpin, 0));
  }

  if (depoClear) depoClear.onclick = () => {
    if (depoPaste) depoPaste.value = '';
    syncDepoSpin();
    depoPaste?.focus();
  };

  if (depoLoad) depoLoad.onclick = () => {
    loadDepotFromText(depoPaste?.value || '');
    hideDepo();
  };

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) hideDepo();
  });

  addEventListener('resize', () => { if (isOpen()) placePopover(); });
  addEventListener('scroll', () => { if (isOpen()) placePopover(); }, true);

  // init ui
  setDepoUi(false);
  syncDepoSpin();

  return {
    reset,
    isReady: () => depotReady,
    agg: depotAgg,
    count: () => L4.length
  };
}
