// js/app.js
import { TR, esc, parseDelimited, pickColumn, downloadBlob, toCSV, readFileText, T } from './utils.js';
import { loadBrands, scanCompel } from './api.js';
import { createMatcher, normBrand, COLS } from './match.js';
import { createDepot } from './depot.js';
import { createRenderer } from './render.js';

const $ = id => document.getElementById(id);

const API_BASE = "https://robot-workstation.tvkapora.workers.dev";

/* =========================
   Supplier state
   ========================= */
const SUPPLIERS = { COMPEL: 'Compel', AKALIN: 'Akalın' };
let ACTIVE_SUPPLIER = SUPPLIERS.COMPEL;
let COMPEL_BRANDS_CACHE = null;

// ✅ Compel marka seti (normalize) — Depo eşleşmeyenleri filtrelemek için
let COMPEL_BRANDS_NORM = new Set();

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
   Guided pulse (2->3->4->5)
   ========================= */
let guideStep = 'brand'; // brand -> tsoft -> aide -> list -> done

const GUIDE_DUR = {
  brand: 1500,
  tsoft: 1250,
  aide: 1050,
  list: 900
};

const clearGuidePulse = () => {
  const ids = ['brandHintBtn', 'sescBox', 'depoBtn', 'go'];
  for (const id of ids) {
    const el = $(id);
    if (!el) continue;
    el.classList.remove('guidePulse');
    el.style.removeProperty('--guideDur');
  }
};

const setGuideStep = (s) => {
  guideStep = s || 'done';
  updateGuideUI();
};

const updateGuideUI = () => {
  clearGuidePulse();
  if (ACTIVE_SUPPLIER === SUPPLIERS.AKALIN) return;
  if (guideStep === 'done') return;

  const dur = GUIDE_DUR[guideStep] || 1200;
  const apply = (el) => {
    if (!el) return;
    el.style.setProperty('--guideDur', `${dur}ms`);
    el.classList.add('guidePulse');
  };

  if (guideStep === 'brand') apply($('brandHintBtn'));
  else if (guideStep === 'tsoft') apply($('sescBox'));
  else if (guideStep === 'aide') apply($('depoBtn'));
  else if (guideStep === 'list') apply($('go'));
};

/* =========================
   UI helpers
   ========================= */
const setChip = (id, t, cls = '') => {
  const e = $(id);
  if (!e) return;
  const txt = String(t ?? '');
  e.textContent = txt;
  e.title = txt;
  e.className = 'chip' + (cls ? ` ${cls}` : '');
};

const setStatus = (t, k = 'ok') => {
  const st = $('stChip');
  if (!st) return;

  const msg = String(t ?? '').trim();
  if (!msg || msg.toLocaleLowerCase(TR) === 'hazır') {
    st.style.display = 'none';
    st.textContent = '';
    st.title = '';
    st.className = 'chip ok';
    return;
  }

  st.style.display = '';
  setChip('stChip', msg, k);
};

const ui = { setChip, setStatus };

const INFO_HIDE_IDS = ['brandStatus', 'l1Chip', 'l2Chip', 'l4Chip', 'sum'];

/* =========================
   Brand + selection state
   ========================= */
let BRANDS = [];
let SELECTED = new Set();
let brandPrefix = 'Hazır';

/* ✅ Depo karşılaştırması için:
   Compel'e SADECE (EAN veya WS/KOD) ile eşleşmiş T-Soft kayıtlarının sup kodları (marka bazlı) */
let TSOFT_OK_SUP_BY_BRAND = new Map();

/* ✅ seçilen markayı grup olarak genişlet */
function expandSelectedBrandsForScan() {
  const selected = BRANDS.filter(x => SELECTED.has(x.id));
  const canonSet = new Set(selected.map(b => normBrand(b.name || '')).filter(Boolean));
  if (!canonSet.size) return selected;

  const out = [];
  const seen = new Set();
  for (const b of BRANDS) {
    const cn = normBrand(b?.name || '');
    if (!cn || !canonSet.has(cn)) continue;
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    out.push(b);
  }
  return out;
}

