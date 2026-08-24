export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { degerlendir, manuelSecimUygula } from '@/lib/matchEngine';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const faturaFile = formData.get('fatura') as File | null;
    const teklifFile = formData.get('teklif') as File | null;

    if (!faturaFile || !teklifFile) {
      return NextResponse.json({ error: 'Lütfen hem fatura hem de fiyat listesi dosyasını yükleyin.' }, { status: 400 });
    }

    if (typeof faturaFile === 'string' || typeof teklifFile === 'string' || typeof faturaFile.arrayBuffer !== 'function') {
      return NextResponse.json({ error: 'Dosya formatı tarayıcı tarafından desteklenmiyor. Farklı bir tarayıcıdan deneyin.' }, { status: 400 });
    }

    const faturaBuffer = Buffer.from(await faturaFile.arrayBuffer());
    const teklifBuffer = Buffer.from(await teklifFile.arrayBuffer());

    if (faturaBuffer.length === 0 || teklifBuffer.length === 0) {
      return NextResponse.json({ error: 'Yüklenen dosyalardan biri boş (0 byte) ulaştı. Dosya arka planda Excel\'de açıksa lütfen kapatıp tekrar yükleyin.' }, { status: 400 });
    }

    let faturaWb;
    let teklifWb;

    try {
      faturaWb = XLSX.read(faturaBuffer, { type: 'buffer' });
      teklifWb = XLSX.read(teklifBuffer, { type: 'buffer' });
    } catch {
      return NextResponse.json({ error: 'Excel dosyası okunamadı. Dosya bozuk, şifreli veya desteklenmeyen bir formatta kaydedilmiş olabilir.' }, { status: 400 });
    }

    const faturaSheet = XLSX.utils.sheet_to_json(faturaWb.Sheets[faturaWb.SheetNames[0]], { header: 1 }) as unknown[][];
    const teklifSheet = XLSX.utils.sheet_to_json(teklifWb.Sheets[teklifWb.SheetNames[0]], { header: 1 }) as unknown[][];

    const normalizeBaslik = (s: string) => {
      return s.replace(/İ/g, 'i')
        .replace(/I/g, 'ı')
        .toLowerCase()
        .replace(/[^a-z0-9ğüşıöç\s]/gi, '')
        .trim();
    };

    // ============================================================================
    // 1. FATURA ÜRÜNLERİNİ ÇIKARMA
    // ============================================================================
    const faturaUrunler: { urunAdi: string; miktar: number; birim: string; fiyat: number }[] = [];
    let faturaBaslikSatiri = -1;
    let stokIdx = -1, miktarIdx = -1, birimIdx = -1, fiyatIdx = -1;

    for (let i = 0; i < faturaSheet.length; i++) {
      const row = faturaSheet[i];
      if (!Array.isArray(row)) continue;

      for (let j = 0; j < row.length; j++) {
        if (typeof row[j] === 'string') {
          const normCell = normalizeBaslik(row[j] as string);
          if (normCell.includes('stok')) {
            faturaBaslikSatiri = i;
            stokIdx = j;
            row.forEach((cell, idx) => {
              if (typeof cell === 'string') {
                const lowerCell = normalizeBaslik(cell);
                if (lowerCell.includes('miktar')) miktarIdx = idx;
                else if (lowerCell.includes('birim') && !lowerCell.includes('fiyat')) birimIdx = idx;
                else if (lowerCell.includes('net birim fiyat') || lowerCell.includes('fiyat')) fiyatIdx = idx;
              }
            });
            break;
          }
        }
      }
      if (faturaBaslikSatiri !== -1) break;
    }

    if (faturaBaslikSatiri === -1 || stokIdx === -1 || fiyatIdx === -1) {
      return NextResponse.json({ error: 'Fatura formatı anlaşılamadı. Lütfen standart formattaki faturayı yükleyin.' }, { status: 400 });
    }

    for (let i = faturaBaslikSatiri + 1; i < faturaSheet.length; i++) {
      const row = faturaSheet[i];
      if (!Array.isArray(row) || !row[stokIdx]) continue;

      const urunAdi = String(row[stokIdx]).trim();
      const miktar = Number(row[miktarIdx]) || 1;
      const birim = row[birimIdx] ? String(row[birimIdx]).trim() : "Adet";
      const fiyat = Number(row[fiyatIdx]);

      if (urunAdi && !isNaN(fiyat)) {
        faturaUrunler.push({ urunAdi, miktar, birim, fiyat });
      }
    }

    // ============================================================================
    // 2. TEKLİF LİSTESİ ÇIKARMA 
    // ============================================================================
    const teklifListesi: { urunAdi: string; fiyat: number }[] = [];
    const olasiUrunBasliklari = ["ürün", "urun", "cinsi", "açıklama", "aciklama", "stok", "malzeme", "adı"];
    const olasiFiyatBasliklari = ["fiyat", "tutar", "net", "birim fiyat", "fiyati", "kdv hariç"];

    let teklifBaslikSatiri = -1;
    const haritalanmisSutunlar: { urunIdx: number, fiyatIdx: number }[] = [];

    for (let i = 0; i < Math.min(teklifSheet.length, 30); i++) {
      const row = teklifSheet[i];
      if (!Array.isArray(row)) continue;

      const bulunanUrunSutunlari: number[] = [];
      const bulunanFiyatSutunlari: number[] = [];

      row.forEach((cell, idx) => {
        if (typeof cell === 'string') {
          const hucreDegeri = normalizeBaslik(cell);

          if (olasiUrunBasliklari.some(b => hucreDegeri === b || hucreDegeri.includes(b + " "))) {
            bulunanUrunSutunlari.push(idx);
          }
          if (olasiFiyatBasliklari.some(b => hucreDegeri.includes(b))) {
            bulunanFiyatSutunlari.push(idx);
          }
        }
      });

      if (bulunanUrunSutunlari.length > 0 && bulunanFiyatSutunlari.length > 0) {
        teklifBaslikSatiri = i;

        bulunanUrunSutunlari.forEach(uIdx => {
          const fIdx = bulunanFiyatSutunlari.find(f => f > uIdx);
          if (fIdx !== undefined) {
            haritalanmisSutunlar.push({ urunIdx: uIdx, fiyatIdx: fIdx });
          }
        });
        break;
      }
    }

    if (haritalanmisSutunlar.length === 0) {
      return NextResponse.json({ error: 'Fiyat listesinde (Teklif) "Ürün" ve "Fiyat" sütunları bulunamadı. Lütfen başlıkları kontrol edin.' }, { status: 400 });
    }

    for (let i = teklifBaslikSatiri + 1; i < teklifSheet.length; i++) {
      const row = teklifSheet[i];
      if (!Array.isArray(row)) continue;

      haritalanmisSutunlar.forEach(koordinat => {
        const urunAdiHucre = row[koordinat.urunIdx];
        const fiyatHucre = row[koordinat.fiyatIdx];

        if (typeof urunAdiHucre === 'string' && urunAdiHucre.trim().length > 2) {
          const temizUrunAdi = urunAdiHucre.trim().toUpperCase();

          if (!temizUrunAdi.includes("KÜNYELİDİR") && temizUrunAdi !== "TOPLAM") {
            const fiyat = Number(fiyatHucre);
            if (!isNaN(fiyat) && fiyat > 0) {
              teklifListesi.push({
                urunAdi: temizUrunAdi,
                fiyat: fiyat
              });
            }
          }
        }
      });
    }

    if (teklifListesi.length === 0) {
      return NextResponse.json({ error: 'Fiyat listesinde haritalanan sütunların altı boş. Veri okunamadı.' }, { status: 400 });
    }

    // ============================================================================
    // 3. SUPABASE HAFIZA (ÖĞRENEN SİSTEM) VE ÇÖKME KALKANI
    // ============================================================================
    const hafizaMap = new Map<string, string>();
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      // ZIRH 5: Eğer Vercel'de anahtarlar eksikse Supabase'i atla, uygulamayı ÇÖKERTME!
      if (supabaseUrl && supabaseKey) {
        const supabase = createClient(supabaseUrl, supabaseKey);
        const { data: hafizaVerisi } = await supabase.from('eslesme_hafizasi').select('fatura_urun_adi, teklif_urun_adi');
        if (hafizaVerisi) {
          hafizaVerisi.forEach(row => hafizaMap.set(row.fatura_urun_adi, row.teklif_urun_adi));
        }
      } else {
        console.warn("Supabase anahtarları bulunamadı. Öğrenen hafıza devre dışı bırakıldı, analiz devam ediyor.");
      }
    } catch {
      console.warn("Hafıza çekilirken ağ hatası oluştu, akıllı tahminle devam ediliyor.");
    }

    // ============================================================================
    // 4. BÜYÜK ÇARPIŞMA VE HAFIZA UYGULAMASI
    // ============================================================================
    const sonuclar = faturaUrunler.map(faturaUrun => {
      let sonuc = degerlendir(faturaUrun, teklifListesi);

      const gecmisSecim = hafizaMap.get(faturaUrun.urunAdi);

      if (gecmisSecim) {
        const secilenAday = sonuc.adaylar.find(a => a.teklifUrunAdi === gecmisSecim);
        if (secilenAday) {
          sonuc = manuelSecimUygula(sonuc, secilenAday);
        }
      }
      return sonuc;
    });

    return NextResponse.json({ success: true, data: sonuclar });

  } catch (error: unknown) {
    console.error("Excel Karşılaştırma Hatası:", error);
    const errorMessage = error instanceof Error ? error.message : "Bilinmeyen bir hata oluştu";
    return NextResponse.json({ error: `Hata oluştu: ${errorMessage}. Lütfen dosyayı kontrol edin.` }, { status: 400 });
  }
}