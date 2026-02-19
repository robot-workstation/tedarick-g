// js/app.js
import { TR, esc, parseDelimited, pickColumn, downloadBlob, toCSV, readFileText } from './utils.js';
import { loadBrands, scanCompel } from './api.js';
import { createMatcher, normBrand, COLS } from './match.js';
import { createDepot } from './depot.js';
import { createRenderer } from './render.js';

const $ = id => document.getElementById(id);

/* =========================
   ✅ Worker API (değişmedi)
   ========================= */
const API_BASE = "https://robot-workstation.tvkapora.workers.dev"; // gerekirse değiştir

/* =========================
   ✅ Supplier state
   ========================= */
const SUPPLIERS = { COMPEL: 'Compel', AKALIN: 'Akalın' };
let ACTIVE_SUPPLIER = SUPPLIERS.COMPEL;

let COMPEL_BRANDS_CACHE = null;

const AKALIN_BRAND_NAMES = [
  "Acoustic Energy","AIAIAI","AMS-Neve","Antelope Audio","Apple","ART","Artiphon","Artnovion","Asparion","ATC-Loudspeakers",
  "Audient","Audio-Technica","Audix","Auratone","Avid","Barefoot","Bricasti-Design","Celemony","Centrance","CME",
  "Dangerous-Music","DD-HiFi","Digital-Audio-Denmark","Dj-techtools","Direct-Sound","Doto-Design","Drawmer","DreamWave","Earthworks-Audio","Elektron-Music-Machines",
  "Elysia","Embodme","Empirical-Labs","Erica-Synths","ESI-Audio","Eve-Audio","Eventide-Audio","Fatman-by-TL-Audio","Flock-Audio","Focusrite",
  "Freqport","Gainlab-Audio","Gator-Frameworks","Grace-Design","Hifiman","Hori","Icon-Pro-Audio","IK-Multimedia","IsoAcoustics","Konig-Meyer",
  "Koss","Lake-People","Lynx-Studio-Technology","M-Live","Magma","Manley-Laboratories","Melbourne-Instruments","Microtech-Gefell","Midiplus","Millennia-Music-Media",
  "Modal-Electronics","Mogami","Mojave-Audio","Monster-Audio","Monster-Cable","Moondrop","MOTU","MXL-Microphones","Mytek-Audio","Native-Instruments",
  "Neo-Created-by-OYAIDE-Elec","Neumann","Neutrik","Noble-Audio","Odisei-Music","Phase","Polyend","Primacoustic","ProCab","PSI-Audio",
  "Radial-Engineering","Relacart","Reloop","Reloop-HiFi","Rhodes","Royer-Labs","Sendy-Audio","Signex","Sivga-Audio","Slate-Digital",
  "Smithson-Martin","Soma-Synths","Sonnet","Specialwaves","Spectrasonics","Steven-Slate-Audio","Studiologic-by-Fatar","Synchro-Arts","Tantrum-Audio","Teenage-Engineering",
  "Telefunken-Elektroakustik","Thermionic-Culture","Topping-Audio","Topping-Professional","Triton-Audio","Truthear","Tube-Tech","Udo-Audio","Ultimate-Support","Waldorf",
  "Waves"
];

/* =========================
   ✅ UI helpers
   ========================= */
const setBrandStatus = (txt) => {
  const el = $('brandStatus');
  if (el) el.textContent = txt;
};

const normalizeChipText = (id, t) => {
  let s = String(t ?? '');
  if (id === 'l2Chip') s = s.replace(/^Sescibaba:/i, 'T-Soft:').replace(/^Sescibaba\b/i, 'T-Soft');
  if (id === 'l4Chip') s = s.replace(/^Depo:/i, 'Aide:').replace(/^Depo\b/i, 'Aide');
  return s;
};