const codeNorm = (s) =>
  (s ?? '').toString()
    .replace(/\u00A0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleUpperCase(TR);

const codeAlt = (n) => {
  const k = codeNorm(n);
  if (!k) return '';
  if (!/^[0-9]+$/.test(k)) return '';
  return k.replace(/^0+(?=\d)/, '');
};

/* ✅ brand chip */
const updateBrandChip = () => {
  const el = $('brandStatus');
  if (!el) return;
  if (ACTIVE_SUPPLIER === SUPPLIERS.AKALIN) return;

  const total = BRANDS?.length ?? 0;
  const sel = SELECTED?.size ?? 0;
  el.textContent = `${brandPrefix} • Marka: ${total}/${sel}`;
  el.title = el.textContent;
};

/* =========================
   Liste başlığı
   ========================= */
let listTitleEl = null;
let listSepEl = null;
let lastListedTitle = '';
let hasEverListed = false;

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
  if (!maincol || listTitleEl) return;

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

  listTitleEl.style.display = 'none';
  listSepEl.style.display = 'none';
};

const setListTitleVisible = (show) => {
  ensureListHeader();
  if (listTitleEl) listTitleEl.style.display = show ? '' : 'none';
  if (listSepEl) listSepEl.style.display = show ? '' : 'none';
};

const lockListTitleFromCurrentSelection = () => {
  ensureListHeader();
  lastListedTitle = buildListTitle();
  if (listTitleEl) listTitleEl.textContent = lastListedTitle;
};

/* =========================
   Supplier UI
   ========================= */
let goMode = 'list'; // 'list' | 'clear'

const setGoMode = (mode) => {
  goMode = mode;
  const goBtn = $('go');
  if (!goBtn) return;
  if (mode === 'clear') {
    goBtn.textContent = 'Temizle';
    goBtn.title = 'Temizle';
  } else {
    goBtn.textContent = 'Listele';
    goBtn.title = 'Listele';
  }
};

const clearOnlyLists = () => {
  const t1 = $('t1'), t2 = $('t2');
  if (t1) t1.innerHTML = '';
  if (t2) t2.innerHTML = '';
  const sec = $('unmatchedSection');
  if (sec) sec.style.display = 'none';

  setListTitleVisible(false);

  const dl1 = $('dl1');
  if (dl1) dl1.disabled = true;

  setChip('sum', '✓0 • ✕0', 'muted');
};

const applySupplierUi = () => {
  const goBtn = $('go');
  if (goBtn) {
    if (ACTIVE_SUPPLIER === SUPPLIERS.AKALIN) {
      goBtn.classList.add('wip');
      goBtn.title = 'Yapım Aşamasında';
    } else {
      goBtn.classList.remove('wip');
    }
  }

  if (ACTIVE_SUPPLIER === SUPPLIERS.AKALIN) {
    for (const id of INFO_HIDE_IDS) {
      const el = $(id);
      if (el) el.style.display = 'none';
    }
    setStatus('Tedarikçi Akalın entegre edilmedi. Lütfen farklı bir tedarikçi seçin.', 'bad');
  } else {
    for (const id of INFO_HIDE_IDS) {
      const el = $(id);
      if (el) el.style.display = '';
    }
    setStatus('Hazır', 'ok');
    updateBrandChip();
  }

  updateGuideUI();
};

/* =========================
   T-Soft popover
   ========================= */
