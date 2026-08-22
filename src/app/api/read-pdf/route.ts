import { NextResponse } from 'next/server';
import PDFParser from 'pdf2json';

// ============================================================================
// TYPESCRIPT ZIRHI
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

// Akıllı Radar: Kütüphane Pages dizisini nereye saklarsa saklasın, bulup çıkarır.
function findPagesInPDFData(obj: unknown): PDFPage[] | null {
  if (!obj || typeof obj !== 'object') return null;

  const record = obj as Record<string, unknown>;

  // Eğer bulunduğumuz dizinde Pages varsa onu döndür
  if (Array.isArray(record.Pages)) {
    return record.Pages as unknown as PDFPage[];
  }

  // Yoksa, objenin içindeki tüm alt klasörlere (özelliklere) girip aramaya devam et
  for (const key in record) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      const result = findPagesInPDFData(record[key]);
      if (result) return result;
    }
  }
  return null;
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
    // 1. AŞAMA: JSON KOORDİNAT MODU
    // ============================================================================
    const pdfData = await new Promise<unknown>((resolve, reject) => {
      const pdfParser = new PDFParser();

      pdfParser.on("pdfParser_dataError", (errData: unknown) => {
        const errorMsg = typeof errData === 'object' && errData !== null && 'parserError' in errData
          ? String((errData as Record<string, unknown>).parserError)
          : "Bilinmeyen PDF okuma hatası";
        reject(new Error(errorMsg));
      });

      pdfParser.on("pdfParser_dataReady", (data: unknown) => resolve(data));

      pdfParser.parseBuffer(buffer);
    });

    // ============================================================================
    // 2. AŞAMA: İNSAN GÖZÜ GİBİ OKUMA (Görsel İnşa Algoritması)
    // ============================================================================

    // Tahmin yürütmek yok. Radar ile Pages dizisini buluyoruz.
    const pdfPages = findPagesInPDFData(pdfData);

    if (!pdfPages || pdfPages.length === 0) {
      // Eğer radar da bulamazsa, kütüphanenin ne saçmaladığını tam olarak görelim
      const availableKeys = pdfData && typeof pdfData === 'object' ? Object.keys(pdfData).join(', ') : 'Boş Obje';
      throw new Error(`PDF sayfaları bulunamadı! Kütüphanenin verdiği veri yapısı: [${availableKeys}]`);
    }

    let visualText = "";

    pdfPages.forEach((page: PDFPage) => {
      const lines: Record<string, { x: number, text: string }[]> = {};

      if (!page.Texts) return;

      page.Texts.forEach((t: PDFText) => {
        if (!t.R || !t.R[0] || !t.R[0].T) return;

        let text = "";
        try {
          // Önce normal çevirmeyi dene
          text = decodeURIComponent(t.R[0].T);
        } catch (_e) {
          // Eğer % işareti yüzünden URI Malformed hatası verirse, % işaretini izole edip tekrar dene
          try {
            text = decodeURIComponent(t.R[0].T.replace(/%(?![0-9a-fA-F]{2})/g, "%25"));
          } catch (_e2) {
            // Yine de çökerse, ham halini bırak ama sistemi durdurma
            text = t.R[0].T;
          }
        }

        text = text.trim();
        if (!text) return;

        const y = (Math.round(t.y * 10) / 10).toFixed(1);
        if (!lines[y]) lines[y] = [];

        lines[y].push({ x: t.x, text });
      });

      const yKeys = Object.keys(lines).map(parseFloat).sort((a, b) => a - b);

      yKeys.forEach(y => {
        const yStr = y.toFixed(1);
        lines[yStr].sort((a, b) => a.x - b.x);

        const lineString = lines[yStr].map((item: { x: number, text: string }) => item.text).join(" ");
        visualText += lineString + "\n";
      });
    });

    // ============================================================================
    // 3. AŞAMA: ÜRÜN BLOKLARINI AYIRMA
    // ============================================================================
    const rawLines = visualText.split('\n');
    const rawItems = [];
    let currentItem = null;

    for (const line of rawLines) {
      const trimLine = line.trim();
      if (!trimLine) continue;

      if (trimLine.includes("Hesap Kodu") || trimLine.includes("Oluşturan")) {
        if (currentItem) rawItems.push(currentItem);
        break;
      }

      const stockMatch = trimLine.match(/^(\d{3}\.\d{4})\s+(.*)/);

      if (stockMatch) {
        if (currentItem) rawItems.push(currentItem);
        currentItem = {
          stokKodu: stockMatch[1],
          rawText: stockMatch[2] + " "
        };
      } else if (currentItem) {
        currentItem.rawText += trimLine + " ";
      }
    }
    if (currentItem) rawItems.push(currentItem);

    // ============================================================================
    // 4. AŞAMA: MATEMATİKSEL FİYAT ÇÖZÜCÜ VE ZAM KONTROLÜ
    // ============================================================================
    const results = [];
    const parseNumber = (str: string) => parseFloat(str.replace(/\./g, '').replace(',', '.'));

    for (const item of rawItems) {
      const unitMatch = item.rawText.match(/(.*?)\s+(\d+(?:\.\d+)?(?:,\d+)?)\s+(Kg|Lt|Adet|Gr|Kutu|Koli|Pk|Bağ|Demet)(.*)/i);

      if (!unitMatch) {
        results.push({
          stokKodu: item.stokKodu,
          stokAdi: item.rawText.trim(),
          miktar: 0,
          birim: "?",
          alisFiyati: 0,
          oncekiFiyat: 0,
          farkTl: 0,
          farkYuzde: 0,
          durum: 'eksik_veri'
        });
        continue;
      }

      const stokAdi = unitMatch[1].trim();
      const miktar = parseNumber(unitMatch[2]);
      const birim = unitMatch[3];
      const numbersPart = unitMatch[4].trim();

      const numTokens = numbersPart.split(/\s+/).filter(s => /^[\d\.,]+$/.test(s));
      const nums = numTokens.map(parseNumber);

      let netFiyat = 0;
      let oncekiFiyat: number | null = null;
      let foundByMath = false;

      for (let i = nums.length - 2; i >= 0; i--) {
        const candNet = nums[i];
        const candTotal = nums[i + 1];

        if (candNet > 0 && Math.abs((candNet * miktar) - candTotal) < 2.0) {
          netFiyat = candNet;

          if (i > 0) {
            oncekiFiyat = nums[i - 1];
            if ([0, 1, 8, 10, 18, 20].includes(oncekiFiyat)) {
              oncekiFiyat = null;
            }
          }
          foundByMath = true;
          break;
        }
      }

      if (!foundByMath && nums.length >= 7) {
        netFiyat = nums[nums.length - 2];
        oncekiFiyat = nums.length >= 8 ? nums[nums.length - 3] : null;
      }

      let farkTl = 0;
      let farkYuzde = 0;
      let durum = 'fark_yok';

      if (oncekiFiyat !== null && oncekiFiyat > 0) {
        farkTl = netFiyat - oncekiFiyat;
        farkYuzde = (farkTl / oncekiFiyat) * 100;

        if (farkTl > 0.01) durum = 'aleyhte_fark';
        else if (farkTl < -0.01) durum = 'lehte_fark';
        else durum = 'fark_yok';
      } else {
        durum = 'yeni_urun';
      }

      results.push({
        stokKodu: item.stokKodu,
        stokAdi,
        miktar,
        birim,
        alisFiyati: netFiyat,
        oncekiFiyat,
        farkTl,
        farkYuzde,
        durum
      });
    }

    return NextResponse.json({ success: true, data: results });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("PDF okuma hatası:", errorMessage);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}