const setChip = (id, t, cls = '') => {
  const e = $(id);
  if (!e) return;
  const txt = normalizeChipText(id, t);
  e.textContent = txt;
  e.title = txt;
  e.className = 'chip' + (cls ? ` ${cls}` : '');
};

const setStatus = (t, k = 'ok') => setChip('stChip', t, k);

const ui = { setChip, setStatus };

const showBrandStatusChip = (show) => {
  const el = $('brandStatus');
  if (!el) return;
  if (ACTIVE_SUPPLIER === SUPPLIERS.AKALIN) { el.style.display = 'none'; return; }
  el.style.display = show ? '' : 'none';
};

const INFO_HIDE_IDS = ['brandStatus', 'selChip', 'l1Chip', 'l2Chip', 'l4Chip', 'sum'];

const applySupplierUi = () => {
  const goBtn = $('go');
  if (goBtn) {
    if (ACTIVE_SUPPLIER === SUPPLIERS.AKALIN) {
      goBtn.classList.add('wip');
      goBtn.title = 'Yapım Aşamasında';
    } else {
      goBtn.classList.remove('wip');
      goBtn.title = 'Listele';
    }
  }

  if (ACTIVE_SUPPLIER === SUPPLIERS.AKALIN) {
    // ✅ Bilgi ekranında sadece bu mesaj kalsın
    for (const id of INFO_HIDE_IDS) {
      const el = $(id);
      if (el) el.style.display = 'none';
    }
    const st = $('stChip');
    if (st) st.style.display = '';
    setStatus('Tedarikçi Akalın entegre edilmedi. Lütfen farklı bir tedarikçi seçin.', 'bad');
  } else {
    // ✅ normal mod: chip’leri geri aç
    for (const id of INFO_HIDE_IDS) {
      const el = $(id);
      if (el) el.style.display = '';
    }
    // Akalın mesajı kalmışsa temizle
    const cur = ($('stChip')?.textContent || '');
    if (cur.includes('Akalın entegre edilmedi')) setStatus('Hazır', 'ok');
  }
};

/* =========================
   ✅ Markalar ↔ Liste arası seperatör + Liste Başlığı (dinamik)
   ========================= */
let listTitleEl = null;
let listSepEl = null;

const joinTrList = (arr) => {
  const a = (arr || []).filter(Boolean);
  if (!a.length) return '';
  if (a.length === 1) return a[0];
  if (a.length === 2) return `${a[0]} ve ${a[1]}`;
  return `${a.slice(0, -1).join(', ')} ve ${a[a.length - 1]}`;
};

const getSupplierName = () => {
  const t = ($('supplierLabel')?.textContent || $('supplierBtn')?.textContent || '').trim();
  const m = t.match(/:\s*(.+)\s*$/);
  if (m) return (m[1] || '').trim() || '—';
  return t.replace(/^1\)\s*/i, '').replace(/^Tedarikçi\s*/i, '').trim() || '—';
};

let BRANDS = [];
let SELECTED = new Set(); // brand.id

const getSelectedBrandNames = () => {
  const out = [];
  for (const id of SELECTED) {
    const b = BRANDS.find(x => x.id === id);
    if (b?.name) out.push(String(b.name));
  }
  out.sort((a, b) => a.localeCompare(b, 'tr', { sensitivity: 'base' }));
  return out;
};

const buildListTitle = () => {
  const sup = getSupplierName();
  const brands = getSelectedBrandNames();
  if (!brands.length) return `Tedarikçi ${sup} için marka seçilmedi.`;

  const brTxt = joinTrList(brands);
  const suffix = brands.length === 1 ? 'markasında' : 'markalarında';
  return `Tedarikçi ${sup} için ${brTxt} ${suffix} yapılan T-Soft ve Aide karşılaştırma listesi`;
};

