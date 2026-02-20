// js/depot.js
import { TR, T, parseDelimited, pickColumn } from './utils.js';

const $ = id => document.getElementById(id);

/* =========================
   ✅ Depo Modülü
   ========================= */

export function createDepot({ ui, onDepotLoaded, normBrand } = {}) {
  // state
  let L4 = [];
  let C4 = {};
  let idxD = new Map();
  let depotReady = false;

  // ✅ brand -> [{codeNorm, codeAlt, name}]
  let idxBR = new Map();

  // dom
  const depoBtn = $('depoBtn');
  const depoModal = $('depoModal');
  const depoInner = $('depoInner');
  const depoPaste = $('depoPaste');
  const depoLoad = $('depoLoad');
  const depoPasteBtn = $('depoPasteBtn');
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

  const brandNorm = (raw) => {
    const s = T(raw);
    if (!s) return '';
    if (typeof normBrand === 'function') return normBrand(s);
    return s.toLocaleUpperCase(TR).replace(/\s+/g, ' ').trim();
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

  function pickAideName(r) {
    // ✅ istenen: Aide CSV’de MARKA’dan sonra MODEL sütunu (ürün adı gibi)
    const model = C4.model ? T(r[C4.model] ?? '') : '';
    if (model) return model;

    // fallback
    const urunAdi = C4.urunAdi ? T(r[C4.urunAdi] ?? '') : '';
    if (urunAdi) return urunAdi;

    const ac = C4.aciklama ? T(r[C4.aciklama] ?? '') : '';
    if (ac) return ac;

    return '';
  }

  function buildBrandRecordsIdx() {
    idxBR = new Map();
    if (!depotReady || !L4.length || !C4.stokKodu) return;

    const seen = new Map(); // brand -> Set(key)
    for (const r of L4) {
      const br = brandNorm(C4.marka ? (r[C4.marka] ?? '') : (r["Marka"] ?? ''));
      if (!br) continue;

      const rawCode = r[C4.stokKodu] ?? '';
      const code = depotCodeNorm(rawCode);
      if (!code) continue;

      const alt = depotCodeAlt(code);
      const name = pickAideName(r);
      if (!name) continue;

      if (!seen.has(br)) seen.set(br, new Set());
      const s = seen.get(br);
      const k = (code + '||' + name).toLocaleLowerCase(TR).replace(/\s+/g, ' ').trim();
      if (k && s.has(k)) continue;
      if (k) s.add(k);

      if (!idxBR.has(br)) idxBR.set(br, []);
      idxBR.get(br).push({ code, alt, name });
    }

    for (const [br, arr] of idxBR.entries()) {
      arr.sort((a, b) => String(a.name).localeCompare(String(b.name), 'tr', { sensitivity: 'base' }));
    }
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

    // ✅ yeni: marka->kayıt index
    buildBrandRecordsIdx();
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

  // ✅ İSTENEN: Aide’de marka eşleşen ama Stok Kodu (Aide) T-Soft sup ile eşleşmeyen ürün adları
  function unmatchedNamesByBrand(brandNormKey, tsoftSupSet) {
    if (!depotReady) return [];
    const br = T(brandNormKey);
    if (!br) return [];

    const arr = idxBR.get(br) || [];
    if (!arr.length) return [];

    const supSet = (tsoftSupSet instanceof Set) ? tsoftSupSet : null;

    // sup set yoksa “filtreleme yapmadan” listeyi döndürmek yerine boş dönmek daha doğru
    if (!supSet || !supSet.size) return arr.map(x => x.name);

    const out = [];
    const seen = new Set();
    for (const it of arr) {
      const hit = supSet.has(it.code) || (it.alt ? supSet.has(it.alt) : false);
      if (hit) continue;

      const nm = it.name || '';
      const k = nm.toLocaleLowerCase(TR).replace(/\s+/g, ' ').trim();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(nm);
    }

    out.sort((a, b) => String(a).localeCompare(String(b), 'tr', { sensitivity: 'base' }));
    return out;
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
      n4.title = loaded ? `Depo yüklü (${L4.length})` : 'Yükle';
    }
    ui?.setChip?.('l4Chip', loaded ? `Aide:${L4.length}` : 'Aide:-');
  };

  // ✅ Popover konumlandırma
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

      let left = a.left;
      left = Math.max(M, Math.min(left, window.innerWidth - r.width - M));

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
    placePopover();
    syncDepoSpin();
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
            firma: pickColumn(sample, ['Firma', 'Şirket', 'Company']),
            marka: pickColumn(sample, ['Marka', 'MARKA', 'Brand', 'BRAND']),
            model: pickColumn(sample, ['Model', 'MODEL']),
            urunAdi: pickColumn(sample, ['Ürün Adı', 'Urun Adi', 'Ürün Adi', 'Product Name', 'Product']),
            aciklama: pickColumn(sample, ['Açıklama', 'Aciklama', 'Description'])
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
      C4 = {
        stokKodu: 'Stok Kodu',
        stok: 'Stok',
        ambar: 'Ambar',
        firma: 'Firma',
        marka: 'Marka',
        model: 'Model',
        aciklama: 'Açıklama'
      };
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
    idxBR = new Map();
    if (depoPaste) depoPaste.value = '';
    syncDepoSpin();
    setDepoUi(false);
  }

  // events
  if (depoBtn) depoBtn.onclick = showDepo;
  if (depoClose) depoClose.onclick = hideDepo;

  if (depoPasteBtn) depoPasteBtn.onclick = async () => {
    try {
      if (!navigator.clipboard?.readText) {
        alert('Panoya erişilemiyor. Sayfayı HTTPS üzerinden açın ve izin verin.');
        return;
      }
      depoPasteBtn.disabled = true;
      const txt = await navigator.clipboard.readText();
      if (!txt?.trim()) {
        alert('Panoda yapıştırılacak metin yok.');
        return;
      }
      if (depoPaste) depoPaste.value = txt;
      syncDepoSpin();
      depoPaste?.focus();
    } catch (e) {
      console.error(e);
      alert('Pano okunamadı. Tarayıcı izinlerini kontrol edin.');
    } finally {
      if (depoPasteBtn) depoPasteBtn.disabled = false;
    }
  };

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
    if (e.key === 'Escape' && depoModal?.style.display !== 'none') hideDepo();
  });

  addEventListener('resize', () => {
    if (depoModal?.style.display === 'block') placePopover();
  });
  addEventListener('scroll', () => {
    if (depoModal?.style.display === 'block') placePopover();
  }, true);

  // init ui
  setDepoUi(false);
  syncDepoSpin();

  return {
    reset,
    isReady: () => depotReady,
    agg: depotAgg,
    count: () => L4.length,
    unmatchedNamesByBrand
  };
}
