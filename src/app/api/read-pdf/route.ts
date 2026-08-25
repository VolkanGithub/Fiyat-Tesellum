import { NextResponse } from 'next/server';
import PDFParser from 'pdf2json';

// ============================================================================
// TYPESCRIPT ZIRHI (ESLint'in kızdığı 'any' hatalarını çözen yapı)
// ============================================================================
interface PDFTextRun {
  T: string;
}

interface PDFText {
  x: number;
  y: number;
  R: PDFTextRun[];
}

interface PDFPage {
  Texts: PDFText[];
}

// Gelen bilinmeyen (unknown) verinin içinden sayfaları güvenle çıkaran fonksiyon
function findPagesInPDFData(obj: unknown): PDFPage[] {
  if (!obj || typeof obj !== 'object') return [];

  const record = obj as Record<string, unknown>;

  if (Array.isArray(record.Pages)) {
    return record.Pages as unknown as PDFPage[];
  }

  for (const key in record) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      const result = findPagesInPDFData(record[key]);
      if (result.length > 0) return result;
    }
  }
  return [];
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'Dosya bulunamadı.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // ============================================================================
    // 1. AŞAMA: SİSTEMİ ÇÖKERTMEYEN GÜVENİLİR PDF OKUYUCU
    // ============================================================================
    const pdfData = await new Promise<unknown>((resolve, reject) => {
      const pdfParser = new PDFParser();
      pdfParser.on("pdfParser_dataError", () => reject(new Error("PDF okuma hatası")));
      pdfParser.on("pdfParser_dataReady", resolve);
      pdfParser.parseBuffer(buffer);
    });

    const pdfPages = findPagesInPDFData(pdfData);
    if (pdfPages.length === 0) throw new Error("Sayfa bulunamadı");

    // ============================================================================
    // 2. AŞAMA: SAYFALARI VE SATIRLARI DÜZENE SOKMA
    // ============================================================================
    const linesMap = new Map<number, { x: number, text: string }[]>();

    pdfPages.forEach((page: PDFPage, pageIndex: number) => {
      if (!page.Texts) return;

      // Kilit Hamle 1: Her sayfaya 2000 piksel mesafe koy ki sayfalar birbirine (Bal ve İncir) karışmasın.
      const pageOffset = pageIndex * 2000;

      page.Texts.forEach((t: PDFText) => {
        if (!t.R || !t.R[0] || !t.R[0].T) return;
        let text = "";
        try { text = decodeURIComponent(t.R[0].T); } catch { text = t.R[0].T; }
        text = text.trim();
        if (!text) return;

        // Kilit Hamle 2: Y eksenindeki mikro kaymaları (0.1 hassasiyetle) tek satırda birleştir.
        const y = Math.round((t.y + pageOffset) * 10) / 10;

        if (!linesMap.has(y)) linesMap.set(y, []);
        linesMap.get(y)!.push({ x: t.x, text });
      });
    });

    const sortedY = Array.from(linesMap.keys()).sort((a, b) => a - b);
    const results = [];
    const parseNumber = (str: string) => parseFloat(str.replace(/\./g, '').replace(',', '.'));

    // ============================================================================
    // 3. AŞAMA: SENİN MATEMATİĞİN (Sondan 3 ve Sondan 2 Kuralı)
    // ============================================================================
    for (const y of sortedY) {
      const rowElements = linesMap.get(y)!;
      // Satır içindeki kelimeleri soldan sağa hizala
      rowElements.sort((a, b) => a.x - b.x);
      const rowText = rowElements.map(e => e.text).join(" ");

      // Kilit Hamle 3: SADECE stok kodu (Örn: 027.0004) ile başlayan satırları oku.
      // Bu sayede VKN, Tarih, "F&W Mutfak" gibi tüm alt ve üst bilgileri çöpe atar.
      if (/^\d{3}\.\d{4}/.test(rowText)) {
        const tokens = rowText.split(/\s+/);
        if (tokens.length < 8) continue; // Yarım kalmış satırları atla

        const stokKodu = tokens[0];

        // Birimi bul (Kg, Lt, Adet vs.)
        let unitIndex = -1;
        for (let i = 1; i < tokens.length; i++) {
          if (/^(Kg|Lt|Adet|Gr|Kutu|Koli|Pk|Bağ|Demet|Şişe|Teneke|Paket)$/i.test(tokens[i])) {
            unitIndex = i;
            break;
          }
        }

        if (unitIndex === -1) continue;

        // Ürün Adı, 1. indexten (stok kodundan sonra) birimden bir önceki indexe kadardır
        const stokAdi = tokens.slice(1, unitIndex - 1).join(" ");
        // Miktar, birimden tam bir önceki sayıdır
        const miktar = parseNumber(tokens[unitIndex - 1]);
        const birim = tokens[unitIndex];

        // ============================================================================
        // ELEKTRAWEB SIKIYÖNETİMİ: Fiyatlar her zaman cümlenin EN SONUNDADIR.
        // ============================================================================
        const oncekiFiyat = parseNumber(tokens[tokens.length - 3]); // Sondan 3. (Son Alış B.Fiyat) - ESKİ FİYAT
        const alisFiyati = parseNumber(tokens[tokens.length - 2]);  // Sondan 2. (Net B.Fiyat) - YENİ FİYAT

        let farkTl = 0;
        let farkYuzde = 0;
        let durum = 'fark_yok';

        if (oncekiFiyat > 0) {
          farkTl = alisFiyati - oncekiFiyat;
          farkYuzde = (farkTl / oncekiFiyat) * 100;

          if (farkTl > 0.01) durum = 'aleyhte_fark'; // ZAMLI (Yeni fiyat büyük)
          else if (farkTl < -0.01) durum = 'lehte_fark'; // UCUZLAMIŞ (Yeni fiyat küçük)
          else durum = 'fark_yok'; // AYNI
        } else {
          durum = 'yeni_urun';
        }

        results.push({
          stokKodu,
          stokAdi,
          miktar,
          birim,
          alisFiyati,
          oncekiFiyat,
          farkTl,
          farkYuzde,
          durum
        });
      }
    }

    if (results.length === 0) {
      return NextResponse.json({ error: "Fatura okunamadı. Lütfen PDF'i kontrol edin." }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: results });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Hata oluştu: ${errorMessage}` }, { status: 500 });
  }
}