const ensureListHeader = () => {
  const maincol = document.querySelector('section.maincol');
  if (!maincol) return;
  if (listTitleEl) return;

  const sep = document.createElement('div');
  sep.className = 'rowSep';
  sep.setAttribute('aria-hidden', 'true');

  listTitleEl = document.createElement('div');
  listTitleEl.id = 'listTitle';
  listTitleEl.className = 'listTitleBar';

  const first = maincol.firstElementChild;
  maincol.insertBefore(sep, first);
  maincol.insertBefore(listTitleEl, first);

  listSepEl = sep;

  // ✅ Listele'ye basmadan önce görünmesin
  listTitleEl.style.display = 'none';
  listSepEl.style.display = 'none';

  const supEl = $('supplierLabel');
  if (supEl && 'MutationObserver' in window) {
    new MutationObserver(() => updateListTitle()).observe(supEl, {
      characterData: true,
      childList: true,
      subtree: true
    });
  }
};

const setListTitleVisible = (show) => {
  ensureListHeader();
  if (listTitleEl) listTitleEl.style.display = show ? '' : 'none';
  if (listSepEl) listSepEl.style.display = show ? '' : 'none';
};

const updateListTitle = () => {
  ensureListHeader();
  if (!listTitleEl) return;
  listTitleEl.textContent = buildListTitle();
};

ensureListHeader();
setListTitleVisible(false);

/* =========================
   ✅ T-Soft Stok: popup + konumlandırma (butonun üstünde)
   ========================= */
(() => {
  const box = $('sescBox');       // label
  const inp = $('f2');            // file input
  const modal = $('tsoftModal');
  const inner = $('tsoftInner');
  const closeBtn = $('tsoftClose');
  if (!box || !inp || !modal || !closeBtn || !inner) return;

  let allowPickerOnce = false;

  const isOpen = () => modal.style.display !== 'none' && modal.style.display !== '';

  const placeAboveButton = () => {
    inner.style.position = 'fixed';
    inner.style.left = '12px';
    inner.style.top = '12px';
    inner.style.visibility = 'hidden';

    requestAnimationFrame(() => {
      const rBtn = box.getBoundingClientRect();
      const rIn = inner.getBoundingClientRect();
      const M = 12;
      const GAP = 10;

      let left = rBtn.left;
      left = Math.max(M, Math.min(left, window.innerWidth - rIn.width - M));

      let top = rBtn.top - rIn.height - GAP;
      if (top < M) top = rBtn.bottom + GAP;

      top = Math.max(M, Math.min(top, window.innerHeight - rIn.height - M));

      inner.style.left = left + 'px';
      inner.style.top = top + 'px';
      inner.style.visibility = 'visible';
    });
  };

  const show = () => {
    modal.style.display = 'block';
    modal.setAttribute('aria-hidden', 'false');
    placeAboveButton();
    setTimeout(() => closeBtn.focus(), 0);
  };

  const hide = () => {
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    inner.style.position = '';
    inner.style.left = '';
    inner.style.top = '';
    inner.style.visibility = '';
  };

  const openPicker = () => {
    allowPickerOnce = true;
    hide();
    requestAnimationFrame(() => {
      try { inp.click(); }
      finally { setTimeout(() => { allowPickerOnce = false; }, 0); }
    });
  };

  box.addEventListener('click', (e) => {
    if (inp.disabled) return;

    if (allowPickerOnce) {
      allowPickerOnce = false;
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    show();
  }, true);

  closeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openPicker();
  });

  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!isOpen()) return;
    e.preventDefault();
    e.stopPropagation();
    openPicker();
  });

  addEventListener('resize', () => { if (isOpen()) placeAboveButton(); });
  addEventListener('scroll', () => { if (isOpen()) placeAboveButton(); }, true);
})();

/* =========================
   ✅ Tedarikçi Dropdown
   ========================= */
