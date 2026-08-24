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

function findPagesInPDFData(obj: unknown): PDFPage[] | null {
  if (!obj || typeof obj !== 'object') return null;

  const record = obj as Record<string, unknown>;

  if (Array.isArray(record.Pages)) {
    return record.Pages as unknown as PDFPage[];
  }

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
    const pdfPages = findPagesInPDFData(pdfData);

    if (!pdfPages || pdfPages.length === 0) {
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
          text = decodeURIComponent(t.R[0].T);
        } catch {
          try {
            text = decodeURIComponent(t.R[0].T.replace(/%(?![0-9a-fA-F]{2})/g, "%25"));
          } catch {
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
        currentItem = null;
        continue;
      }

      const stockMatch = trimLine.match(/(\d{3}\.\d{4})\s+(.*)/);

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
      const unitMatch = item.rawText.match(/(.*?)\s+(Kg|Lt|Adet|Gr|Kutu|Koli|Pk|Bağ|Demet)\s+(.*)/i);

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
      const birim = unitMatch[2];
      const numbersPart = unitMatch[3].trim();

      const numTokens = numbersPart.split(/\s+/).filter(s => /^[\d\.,]+$/.test(s));
      const nums = numTokens.map(parseNumber);

      const netFiyat = nums[0] || 0;
      const miktar = nums[1] || 0;
      let oncekiFiyat: number | null = null;

      if (nums.length >= 5) {
        const sonSayi = nums[nums.length - 1];
        const ondanOnceki = nums[nums.length - 2];
        const gercekToplam = netFiyat * miktar;

        if (sonSayi > 0 && Math.abs(sonSayi - gercekToplam) > 2.0 && ![0, 1, 8, 10, 18, 20].includes(sonSayi)) {
          oncekiFiyat = sonSayi;
        } else if (ondanOnceki > 0 && Math.abs(ondanOnceki - gercekToplam) > 2.0 && ![0, 1, 8, 10, 18, 20].includes(ondanOnceki)) {
          oncekiFiyat = ondanOnceki;
        }
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