(() => {
  const box = $('sescBox');
  const inp = $('f2');
  const modal = $('tsoftModal');
  const inner = $('tsoftInner');
  const pickBtn = $('tsoftClose');
  const dismissBtn = $('tsoftDismiss');
  if (!box || !inp || !modal || !inner || !pickBtn || !dismissBtn) return;

  let allowPickerOnce = false;
  const isOpen = () => modal.style.display === 'block';

  const placePopover = () => {
    inner.style.position = 'fixed';
    inner.style.left = '12px';
    inner.style.top = '12px';
    inner.style.visibility = 'hidden';

    requestAnimationFrame(() => {
      const a = box.getBoundingClientRect();
      const r = inner.getBoundingClientRect();
      const root = getComputedStyle(document.documentElement);
      const M = parseFloat(root.getPropertyValue('--popM')) || 12;
      const G = parseFloat(root.getPropertyValue('--popGap')) || 10;

      let left = a.left;
      left = Math.max(M, Math.min(left, window.innerWidth - r.width - M));

      let top = a.top - r.height - G;
      if (top < M) top = a.bottom + G;
      top = Math.max(M, Math.min(top, window.innerHeight - r.height - M));

      inner.style.left = left + 'px';
      inner.style.top = top + 'px';
      inner.style.visibility = 'visible';
    });
  };

  const show = () => {
    modal.style.display = 'block';
    modal.setAttribute('aria-hidden', 'false');
    placePopover();
    setTimeout(() => pickBtn.focus(), 0);
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
    if (allowPickerOnce) { allowPickerOnce = false; return; }
    e.preventDefault();
    e.stopPropagation();
    show();
  }, true);

  pickBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openPicker();
  });

  dismissBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    hide();
  });

  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!isOpen()) return;
    e.preventDefault();
    e.stopPropagation();
    openPicker();
  });

  addEventListener('resize', () => { if (isOpen()) placePopover(); });
  addEventListener('scroll', () => { if (isOpen()) placePopover(); }, true);
})();

/* =========================
   Supplier Dropdown
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

    if (name === SUPPLIERS.AKALIN) {
      brandPrefix = 'Akalın';
      BRANDS = AKALIN_BRAND_NAMES.map((nm, i) => ({
        id: i + 1,
        slug: String(nm).toLocaleLowerCase(TR).replace(/\s+/g, '-'),
        name: nm,
        count: '—'
      }));
    } else {
      brandPrefix = 'Hazır';
      if (COMPEL_BRANDS_CACHE?.length) {
        BRANDS = COMPEL_BRANDS_CACHE;
      } else {
        await initBrands();
      }
    }

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

  addBtn?.addEventListener('click', (e) => { e.preventDefault(); close(); });

  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  paintMenu();
})();

/* =========================
   Marka seçimi UI
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

  updateBrandChip();

  if (!hasEverListed) {
    if (SELECTED.size > 0) setGuideStep('tsoft');
    else setGuideStep('brand');
  }

  applySupplierUi();
};

const toggleBrand = (id, el) => {
  if (SELECTED.has(id)) { SELECTED.delete(id); el.classList.remove('sel'); }
  else { SELECTED.add(id); el.classList.add('sel'); }

  updateBrandChip();

  if (!hasEverListed) {
    if (SELECTED.size > 0) setGuideStep('tsoft');
    else setGuideStep('brand');
  }

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
  brandPrefix = 'Hazır';
  const brandEl = $('brandStatus');
  if (brandEl) {
    brandEl.textContent = 'Markalar yükleniyor…';
    brandEl.title = brandEl.textContent;
  }

  try {
    const data = await loadBrands(API_BASE);
    COMPEL_BRANDS_CACHE = data;

    if (ACTIVE_SUPPLIER === SUPPLIERS.COMPEL) {
      BRANDS = data;
    }
  } catch (e) {
    console.error(e);
    if (ACTIVE_SUPPLIER === SUPPLIERS.COMPEL) {
      const brandEl2 = $('brandStatus');
      if (brandEl2) {
        brandEl2.textContent = 'Markalar yüklenemedi (API).';
        brandEl2.title = brandEl2.textContent;
      }
    }
  } finally {
    renderBrands();
    applySupplierUi();
  }
}

/* =========================
   Depo + Matcher + Renderer
   ========================= */
const depot = createDepot({
  ui,
  normBrand,
  onDepotLoaded: () => {
    if (matcher.hasData()) {
      matcher.runMatch();
      refresh();
    }

    if (!hasEverListed) {
      if (guideStep === 'aide' && depot.isReady()) setGuideStep('list');
    }

    applySupplierUi();
  }
});

const matcher = createMatcher({
  getDepotAgg: () => depot.agg,
  isDepotReady: () => depot.isReady()
});