(() => {
  const wrap = $('supplierWrap');
  const btn = $('supplierBtn');
  const menu = $('supplierMenu');
  const addBtn = $('supplierAddBtn');

  const itemCompel = $('supplierCompelItem');
  const itemAkalin = $('supplierAkalinItem');

  if (!wrap || !btn || !menu || !itemCompel || !itemAkalin) return;

  const open = () => {
    menu.classList.add('show');
    menu.setAttribute('aria-hidden', 'false');
    btn.setAttribute('aria-expanded', 'true');
  };
  const close = () => {
    menu.classList.remove('show');
    menu.setAttribute('aria-hidden', 'true');
    btn.setAttribute('aria-expanded', 'false');
  };
  const toggle = () => (menu.classList.contains('show') ? close() : open());

  const paintMenu = () => {
    const mk = (el, name) => {
      const sel = (ACTIVE_SUPPLIER === name);
      el.setAttribute('aria-disabled', sel ? 'true' : 'false');
      el.textContent = sel ? `${name} (seçili)` : name;
    };
    mk(itemCompel, SUPPLIERS.COMPEL);
    mk(itemAkalin, SUPPLIERS.AKALIN);
  };

  const setSupplier = async (name) => {
    if (!name || name === ACTIVE_SUPPLIER) { close(); return; }

    ACTIVE_SUPPLIER = name;

    const lab = $('supplierLabel');
    if (lab) lab.textContent = `1) Tedarikçi: ${name}`;

    // marka datası değişsin
    if (name === SUPPLIERS.AKALIN) {
      BRANDS = AKALIN_BRAND_NAMES.map((nm, i) => ({
        id: i + 1,
        slug: String(nm).toLocaleLowerCase(TR).replace(/\s+/g, '-'),
        name: nm,
        count: '—'
      }));
      setBrandStatus(`Akalın • Marka: ${BRANDS.length}`);
      renderBrands();
    } else {
      if (COMPEL_BRANDS_CACHE?.length) {
        BRANDS = COMPEL_BRANDS_CACHE;
        setBrandStatus(`Hazır • Marka: ${BRANDS.length}`);
        renderBrands();
      } else {
        await initBrands();
      }
    }

    // sayfayı yeni açmış gibi temizle
    resetAll();

    paintMenu();
    close();
  };

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    paintMenu();
    toggle();
  });

  itemCompel.addEventListener('click', (e) => {
    e.preventDefault();
    if (itemCompel.getAttribute('aria-disabled') === 'true') return;
    void setSupplier(SUPPLIERS.COMPEL);
  });

  itemAkalin.addEventListener('click', (e) => {
    e.preventDefault();
    if (itemAkalin.getAttribute('aria-disabled') === 'true') return;
    void setSupplier(SUPPLIERS.AKALIN);
  });

  addBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    close();
  });

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) close();
  });

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  paintMenu();
})();

/* =========================
   ✅ Marka seçimi UI
   ========================= */
const renderBrands = () => {
  const list = $('brandList');
  if (!list) return;
  list.innerHTML = '';

  const sorted = [...BRANDS].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), 'tr', { sensitivity: 'base' })
  );

  sorted.forEach((b) => {
    const d = document.createElement('div');
    d.className = 'brand' + (SELECTED.has(b.id) ? ' sel' : '');
    d.tabIndex = 0;
    d.dataset.id = String(b.id);

    d.innerHTML = `
      <div class="bRow">
        <span class="bNm" title="${esc(b.name)}">${esc(b.name)}</span>
        <span class="bCt">(${esc(b.count)})</span>
      </div>
    `;
    list.appendChild(d);
  });

  setChip('selChip', `Seçili ${SELECTED.size}`, 'muted');
  updateListTitle();
  applySupplierUi();
};

const toggleBrand = (id, el) => {
  if (SELECTED.has(id)) {
    SELECTED.delete(id);
    el.classList.remove('sel');
  } else {
    SELECTED.add(id);
    el.classList.add('sel');
  }
  setChip('selChip', `Seçili ${SELECTED.size}`, 'muted');
  updateListTitle();
  applySupplierUi();
};

