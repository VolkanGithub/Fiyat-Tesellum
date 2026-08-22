import { NextResponse } from 'next/server';
import PDFParser from 'pdf2json';

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
  if (Array.isArray(record.Pages)) return record.Pages as unknown as PDFPage[];
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

    const pdfPages = findPagesInPDFData(pdfData);

    if (!pdfPages || pdfPages.length === 0) {
      throw new Error("PDF sayfaları kütüphane tarafından çözümlenemedi.");
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
        } catch (_e) {
          try {
            text = decodeURIComponent(t.R[0].T.replace(/%(?![0-9a-fA-F]{2})/g, "%25"));
          } catch (_e2) {
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
        visualText += lineString + " "; // Satırları birleştirerek tek bir blok oluşturuyoruz
      });
    });

    // ============================================================================
    // 3. AŞAMA: ZIRHLI SPLIT ALGORİTMASI (Tek Satırlık Devasa Metni Parçalama)
    // ============================================================================
    // Stok kodları (Örn: 032.0008) kusursuz bir bıçaktır. Metni bu kodlardan kesiyoruz.
    const parts = visualText.split(/(\d{3}\.\d{4})/);
    const rawItems = [];

    // parts[0] -> Fatura başlıkları ve gereksiz kısımlar
    // parts[1] -> Stok Kodu, parts[2] -> Kalan ürün detayları ve fiyatlar
    for (let i = 1; i < parts.length; i += 2) {
      const stokKodu = parts[i];
      const detayText = parts[i + 1] || "";
      rawItems.push({
        stokKodu: stokKodu,
        rawText: detayText
      });
    }

    // ============================================================================
    // 4. AŞAMA: MATEMATİKSEL FİYAT RADARI
    // ============================================================================
    const results = [];
    const parseNumber = (str: string) => parseFloat(str.replace(/\./g, '').replace(',', '.'));

    for (const item of rawItems) {
      const unitMatch = item.rawText.match(/(.*?)\s+(Kg|Lt|Adet|Gr|Kutu|Koli|Pk|Bağ|Demet|Porsiyon|Şişe|Teneke)\s+(.*)/i);

      if (!unitMatch) {
        results.push({
          stokKodu: item.stokKodu,
          stokAdi: item.rawText.substring(0, 30).trim() + "...",
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

      if (nums.length < 3) {
        continue;
      }

      const netFiyat = nums[0]; // İlk sayı daima yeni alınan birim fiyatıdır
      const miktar = nums[1];   // İkinci sayı daima alınan toplam miktardır
      const expectedToplam = netFiyat * miktar;
      let oncekiFiyat: number | null = null;

      // Beklenen Matrahı (Toplam Tutarı) dizide arayıp buluyoruz. 
      // Sağındaki ilk sayı bizim "Son Alış Fiyatı"mızdır.
      for (let j = 2; j < nums.length; j++) {
        if (Math.abs(nums[j] - expectedToplam) < 2.0) {
          if (j + 1 < nums.length) {
            oncekiFiyat = nums[j + 1];
            if (oncekiFiyat === 0) oncekiFiyat = null;
          }
          break;
        }
      }

      // Matematiksel radar bir şekilde ıskalarsa, genelde sondan 2. veya 3. sayı eski fiyattır. (Yedek Plan)
      if (oncekiFiyat === null && nums.length >= 7) {
        oncekiFiyat = nums[6];
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

    if (results.length === 0) {
      return NextResponse.json({
        error: "Eşleşme yok. PDF formatı farklı algılandı."
      }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: results });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("PDF okuma hatası:", errorMessage);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}