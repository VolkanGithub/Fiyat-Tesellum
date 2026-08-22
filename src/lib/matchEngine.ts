export interface EslesmeAdayi {
  teklifUrunAdi: string;
  teklifFiyat: number;
  skor: number;
}

export interface DenetimSatiri {
  stokKodu?: string;
  faturaUrunAdi: string;
  faturaMiktar: number;
  faturaBirim: string;
  faturaBirimFiyat: number;
  teklifFiyat: number | null;
  eslesenTeklifUrunAdi: string | null;
  farkTl: number;
  farkYuzde: number;
  durum: "tam_eslesme" | "supheli_eslesme" | "eslesme_yok" | "aleyhte_fark" | "lehte_fark" | "fark_yok";
  adaylar: EslesmeAdayi[];
}

export function calculateSimilarity(str1: string, str2: string): number {
  const normalize = (s: string) => s.toLocaleLowerCase('tr-TR').replace(/[^a-z0-9ğüşıöç\s]/gi, '').trim();
  const s1 = normalize(str1);
  const s2 = normalize(str2);

  if (s1 === s2) return 100;
  if (s1.length < 2 || s2.length < 2) return 0;

  const getBigrams = (str: string) => {
    const bigrams = [];
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.push(str.substring(i, i + 2));
    }
    return bigrams;
  };

  const bg1 = getBigrams(s1);
  const bg2 = getBigrams(s2);
  let intersectionSize = 0;

  for (let i = 0; i < bg1.length; i++) {
    for (let j = 0; j < bg2.length; j++) {
      if (bg1[i] === bg2[j]) {
        intersectionSize++;
        bg2[j] = "";
        break;
      }
    }
  }
  return Math.round((2.0 * intersectionSize) / (bg1.length + bg2.length) * 100);
}

export function adaylariBul(faturaUrunAdi: string, teklifListesi: { urunAdi: string, fiyat: number }[]): EslesmeAdayi[] {
  // DÜZELTME 2: ".slice(0, 5)" komutu silindi. 
  // Artık sadece ilk 5'i değil, TÜM teklif listesini skora göre dizip dropdown'a gönderiyoruz.
  return teklifListesi.map(teklif => ({
    teklifUrunAdi: teklif.urunAdi,
    teklifFiyat: teklif.fiyat,
    skor: calculateSimilarity(faturaUrunAdi, teklif.urunAdi)
  })).sort((a, b) => b.skor - a.skor);
}

export function degerlendir(faturaUrun: { urunAdi: string, miktar: number, birim: string, fiyat: number }, teklifListesi: { urunAdi: string, fiyat: number }[]): DenetimSatiri {
  const adaylar = adaylariBul(faturaUrun.urunAdi, teklifListesi);
  const enIyiAday = adaylar[0];

  let durum: DenetimSatiri["durum"] = "eslesme_yok";
  let teklifFiyat = null;
  let eslesenTeklifUrunAdi = null;
  let farkTl = 0;
  let farkYuzde = 0;

  if (enIyiAday) {
    if (enIyiAday.skor >= 85) {
      // TAM EŞLEŞME: Matematiği burada yapıyoruz!
      teklifFiyat = enIyiAday.teklifFiyat;
      eslesenTeklifUrunAdi = enIyiAday.teklifUrunAdi;
      farkTl = faturaUrun.fiyat - teklifFiyat;
      farkYuzde = teklifFiyat > 0 ? (farkTl / teklifFiyat) * 100 : 0;

      if (farkTl > 0.01) durum = "aleyhte_fark";
      else if (farkTl < -0.01) durum = "lehte_fark";
      else durum = "fark_yok";

    } else if (enIyiAday.skor >= 45) {
      durum = "supheli_eslesme";
    }
  }

  return {
    faturaUrunAdi: faturaUrun.urunAdi,
    faturaMiktar: faturaUrun.miktar,
    faturaBirim: faturaUrun.birim,
    faturaBirimFiyat: faturaUrun.fiyat,
    teklifFiyat,
    eslesenTeklifUrunAdi,
    farkTl,
    farkYuzde,
    durum,
    adaylar
  };
}

export function manuelSecimUygula(satir: DenetimSatiri, secilenAday: EslesmeAdayi): DenetimSatiri {
  const farkTl = satir.faturaBirimFiyat - secilenAday.teklifFiyat;
  const farkYuzde = secilenAday.teklifFiyat > 0 ? (farkTl / secilenAday.teklifFiyat) * 100 : 0;

  let yeniDurum: DenetimSatiri["durum"] = "fark_yok";
  if (farkTl > 0.01) yeniDurum = "aleyhte_fark";
  else if (farkTl < -0.01) yeniDurum = "lehte_fark";

  return {
    ...satir,
    eslesenTeklifUrunAdi: secilenAday.teklifUrunAdi,
    teklifFiyat: secilenAday.teklifFiyat,
    farkTl,
    farkYuzde,
    durum: yeniDurum
  };
}