$('brandList')?.addEventListener('click', (e) => {
  const el = e.target.closest('.brand');
  if (!el) return;
  const id = Number(el.dataset.id);
  if (!Number.isFinite(id)) return;
  toggleBrand(id, el);
});
$('brandList')?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest('.brand');
  if (!el) return;
  e.preventDefault();
  const id = Number(el.dataset.id);
  if (!Number.isFinite(id)) return;
  toggleBrand(id, el);
});

/* ✅ 2) Marka Seç kutusu: markaları glowy yap */
const pulseBrands = () => {
  const list = $('brandList');
  if (!list) return;
  list.classList.remove('glow');
  void list.offsetWidth;
  list.classList.add('glow');
  setTimeout(() => list.classList.remove('glow'), 950);
};
$('brandHintBtn')?.addEventListener('click', pulseBrands);

async function initBrands() {
  setBrandStatus('Markalar yükleniyor…');
  try {
    const data = await loadBrands(API_BASE);
    COMPEL_BRANDS_CACHE = data;
    if (ACTIVE_SUPPLIER === SUPPLIERS.COMPEL) {
      BRANDS = data;
      setBrandStatus(`Hazır • Marka: ${BRANDS.length}`);
      renderBrands();
      updateListTitle();
    }
  } catch (e) {
    console.error(e);
    if (ACTIVE_SUPPLIER === SUPPLIERS.COMPEL) {
      setBrandStatus('Markalar yüklenemedi (API).');
      updateListTitle();
    }
  } finally {
    applySupplierUi();
  }
}

/* =========================
   ✅ Depo + Matcher + Renderer
   ========================= */
const depot = createDepot({
  ui,
  onDepotLoaded: () => {
    if (matcher.hasData()) {
      matcher.runMatch();
      refresh();
    }
    applySupplierUi();
  }
});

const matcher = createMatcher({
  getDepotAgg: () => depot.agg,
  isDepotReady: () => depot.isReady()
});

const renderer = createRenderer({
  ui,
  onManual: (i, ws, sup) => matcher.manualMatch(i, ws, sup),
  onDataChange: () => refresh()
});

function refresh() {
  const { R, U } = matcher.getResults();
  renderer.render(R, U, depot.isReady());
  applySupplierUi();
}

/* =========================
   ✅ Dosya kutusu (T-Soft)
   ========================= */
const bind = (inId, outId, empty) => {
  const inp = $(inId), out = $(outId); if (!inp || !out) return;
  const upd = () => {
    const f = inp.files?.[0];

    if (!f) {
      out.textContent = empty; out.title = empty;

      if (ACTIVE_SUPPLIER !== SUPPLIERS.AKALIN) {
        showBrandStatusChip(true);
        if (BRANDS?.length) setBrandStatus(`Hazır • Marka: ${BRANDS.length}`);
      }
    } else {
      out.textContent = 'Seçildi'; out.title = f.name;
      if (ACTIVE_SUPPLIER !== SUPPLIERS.AKALIN) showBrandStatusChip(false);
    }

    applySupplierUi();
  };
  inp.addEventListener('change', upd); upd();
};
bind('f2', 'n2', 'Yükle');

/* =========================
   ✅ Scan state
   ========================= */
let abortCtrl = null;
const goBtn = $('go');

const setScanState = (on) => {
  if (goBtn) goBtn.disabled = on;
  $('f2') && ($('f2').disabled = on);
  $('depoBtn') && ($('depoBtn').disabled = on);
};

/* =========================
   ✅ Generate (Listele)
   ========================= */