const renderer = createRenderer({ ui });

/* ✅ Depo karşılaştırması için:
   TSOFT_OK_SUP_BY_BRAND = sadece Compel'e (EAN veya WS/KOD) ile eşleşmiş T-Soft sup kodları */
function rebuildTsoftOkSupByBrand() {
  TSOFT_OK_SUP_BY_BRAND = new Map();

  const { R } = matcher.getResults();
  for (const row of (R || [])) {
    if (!row?._m) continue;
    if (row._how !== 'EAN' && row._how !== 'KOD') continue;

    const br = row._bn || normBrand(row["Marka"] || '');
    const sup = T(row["Ürün Kodu (T-Soft)"] || '');
    if (!br || !sup) continue;

    if (!TSOFT_OK_SUP_BY_BRAND.has(br)) TSOFT_OK_SUP_BY_BRAND.set(br, new Set());
    const set = TSOFT_OK_SUP_BY_BRAND.get(br);

    const k = codeNorm(sup);
    if (k) set.add(k);
    const a = codeAlt(k);
    if (a && a !== k) set.add(a);
  }
}

/* ✅ Eşleşmeyenler tablosu:
   aynı MARKA içinde (Compel / T-Soft / Depo) sütunlarını satır satır "zip"le */
function buildUnifiedUnmatched({ Uc, Ut, Ud }) {
  const g = new Map(); // brNorm -> { brandDisp, c:[], t:[], d:[] }

  const getGrp = (brNorm, brandDisp) => {
    const k = String(brNorm || '').trim();
    if (!k) return null;
    if (!g.has(k)) g.set(k, { brNorm: k, brandDisp: brandDisp || k, c: [], t: [], d: [] });
    const grp = g.get(k);
    if (brandDisp && (!grp.brandDisp || grp.brandDisp === grp.brNorm)) grp.brandDisp = brandDisp;
    return grp;
  };

  // 1) Compel unmatched
  for (const r of (Uc || [])) {
    const bDisp = String(r["Marka"] || '').trim();
    const bNorm = normBrand(bDisp || r._bn || '');
    const grp = getGrp(bNorm, bDisp);
    if (!grp) continue;
    const nm = String(r["Ürün Adı (Compel)"] || '').trim();
    if (!nm) continue;
    grp.c.push({
      name: nm,
      link: r._clink || ''
    });
  }

  // 2) T-Soft unmatched  ✅ aktif bilgisini de taşı
  for (const r of (Ut || [])) {
    const bDisp = String(r["Marka"] || '').trim();
    const bNorm = normBrand(r._bn || bDisp || '');
    const grp = getGrp(bNorm, bDisp);
    if (!grp) continue;
    const nm = String(r["T-Soft Ürün Adı"] || '').trim();
    if (!nm) continue;
    grp.t.push({
      name: nm,
      link: r._seo || '',
      aktif: (r._aktif === true ? true : (r._aktif === false ? false : null))
    });
  }

  // 3) Depo unmatched  ✅ stok bilgisini de taşı
  for (const r of (Ud || [])) {
    const bDisp = String(r["Marka"] || '').trim();
    const bNorm = normBrand(r._bn || bDisp || '');
    const grp = getGrp(bNorm, bDisp);
    if (!grp) continue;
    const nm = String(r["Depo Ürün Adı"] || '').trim();
    if (!nm) continue;
    grp.d.push({
      name: nm,
      num: Number(r._dnum ?? 0)
    });
  }

  // Sort brands (alphabetic) + each list
  const brandArr = [...g.values()].sort((a, b) =>
    String(a.brandDisp || '').localeCompare(String(b.brandDisp || ''), 'tr', { sensitivity: 'base' })
  );

  for (const grp of brandArr) {
    grp.c.sort((a, b) => String(a.name).localeCompare(String(b.name), 'tr', { sensitivity: 'base' }));
    grp.t.sort((a, b) => String(a.name).localeCompare(String(b.name), 'tr', { sensitivity: 'base' }));
    grp.d.sort((a, b) => String(a.name).localeCompare(String(b.name), 'tr', { sensitivity: 'base' }));
  }

  // Zip rows
  const out = [];
  for (const grp of brandArr) {
    const n = Math.max(grp.c.length, grp.t.length, grp.d.length);
    for (let i = 0; i < n; i++) {
      const c = grp.c[i] || null;
      const t = grp.t[i] || null;
      const d = grp.d[i] || null;

      out.push({
        "Sıra": "",
        "Marka": grp.brandDisp || grp.brNorm,
        "Compel Ürün Adı": c ? c.name : "",
        "T-Soft Ürün Adı": t ? t.name : "",
        "Depo Ürün Adı": d ? d.name : "",
        _taktif: (t ? t.aktif : null),             // ✅ render.js bunu kullanacak
        _dstok: (d ? (Number.isFinite(d.num) ? d.num : 0) : null),
        _clink: c?.link || "",
        _seo: t?.link || ""
      });
    }
  }

  // Sıra 1..N
  for (let i = 0; i < out.length; i++) out[i]["Sıra"] = String(i + 1);
  return out;
}

