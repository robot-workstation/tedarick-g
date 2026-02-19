import { TR, parseDelimited, pickColumn } from './utils.js';

/* Depo: paste/parse + index + agg (tek dosyada değişecek yer burası) */
export function createDepot() {
  const state = {
    ready: false,
    L4: [],
    C4: {},
    idxD: new Map(),
  };

  const codeNorm = s =>
    (s ?? '').toString()
      .replace(/\u00A0/g, ' ')
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleUpperCase(TR);

  const codeAlt = n => {
    if (!n) return '';
    if (!/^[0-9]+$/.test(n)) return '';
    return n.replace(/^0+(?=\d)/, '');
  };

  function stockNum(raw) {
    let s = (raw ?? '').toString().trim();
    if (!s) return 0;
    if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(/,/g, '.');
    else s = s.replace(/,/g, '.');
    s = s.replace(/[^0-9.\-]/g, '');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  }

  function buildIndex() {
    state.idxD = new Map();
    if (!state.ready || !state.L4.length || !state.C4.stokKodu) return;

    for (const r of state.L4) {
      const raw = r[state.C4.stokKodu] ?? '';
      const k = codeNorm(raw);
      if (!k) continue;

      if (!state.idxD.has(k)) state.idxD.set(k, []);
      state.idxD.get(k).push(r);

      const alt = codeAlt(k);
      if (alt && alt !== k) {
        if (!state.idxD.has(alt)) state.idxD.set(alt, []);
        state.idxD.get(alt).push(r);
      }
    }
  }

  function agg(code) {
    if (!state.ready) return { num: 0, raw: '' };
    const k = codeNorm(code || '');
    if (!k) return { num: 0, raw: '0' };

    const alt = codeAlt(k);
    const arr = state.idxD.get(k) || (alt ? state.idxD.get(alt) : null);
    if (!arr?.length) return { num: 0, raw: '0' };

    let sum = 0;
    for (const r of arr) sum += stockNum(r[state.C4.stok] ?? '');
    return { num: sum, raw: String(sum) };
  }

  // “noisy paste” parser (seninkiyle aynı mantık)
  function fromNoisyPaste(text) {
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

  function loadFromText(text) {
    const raw = (text ?? '').toString();
    if (!raw.trim()) return { ok: false, message: 'Depo verisi boş.' };

    // 1) CSV/TSV parse
    try {
      const p = parseDelimited(raw);
      const rows = p?.rows || [];
      if (rows.length) {
        const sample = rows[0];
        const stokKodu = pickColumn(sample, ['Stok Kodu', 'StokKodu', 'STOK KODU', 'Stock Code']);
        const stok = pickColumn(sample, ['Stok', 'Miktar', 'Qty', 'Quantity']);
        if (stokKodu && stok) {
          state.L4 = rows;
          state.C4 = {
            stokKodu,
            stok,
            ambar: pickColumn(sample, ['Ambar', 'Depo', 'Warehouse']),
            firma: pickColumn(sample, ['Firma', 'Şirket', 'Company'])
          };
          state.ready = true;
          buildIndex();
          return { ok: true, count: state.L4.length, mode: 'delimited' };
        }
      }
    } catch { /* fallback */ }

    // 2) noisy paste
    const r2 = fromNoisyPaste(raw);
    if (!r2.length) return { ok: false, message: 'Depo verisi çözümlenemedi. (Tablolu kopya bekleniyordu.)' };

    state.L4 = r2;
    state.C4 = { stokKodu: 'Stok Kodu', stok: 'Stok', ambar: 'Ambar', firma: 'Firma' };
    state.ready = true;
    buildIndex();
    return { ok: true, count: state.L4.length, mode: 'noisy' };
  }

  return { state, loadFromText, buildIndex, agg, codeNorm };
}