async function generate() {
  const file = $('f2')?.files?.[0];

  if (!SELECTED.size) { alert('En az 1 marka seç.'); return false; }
  if (!file) { alert('Lütfen T-Soft Stok CSV seç.'); return false; }

  updateListTitle();

  setStatus('Okunuyor…', 'unk');
  setChip('l1Chip', 'Compel:—');
  setChip('l2Chip', 'T-Soft:—');
  // l4Chip depot modülü güncelliyor; setChip wrapper Depo→Aide map’liyor

  abortCtrl = new AbortController();
  setScanState(true);

  try {
    matcher.resetAll();

    // eski listeyi hemen temizle (yeni tarama başlamadan)
    const t1 = $('t1'), t2 = $('t2');
    if (t1) t1.innerHTML = '';
    if (t2) t2.innerHTML = '';
    const sec = $('unmatchedSection');
    if (sec) sec.style.display = 'none';

    const selectedBrands = BRANDS.filter(x => SELECTED.has(x.id));

    if (selectedBrands.length === BRANDS.length) {
      const ok = confirm('Tüm markaları taramak üzeresiniz. Emin misiniz?');
      if (!ok) throw new Error('İptal edildi.');
    }

    const t2Promise = readFileText(file);

    let seq = 0;
    const chosen = selectedBrands.map(b => ({ id: b.id, slug: b.slug, name: b.name, count: b.count }));

    const scanPromise = (async () => {
      const rows = [];
      await scanCompel(API_BASE, chosen, {
        signal: abortCtrl.signal,
        onMessage: (m) => {
          if (!m) return;

          if (m.type === 'brandStart' || m.type === 'page') {
            const br = m.brand || '';
            const p = m.page || 0;
            const ps = m.pages || 0;
            setStatus(`Taranıyor: ${br} (${p}/${ps})`, 'unk');
          } else if (m.type === 'product') {
            const p = m.data || {};
            seq++;
            rows.push({
              "Sıra No": String(seq),
              "Marka": String(p.brand || ''),
              "Ürün Adı": String(p.title || 'Ürün'),
              "Ürün Kodu": String(p.productCode || ''),
              "Stok": String(p.stock || ''),
              "EAN": String(p.ean || ''),
              "Link": String(p.url || '')
            });

            if (seq % 250 === 0) setChip('l1Chip', `Compel:${rows.length}`);
          } else if (m.type === 'brandDone') {
            setStatus(`Marka bitti: ${m.brand} (${m.found ?? ''})`, 'unk');
          } else if (m.type === 'error') {
            console.warn('scan error:', m.message);
          }
        }
      });
      return rows;
    })();

    const [t2, L1] = await Promise.all([t2Promise, scanPromise]);
    setChip('l1Chip', `Compel:${L1.length}`);

    const p2 = parseDelimited(t2);
    if (!p2.rows.length) { alert('T-Soft CSV boş görünüyor.'); return false; }

    const s2 = p2.rows[0];

    const C1 = {
      siraNo: "Sıra No",
      marka: "Marka",
      urunAdi: "Ürün Adı",
      urunKodu: "Ürün Kodu",
      stok: "Stok",
      ean: "EAN",
      link: "Link"
    };

    const C2 = {
      ws: pickColumn(s2, ['Web Servis Kodu', 'WebServis Kodu', 'WebServisKodu']),
      urunAdi: pickColumn(s2, ['Ürün Adı', 'Urun Adi', 'Ürün Adi']),
      sup: pickColumn(s2, ['Tedarikçi Ürün Kodu', 'Tedarikci Urun Kodu', 'Tedarikçi Urun Kodu']),
      barkod: pickColumn(s2, ['Barkod', 'BARKOD']),
      stok: pickColumn(s2, ['Stok']),
      marka: pickColumn(s2, ['Marka']),
      seo: pickColumn(s2, ['SEO Link', 'Seo Link', 'SEO', 'Seo'])
    };

    const need = (o, a) => a.filter(k => !o[k]);
    const miss = need(C2, ['ws', 'sup', 'barkod', 'stok', 'marka', 'urunAdi', 'seo']);
    if (miss.length) {
      setStatus('Sütun eksik', 'bad');
      console.warn('L2 missing', miss);
      alert('T-Soft CSV sütunları eksik. Konsola bak.');
      return false;
    }

    const L2all = p2.rows;

    const brands = new Set(L1.map(r => normBrand(r[C1.marka] || '')).filter(Boolean));
    const L2 = L2all.filter(r => brands.has(normBrand(r[C2.marka] || '')));

    matcher.loadData({ l1: L1, c1: C1, l2: L2, c2: C2, l2All: L2all });
    matcher.runMatch();
    refresh();

    setStatus('Hazır', 'ok');
    setChip('l2Chip', `T-Soft:${L2.length}/${L2all.length}`);

    // ✅ Liste başlığı: Listele sonrası görünür olsun
    setListTitleVisible(true);

    return true;
  } catch (e) {
    console.error(e);
    if (String(e?.message || '').includes('İptal edildi')) setStatus('İptal edildi', 'unk');
    else setStatus('Hata (konsol)', 'bad');

    alert(e?.message || String(e));
    return false;
  } finally {
    abortCtrl = null;
    setScanState(false);
    applySupplierUi();
  }
}