function refresh() {
  rebuildTsoftOkSupByBrand();

  const { R, U, UT } = matcher.getResults();

  const Ud = depot.isReady()
    ? depot.unmatchedRows({
        brandsNormSet: COMPEL_BRANDS_NORM,
        tsoftSupByBrand: TSOFT_OK_SUP_BY_BRAND
      })
    : [];

  const Ux = buildUnifiedUnmatched({ Uc: U, Ut: UT, Ud });

  renderer.render(R, Ux, depot.isReady());
  applySupplierUi();
}

/* =========================
   T-Soft file label
   ========================= */
const bind = (inId, outId, empty) => {
  const inp = $(inId), out = $(outId); if (!inp || !out) return;
  const upd = () => {
    const f = inp.files?.[0];
    if (!f) { out.textContent = empty; out.title = empty; }
    else { out.textContent = 'Seçildi'; out.title = f.name; }

    if (!hasEverListed) {
      if (SELECTED.size === 0) setGuideStep('brand');
      else if (!f) setGuideStep('tsoft');
      else if (guideStep === 'tsoft') setGuideStep('aide');
      else if (guideStep === 'brand') setGuideStep('tsoft');
    }

    applySupplierUi();
  };
  inp.addEventListener('change', upd); upd();
};
bind('f2', 'n2', 'Yükle');

/* =========================
   Scan state
   ========================= */
let abortCtrl = null;
const goBtn = $('go');

const setScanState = (on) => {
  if (goBtn) goBtn.disabled = on;
  $('f2') && ($('f2').disabled = on);
  $('depoBtn') && ($('depoBtn').disabled = on);
};

/* =========================
   Generate (Listele)
   ========================= */
