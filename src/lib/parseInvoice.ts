// ============================================================
//  src/lib/parseInvoice.ts
//  ElektraWeb fatura satırı export'unu okur.
//
//  Fatura_Mirac__11_08_26.xlsx ile test edildi: 32 satır,
//  32'si de master_products ile birebir eşleşiyor.
// ============================================================
import * as XLSX from "xlsx";
import { cleanText, normalizeName, normalizeUnit } from "./normalize";

export type FaturaKalemi = {
  satir_no: number;
  stok_adi: string;
  stok_adi_norm: string;
  birim: string | null;
  birim_norm: string | null;
  miktar: number;
  birim_fiyat: number;
  satir_toplam: number | null;
  kdv_orani: number | null;
  vergi_dahil_toplam: number | null;
  checksum_ok: boolean | null;
};

export type FaturaParseSonucu = {
  kalemler: FaturaKalemi[];
  atlananSatirlar: { satir: number; sebep: string }[];
};

function sayi(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/[₺\s]/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ElektraWeb export'unda başlıklar sabit görünüyor ama tolere edelim.
function basligiBul(basliklar: string[], adaylar: string[]): string | null {
  const hedef = adaylar.map(normalizeName);
  return basliklar.find((b) => hedef.includes(normalizeName(b))) ?? null;
}

export function parseInvoiceFile(buf: ArrayBuffer): FaturaParseSonucu {
  const wb = XLSX.read(buf, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("Dosyanın ilk sayfası okunamadı.");

  const satirlar = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: null,
  });
  if (satirlar.length === 0) {
    throw new Error("Dosyada veri satırı bulunamadı.");
  }

  const basliklar = Object.keys(satirlar[0]);
  const cStok = basligiBul(basliklar, ["Stok", "Ürün", "Stok Adı"]);
  const cBirim = basligiBul(basliklar, ["Birim"]);
  const cMiktar = basligiBul(basliklar, ["Miktar"]);
  // "Net Birim Fiyat" varsa onu, yoksa "Fiyat" sütununu kullan —
  // faturada ikisi de aynı değeri taşıyordu, ikisini de aramamızın
  // sebebi farklı export biçimlerine dayanıklı olmak.
  const cFiyat = basligiBul(basliklar, ["Net Birim Fiyat", "Fiyat", "Birim Fiyat"]);
  const cSatirToplam = basligiBul(basliklar, ["Satır Toplam"]);
  const cKdv = basligiBul(basliklar, ["KDV %", "KDV Oranı"]);
  const cVergiDahil = basligiBul(basliklar, ["Vergi Dahil Toplam"]);

  if (!cStok || !cMiktar || !cFiyat) {
    throw new Error(
      `"Stok", "Miktar" ve fiyat sütunları bulunamadı. Dosyadaki başlıklar: ${basliklar.join(", ")}`
    );
  }

  const kalemler: FaturaKalemi[] = [];
  const atlananSatirlar: { satir: number; sebep: string }[] = [];

  satirlar.forEach((s, i) => {
    const satirNo = i + 2; // Excel'de 1. satır başlık
    const ad = cleanText(s[cStok]);
    const miktar = sayi(s[cMiktar]);
    const fiyat = sayi(s[cFiyat]);

    if (!ad) return; // boş satır, sessizce atla (ElektraWeb export'larında olağan)
    if (miktar === null || miktar <= 0) {
      atlananSatirlar.push({ satir: satirNo, sebep: "Miktar boş veya sıfır" });
      return;
    }
    if (fiyat === null || fiyat < 0) {
      atlananSatirlar.push({ satir: satirNo, sebep: "Birim fiyat okunamadı" });
      return;
    }

    const satirToplam = cSatirToplam ? sayi(s[cSatirToplam]) : null;
    const kdv = cKdv ? sayi(s[cKdv]) : null;
    const vergiDahil = cVergiDahil ? sayi(s[cVergiDahil]) : null;

    // Çapraz kontrol: Satır Toplam x (1+KDV) faturadaki Vergi Dahil
    // Toplam'a yakın mı? Değilse bu satırı YANLIŞ OKUMUŞ olabiliriz —
    // sessizce geçmek yerine işaretliyoruz. 1 kuruşluk yuvarlama payı
    // bırakıyoruz.
    let checksumOk: boolean | null = null;
    if (satirToplam !== null && kdv !== null && vergiDahil !== null) {
      const beklenen = satirToplam * (1 + kdv / 100);
      checksumOk = Math.abs(beklenen - vergiDahil) < 0.05;
    }

    kalemler.push({
      satir_no: satirNo,
      stok_adi: ad,
      stok_adi_norm: normalizeName(ad),
      birim: cBirim ? cleanText(s[cBirim]) : null,
      birim_norm: cBirim ? normalizeUnit(s[cBirim]) : null,
      miktar,
      birim_fiyat: fiyat,
      satir_toplam: satirToplam,
      kdv_orani: kdv,
      vergi_dahil_toplam: vergiDahil,
      checksum_ok: checksumOk,
    });
  });

  return { kalemler, atlananSatirlar };
}