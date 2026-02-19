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
   ✅ UI helpers
   ========================= */
const setBrandStatus = (txt) => {
  const el = $('brandStatus');
  if (el) el.textContent = txt;
};

const setChip = (id, t, cls = '') => {
  const e = $(id);
  if (!e) return;
  e.textContent = t;
  e.title = t;
  e.className = 'chip' + (cls ? ` ${cls}` : '');
};
const setStatus = (t, k = 'ok') => setChip('stChip', t, k);

const ui = { setChip, setStatus };

const showBrandStatusChip = (show) => {
  const el = $('brandStatus');
  if (!el) return;
  el.style.display = show ? '' : 'none';
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
  // fallback
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

  // supplier label değişirse otomatik güncelle
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
   - popup: başlık + link + buton text değişti
   - BUG FIX: input.click() label click handler'a takılıyordu (preventDefault)
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
    // inner ölçümü için önce görünür olmalı
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

      // önce "üstüne" dene, sığmazsa altına al
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

    // inline konumları temizle
    inner.style.position = '';
    inner.style.left = '';
    inner.style.top = '';
    inner.style.visibility = '';
  };

  const openPicker = () => {
    allowPickerOnce = true;
    hide();
    requestAnimationFrame(() => {
      try {
        inp.click();
      } finally {
        setTimeout(() => { allowPickerOnce = false; }, 0);
      }
    });
  };

  // Label tıklanınca: önce popup
  box.addEventListener('click', (e) => {
    if (inp.disabled) return;

    // closeBtn/ESC'den gelen inp.click() event'i burada yakalanıyordu → fix
    if (allowPickerOnce) {
      allowPickerOnce = false;
      return; // dosya penceresi açılsın
    }

    e.preventDefault();
    e.stopPropagation();
    show();
  }, true);

  // ✅ "products.csv Yükle" → popup kapanır ve dosya seçici açılır
  closeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openPicker();
  });

  // ESC → popup kapanır ve dosya seçici açılır
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!isOpen()) return;
    e.preventDefault();
    e.stopPropagation();
    openPicker();
  });

  // ekran boyutu değişince konumu tazele
  addEventListener('resize', () => { if (isOpen()) placeAboveButton(); });
  addEventListener('scroll', () => { if (isOpen()) placeAboveButton(); }, true);
})();

/* =========================
   ✅ Tedarikçi Dropdown (şimdilik işlevsiz)
   ========================= */
(() => {
  const wrap = $('supplierWrap');
  const btn = $('supplierBtn');
  const menu = $('supplierMenu');
  const addBtn = $('supplierAddBtn');

  if (!wrap || !btn || !menu) return;

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

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    toggle();
  });

  addBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    // şimdilik işlevsiz
    close();
  });

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) close();
  });

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
})();

/* =========================
   ✅ Marka seçimi UI
   ========================= */
let BRANDS = [];
let SELECTED = new Set(); // brand.id

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
  void list.offsetWidth; // reflow -> animasyonu tekrar tetiklemek için
  list.classList.add('glow');
  setTimeout(() => list.classList.remove('glow'), 950);
};
$('brandHintBtn')?.addEventListener('click', pulseBrands);

async function initBrands() {
  setBrandStatus('Markalar yükleniyor…');
  try {
    BRANDS = await loadBrands(API_BASE);
    setBrandStatus(`Hazır • Marka: ${BRANDS.length}`);
    renderBrands();
    updateListTitle();
  } catch (e) {
    console.error(e);
    setBrandStatus('Markalar yüklenemedi (API).');
    updateListTitle();
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
      // Dosya yoksa: marka chip'i tekrar görünsün
      showBrandStatusChip(true);
      if (BRANDS?.length) setBrandStatus(`Hazır • Marka: ${BRANDS.length}`);
    } else {
      out.textContent = 'Seçildi'; out.title = f.name;
      // ✅ Dosya seçilince “Hazır • Marka: xx” görünmesin
      showBrandStatusChip(false);
    }
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
  setChip('l2Chip', 'Sescibaba:—');

  abortCtrl = new AbortController();
  setScanState(true);

  try {
    matcher.resetAll();

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

    // L2 marka filtre (Compel taranan markalar)
    const brands = new Set(L1.map(r => normBrand(r[C1.marka] || '')).filter(Boolean));
    const L2 = L2all.filter(r => brands.has(normBrand(r[C2.marka] || '')));

    matcher.loadData({ l1: L1, c1: C1, l2: L2, c2: C2, l2All: L2all });
    matcher.runMatch();
    refresh();

    setStatus('Hazır', 'ok');
    setChip('l2Chip', `Sescibaba:${L2.length}/${L2all.length}`);

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

  // ✅ Liste başlığı tekrar gizlensin
  setListTitleVisible(false);

  // marka seçimleri
  SELECTED.clear();
  renderBrands();

  // dosya input sıfırla
  const f2 = $('f2');
  if (f2) f2.value = '';
  const n2 = $('n2');
  if (n2) { n2.textContent = 'Yükle'; n2.title = 'Yükle'; }

  // ✅ marka chip'i geri gelsin (dosya yok)
  showBrandStatusChip(true);
  if (BRANDS?.length) setBrandStatus(`Hazır • Marka: ${BRANDS.length}`);

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
  setStatus('Hazır', 'ok');
  setChip('l1Chip', 'Compel:-');
  setChip('l2Chip', 'Sescibaba:-');
  setChip('l4Chip', 'Depo:-');
  setChip('sum', 'Toplam 0 • ✓0 • ✕0', 'muted');
  setChip('selChip', 'Seçili 0', 'muted');

  updateListTitle();
}

/* =========================
   ✅ go butonu: Listele ↔ Temizle
   ========================= */
let goMode = 'list';

async function handleGo() {
  if (goMode === 'list') {
    const ok = await generate();
    if (ok) {
      goMode = 'clear';
      if (goBtn) { goBtn.textContent = 'Temizle'; goBtn.title = 'Temizle'; }
    }
  } else {
    resetAll();
    goMode = 'list';
    if (goBtn) { goBtn.textContent = 'Listele'; goBtn.title = 'Listele'; }
  }
}

if (goBtn) goBtn.onclick = handleGo;

/* =========================
   ✅ ilk yük
   ========================= */
initBrands();
updateListTitle();
