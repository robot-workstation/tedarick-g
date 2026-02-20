// Worker API çağrıları (brands + scan stream)
export async function loadBrands(API_BASE) {
  const res = await fetch(`${API_BASE}/api/brands`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`API /api/brands hata: ${res.status}`);
  return await res.json();
}

// scan endpoint'i NDJSON (satır satır JSON) stream döndürüyor
export async function scanCompel(API_BASE, chosenBrands, { signal, onMessage } = {}) {
  const res = await fetch(`${API_BASE}/api/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ brands: chosenBrands }),
    signal
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API /api/scan hata: ${res.status}\n${t}`);
  }

  const rd = res.body?.getReader?.();
  if (!rd) throw new Error('Stream yok (reader alınamadı).');

  const dec = new TextDecoder();
  let buf = '';

  while (true) {
    const { value, done } = await rd.read();
    if (done) break;

    buf += dec.decode(value, { stream: true });

    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;

      let msg = null;
      try { msg = JSON.parse(line); } catch { continue; }
      if (onMessage) onMessage(msg);
    }
  }
}