/* =========================
   ✅ Çıktılar
   ========================= */
$('dl1')?.addEventListener('click', () => {
  const { R } = matcher.getResults();
  const clean = (R || []).map(r => Object.fromEntries(COLS.map(c => [c, r[c]])));
  downloadBlob('sonuc-eslestirme.csv', new Blob([toCSV(clean, COLS)], { type: 'text/csv;charset=utf-8' }));
});

/* =========================
   ✅ Temizle (sayfa yeni açılmış gibi)
   ========================= */
function resetAll() {
  try { abortCtrl?.abort?.(); } catch {}
  abortCtrl = null;
  setScanState(false);

  // liste başlığı gizlensin (listelemeden önce)
  setListTitleVisible(false);

  // marka seçimleri
  SELECTED.clear();
  renderBrands();

  // dosya input sıfırla
  const f2 = $('f2');
  if (f2) f2.value = '';
  const n2 = $('n2');
  if (n2) { n2.textContent = 'Yükle'; n2.title = 'Yükle'; }

  // datalist temizle
  const wsDl = $('wsCodes'), supDl = $('supCodes');
  if (wsDl) wsDl.innerHTML = '';
  if (supDl) supDl.innerHTML = '';

  // depo sıfırla
  depot.reset();

  // matcher sıfırla
  matcher.resetAll();

  // tablolar
  const t1 = $('t1'), t2 = $('t2');
  if (t1) t1.innerHTML = '';
  if (t2) t2.innerHTML = '';
  const sec = $('unmatchedSection');
  if (sec) sec.style.display = 'none';

  // butonlar
  const dl1 = $('dl1');
  if (dl1) dl1.disabled = true;

  // chipler
  setChip('l1Chip', 'Compel:-');
  setChip('l2Chip', 'T-Soft:-');
  setChip('l4Chip', 'Aide:-');
  setChip('sum', 'Toplam 0 • ✓0 • ✕0', 'muted');
  setChip('selChip', 'Seçili 0', 'muted');

  // marka chip davranışı
  if (ACTIVE_SUPPLIER !== SUPPLIERS.AKALIN) {
    showBrandStatusChip(true);
    if (BRANDS?.length) setBrandStatus(`Hazır • Marka: ${BRANDS.length}`);
    setStatus('Hazır', 'ok');
  }

  updateListTitle();
  applySupplierUi();
}

/* =========================
   ✅ go butonu: hep "Listele"
   ========================= */
async function handleGo() {
  // ✅ Akalın seçiliyken tıklanmasın
  if (ACTIVE_SUPPLIER === SUPPLIERS.AKALIN) {
    applySupplierUi();
    return;
  }
  await generate();
}

if (goBtn) goBtn.onclick = handleGo;

/* =========================
   ✅ ilk yük
   ========================= */
initBrands();
updateListTitle();
applySupplierUi();