async function generate() {
  const file = $('f2')?.files?.[0];
  if (!file) { alert('Lütfen T-Soft Stok CSV seç.'); return false; }

  setStatus('Okunuyor…', 'unk');
  setChip('l1Chip', 'Compel:—');
  setChip('l2Chip', 'T-Soft:—');

  abortCtrl = new AbortController();
  setScanState(true);

  try {
    clearOnlyLists();
    matcher.resetAll();

    // reset maps/sets
    TSOFT_OK_SUP_BY_BRAND = new Map();
    COMPEL_BRANDS_NORM = new Set();

    const selectedBrands = expandSelectedBrandsForScan();

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
            setStatus(`Taranıyor: ${m.brand || ''} (${m.page || 0}/${m.pages || 0})`, 'unk');
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
          }
        }
      });
      return rows;
    })();

    const [t2txt, L1] = await Promise.all([t2Promise, scanPromise]);
    setChip('l1Chip', `Compel:${L1.length}`);

    const p2 = parseDelimited(t2txt);
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
      seo: pickColumn(s2, ['SEO Link', 'Seo Link', 'SEO', 'Seo']),
      // ✅ yeni (opsiyonel): Aktif sütunu
      aktif: pickColumn(s2, ['Aktif', 'AKTIF', 'Active', 'ACTIVE'])
    };

    const miss = ['ws','sup','barkod','stok','marka','urunAdi','seo'].filter(k => !C2[k]);
    if (miss.length) {
      setStatus('Sütun eksik', 'bad');
      console.warn('L2 missing', miss);
      alert('T-Soft CSV sütunları eksik. Konsola bak.');
      return false;
    }

    const L2all = p2.rows;

    // ✅ Compel markaları (normalize set)
    COMPEL_BRANDS_NORM = new Set(L1.map(r => normBrand(r[C1.marka] || '')).filter(Boolean));

    // ✅ L2: sadece Compel markalarıyla eşleşen markalar
    const L2 = L2all.filter(r => COMPEL_BRANDS_NORM.has(normBrand(r[C2.marka] || '')));

    matcher.loadData({ l1: L1, c1: C1, l2: L2, c2: C2, l2All: L2all });
    matcher.runMatch();
    refresh();

    setStatus('Hazır', 'ok');
    setChip('l2Chip', `T-Soft:${L2.length}/${L2all.length}`);

    lockListTitleFromCurrentSelection();
    setListTitleVisible(true);

    return true;
  } catch (e) {
    console.error(e);
    setStatus(String(e?.message || 'Hata (konsol)'), 'bad');
    alert(e?.message || String(e));
    return false;
  } finally {
    abortCtrl = null;
    setScanState(false);
    applySupplierUi();
  }
}

/* =========================
   CSV output
   ========================= */
$('dl1')?.addEventListener('click', () => {
  const { R } = matcher.getResults();
  const clean = (R || []).map(r => Object.fromEntries(COLS.map(c => [c, r[c]])));
  downloadBlob('sonuc-eslestirme.csv', new Blob([toCSV(clean, COLS)], { type: 'text/csv;charset=utf-8' }));
});

/* =========================
   Tam reset
   ========================= */
function resetAll() {
  try { abortCtrl?.abort?.(); } catch {}
  abortCtrl = null;
  setScanState(false);

  hasEverListed = false;
  setGoMode('list');

  lastListedTitle = '';
  setListTitleVisible(false);

  SELECTED.clear();
  renderBrands();

  const f2 = $('f2');
  if (f2) f2.value = '';
  const n2 = $('n2');
  if (n2) { n2.textContent = 'Yükle'; n2.title = 'Yükle'; }

  const wsDl = $('wsCodes'), supDl = $('supCodes');
  if (wsDl) wsDl.innerHTML = '';
  if (supDl) supDl.innerHTML = '';

  TSOFT_OK_SUP_BY_BRAND = new Map();
  COMPEL_BRANDS_NORM = new Set();

  depot.reset();
  matcher.resetAll();

  clearOnlyLists();

  setChip('l1Chip', 'Compel:-');
  setChip('l2Chip', 'T-Soft:-');
  setChip('l4Chip', 'Aide:-');
  setChip('sum', '✓0 • ✕0', 'muted');

  setGuideStep('brand');
  applySupplierUi();
}

/* =========================
   Listele / Temizle davranışı
   ========================= */
async function handleGo() {
  if (ACTIVE_SUPPLIER === SUPPLIERS.AKALIN) { applySupplierUi(); return; }

  if (goMode === 'clear') {
    resetAll();
    return;
  }

  if (!hasEverListed && guideStep === 'list') setGuideStep('done');

  if (!hasEverListed && !SELECTED.size) {
    alert('Lütfen bir marka seçin');
    return;
  }

  const file = $('f2')?.files?.[0];
  if (!file) {
    alert('Lütfen T-Soft Stok CSV seç.');
    return;
  }

  if (!SELECTED.size) {
    clearOnlyLists();
    setGoMode('clear');
    return;
  }

  const ok = await generate();
  if (ok) {
    hasEverListed = true;
    setGoMode('list');
    setGuideStep('done');
  }
}

const goBtn = $('go');
if (goBtn) goBtn.onclick = handleGo;

/* =========================
   İlk yük
   ========================= */
ensureListHeader();
setGoMode('list');
setGuideStep('brand');
initBrands();
applySupplierUi();
