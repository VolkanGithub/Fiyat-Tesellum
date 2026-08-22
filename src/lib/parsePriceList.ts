// ============================================================
//  src/lib/parsePriceList.ts
//  Tedarikçi fiyat listesi Excel'ini okur.
//
//  Miraç'ın Liste B dosyasıyla test edildi:
//    158 kalem / 24 fiyatsız / 0 çakışan
//    SEBZELER 57, MEYVELER 42, YEŞİLLİKLER 47, İTHAL 12
// ============================================================
import * as XLSX from "xlsx";
import { normalizeName, normalizeUnit } from "./normalize";

export type FiyatListesiKalemi = {
  kategori: string | null;
  sira_no: number | null;
  urun_adi: string;
  urun_adi_norm: string;
  birim: string | null;
  birim_norm: string | null;
  birim_fiyat: number | null;
};

export type ListeParseSonucu = {
  kalemler: FiyatListesiKalemi[];
  fiyatsiz: string[];   // listede var ama fiyatı verilmemiş ürünler
  cakisan: string[];    // aynı liste içinde ikinci kez geçen ürünler
  dosyadakiTarih: string | null;
};

const bos = (c: unknown) =>
  c === null || c === undefined || String(c).trim() === "";

/**
 * Fiyat hücresini sayıya çevirir.
 *
 * KRİTİK KURAL: Listede "0" veya "-" yazan ürün BEDAVA değildir,
 * "bu hafta fiyat verilmedi" demektir. Sıfır olarak kaydedersek
 * sistem faturadaki fiyatın tamamını "fazla" sanar ve tedarikçiye
 * tamamen yanlış bir iade talebi gönderirsin.
 */
export function parsePrice(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  let s = String(value).trim();
  if (s === "" || s === "-" || s === "—") return null;

  // "₺1.500,00" -> 1500
  s = s.replace(/[₺\sTLtl]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");

  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Blok yapısını BAŞLIKTAN öğrenir, sütun numarası varsaymaz.
 * "ÜRÜN" yazan her sütun bir blok başlatır; solundaki NO,
 * sağındaki BİRİM ve FİYAT o bloğa aittir.
 *
 * Neden böyle: Liste B'de sayfada yan yana İKİ tablo var.
 * Sabit sütun numarası yazsaydık, tedarikçi tabloyu bir sütun
 * kaydırdığı gün parser sessizce boş sonuç dönerdi.
 */
function bloklariBul(row: unknown[]) {
  const b: { no: number; urun: number; birim: number; fiyat: number }[] = [];
  row.forEach((c, i) => {
    if (normalizeName(c) === "urun") {
      b.push({ no: i - 1, urun: i, birim: i + 1, fiyat: i + 2 });
    }
  });
  return b;
}

export function parsePriceListFile(buf: ArrayBuffer): ListeParseSonucu {
  const wb = XLSX.read(buf, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("Dosyanın ilk sayfası okunamadı.");

  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: null,
    raw: true,
    blankrows: true,
  });

  let bloklar: ReturnType<typeof bloklariBul> = [];
  let kategori: string | null = null;
  let baslikBulundu = false;

  const ham: FiyatListesiKalemi[] = [];
  const fiyatsiz: string[] = [];

  // Dosyanın kendi içindeki tarih (Liste B'de "23.12.2024 - 29.12.2024").
  // Bilgi olarak saklıyoruz ama HESAPTA KULLANMIYORUZ — tedarikçinin
  // şablon başlığı aylarca güncellenmemiş olabiliyor.
  let dosyadakiTarih: string | null = null;

  rows.forEach((row, i) => {
    if (!row || row.every(bos)) return;

    if (i < 6 && dosyadakiTarih === null) {
      for (const c of row) {
        const s = String(c ?? "");
        if (/\d{1,2}[./]\d{1,2}[./]\d{4}/.test(s)) {
          dosyadakiTarih = s.trim();
          break;
        }
      }
    }

    const bulunan = bloklariBul(row);
    if (bulunan.length > 0) {
      bloklar = bulunan;
      baslikBulundu = true;
      return; // başlık satırı, veri değil
    }

    const dolu = row.filter((c) => !bos(c));

    // Kategori başlığı: tek dolu hücre, kısa metin, rakamla başlamıyor.
    // Uzunluk sınırı, dosyanın en altındaki uzun uyarı notunu eler.
    if (dolu.length === 1 && typeof dolu[0] === "string") {
      const metin = (dolu[0] as string).trim();
      if (metin.length <= 40 && !/^\d/.test(metin)) kategori = metin;
      return;
    }

    if (bloklar.length === 0) return;

    for (const b of bloklar) {
      const urun = row[b.urun];
      if (bos(urun)) continue;

      const ad = String(urun).trim();
      if (normalizeName(ad) === "urun") continue;

      const fiyat = parsePrice(row[b.fiyat]);
      const siraHam = Number(row[b.no]);

      ham.push({
        kategori,
        sira_no: Number.isFinite(siraHam) ? siraHam : null,
        urun_adi: ad,
        urun_adi_norm: normalizeName(ad),
        birim: bos(row[b.birim]) ? null : String(row[b.birim]).trim(),
        birim_norm: normalizeUnit(row[b.birim]),
        birim_fiyat: fiyat,
      });

      if (fiyat === null) fiyatsiz.push(ad);
    }
  });

  if (!baslikBulundu) {
    throw new Error(
      'Listede "ÜRÜN" başlıklı bir sütun bulunamadı. Dosya beklenen ' +
      "biçimde değil — ilk sayfada ÜRÜN / BİRİM / FİYAT başlıkları olmalı."
    );
  }

  // Aynı liste içinde aynı ürün iki kez olamaz (veritabanı kısıtı).
  // İlkini tutuyoruz, ikincisini raporluyoruz — sessizce yutmuyoruz.
  const gorulen = new Set<string>();
  const kalemler: FiyatListesiKalemi[] = [];
  const cakisan: string[] = [];

  for (const k of ham) {
    if (gorulen.has(k.urun_adi_norm)) {
      cakisan.push(k.urun_adi);
      continue;
    }
    gorulen.add(k.urun_adi_norm);
    kalemler.push(k);
  }

  return { kalemler, fiyatsiz, cakisan, dosyadakiTarih };
}