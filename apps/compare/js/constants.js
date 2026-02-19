import { TR } from './utils.js';

export const ALIAS = new Map([
  ['ALLEN & HEATH', 'ALLEN HEATH'],
  ['MARANTZ PROFESSIONAL', 'MARANTZ'],
  ['RUPERT NEVE DESIGNS', 'RUPERT NEVE'],
  ['RØDE', 'RODE'],
  ['RØDE X', 'RODE']
]);

export const bRaw = s => (s ?? '').toString().trim().toLocaleUpperCase(TR).replace(/\s+/g, ' ');
export const B   = s => ALIAS.get(bRaw(s)) || bRaw(s);
export const Bx  = s => bRaw(s);

export const SEO = 'https://www.sescibaba.com/';

export const COLS = [
  "Sıra No", "Marka",
  "Ürün Adı (Compel)", "Ürün Adı (Sescibaba)",
  "Ürün Kodu (Compel)", "Ürün Kodu (Sescibaba)",

  // ✅ Sıralama düzeltildi:
  "Stok (Compel)", "Stok (Depo)", "Stok (Sescibaba)", "Stok Durumu",

  "EAN (Compel)", "EAN (Sescibaba)", "EAN Durumu"
];
