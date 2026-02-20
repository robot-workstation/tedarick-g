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

  // ✅ marka normalize -> [{code, alt, name}]
  let idxBR = new Map();
  let brandLabelByNorm = new Map();

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

  // ✅ Marka '-' satırlarını ignore
  const isBadBrand = (raw) => {
    const s = T(raw);
    return !s || s === '-' || s === '—' || s.toLocaleUpperCase(TR) === 'N/A';
  };

  const brandNormFn = (raw) => {
    const s = T(raw);
    if (!s || isBadBrand(s)) return '';
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
    // ✅ Aide CSV’de ürün adı=MODEL
    const model = C4.model ? T(r[C4.model] ?? '') : '';
    if (model) return model;

    // fallback’ler
    const urunAdi = C4.urunAdi ? T(r[C4.urunAdi] ?? '') : '';
    if (urunAdi) return urunAdi;

    const ac = C4.aciklama ? T(r[C4.aciklama] ?? '') : '';
    if (ac) return ac;

    return '';
  }

  function buildBrandRecordsIdx() {
    idxBR = new Map();
    brandLabelByNorm = new Map();
    if (!depotReady || !L4.length || !C4.stokKodu) return;

    const seen = new Map(); // brNorm -> Set(key)
    for (const r of L4) {
      const brRaw = T(C4.marka ? (r[C4.marka] ?? '') : (r["Marka"] ?? ''));
      if (isBadBrand(brRaw)) continue;

      const brNorm = brandNormFn(brRaw);
      if (!brNorm) continue;

      if (!brandLabelByNorm.has(brNorm)) brandLabelByNorm.set(brNorm, brRaw || brNorm);

      const rawCode = r[C4.stokKodu] ?? '';
      const code = depotCodeNorm(rawCode);
      if (!code) continue;

      const alt = depotCodeAlt(code);
      const name = pickAideName(r);
      if (!name) continue;

      if (!seen.has(brNorm)) seen.set(brNorm, new Set());
      const s = seen.get(brNorm);
      const k = (code + '||' + name).toLocaleLowerCase(TR).replace(/\s+/g, ' ').trim();
      if (k && s.has(k)) continue;
      if (k) s.add(k);

      if (!idxBR.has(brNorm)) idxBR.set(brNorm, []);
      idxBR.get(brNorm).push({ code, alt, name });
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

  /**
   * ✅ REVİZE KURAL (senin istediğin):
   * - Compel/Seçili markalarla eşleşen Aide markaları içinden,
   * - Aide "Stok Kodu" (ve sayısalsa baştaki 0'ları atılmış hali) T-Soft CSV'deki
   *   "Tedarikçi Ürün Kodu" (sup) alanında HİÇ YOKSA,
   * - Aide "Model" adı "Depo Ürün Adı" olarak listelenir.
   *
   * Not: stok miktarına bakmıyoruz (0 da olabilir).
   */
  function unmatchedRows({ brandsNormSet, tsoftSupByBrand } = {}) {
    if (!depotReady) return [];
    const bnSet = (brandsNormSet instanceof Set) ? brandsNormSet : null;

    const out = [];
    const seen = new Set(); // br||name

    for (const [brNorm, arr] of idxBR.entries()) {
      if (bnSet && !bnSet.has(brNorm)) continue;

      // ✅ bu marka için T-Soft'taki TÜM sup kodları seti
      const supSet = tsoftSupByBrand?.get?.(brNorm);
      const sset = (supSet instanceof Set) ? supSet : null;

      for (const it of arr) {
        // ✅ Aide stok kodu, T-Soft sup listesinde VARSA => listeleme
        const hit = sset ? (sset.has(it.code) || (it.alt ? sset.has(it.alt) : false)) : false;
        if (hit) continue;

        const brandDisp = brandLabelByNorm.get(brNorm) || brNorm;
        const nm = it.name || '';
        if (!nm) continue;

        const k = (brNorm + '||' + nm).toLocaleLowerCase(TR).replace(/\s+/g, ' ').trim();
        if (!k || seen.has(k)) continue;
        seen.add(k);

        const ag = depotAgg(it.code);
        out.push({
          _type: 'depo',
          _bn: brNorm,
          "Marka": brandDisp,
          "Depo Ürün Adı": nm,
          _dnum: ag?.num ?? 0
        });
      }
    }

    out.sort((a, b) => {
      const ab = String(a["Marka"] || '').localeCompare(String(b["Marka"] || ''), 'tr', { sensitivity: 'base' });
      if (ab) return ab;
      return String(a["Depo Ürün Adı"] || '').localeCompare(String(b["Depo Ürün Adı"] || ''), 'tr', { sensitivity: 'base' });
    });

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
    brandLabelByNorm = new Map();
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
    unmatchedRows
  };
}
