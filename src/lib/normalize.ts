// ============================================================
//  src/lib/normalize.ts
//  Veri temizleme yardımcıları.
//  Bu dosya projenin en kritik dosyalarından biri: fatura ile
//  fiyat listesinin eşleşip eşleşmemesi buradaki kurallara bağlı.
// ============================================================

/**
 * Excel'den gelen stok kodunu güvenli metne çevirir.
 *
 * SORUN: Excel "102.0050" kodunu ekranda öyle gösterir ama içeride
 * 102.005 SAYISI olarak saklar. Sondaki sıfırın matematiksel anlamı
 * olmadığı için atılır. Kodu doğrudan metne çevirirsek 88 ürünün
 * kodu bozulur ve eşleştirme sessizce çalışmaz.
 *
 * ÇÖZÜM: Sayıysa her zaman 4 ondalıklı sabit formata zorla.
 *   102.005  -> "102.0050"
 *   120.04   -> "120.0400"
 */
export function normalizeStockCode(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toFixed(4) : null;
  }

  // Bazı export'larda kod zaten metin gelir. Virgüllü ondalık da olabilir.
  const raw = String(value).trim().replace(",", ".");
  if (raw === "") return null;

  // Saf sayısal bir kodsa yine 4 ondalığa sabitle.
  if (/^\d+(\.\d+)?$/.test(raw)) {
    return Number(raw).toFixed(4);
  }

  // Sayısal değilse (ör. "HZM-01") olduğu gibi bırak.
  return raw;
}

// Türkçe harflerin ASCII karşılıkları.
// Dikkat: hem "İ" hem "I" hem "ı" -> "i" oluyor. Bu kasıtlı.
// Amacımız dilbilgisel doğruluk değil, iki metnin aynı ürünü
// gösterip göstermediğini anlamak.
const TR_TO_ASCII: Record<string, string> = {
  İ: "i", I: "i", ı: "i", i: "i",
  Ş: "s", ş: "s",
  Ğ: "g", ğ: "g",
  Ü: "u", ü: "u",
  Ö: "o", ö: "o",
  Ç: "c", ç: "c",
  Â: "a", â: "a",
  Î: "i", î: "i",
  Û: "u", û: "u",
};

/**
 * Ürün ismini eşleştirmeye uygun kanonik forma indirger.
 *
 *   "BİBER  DOLMALIK"        -> "biber dolmalik"
 *   "Domates Salkım 1.Kalite" -> "domates salkim 1 kalite"
 *   " s. domates "            -> "s domates"
 *
 * NOT: Bu işi bilerek veritabanında (SQL) değil uygulamada yapıyoruz.
 * PostgreSQL'in upper()/lower() fonksiyonları sunucunun dil ayarına
 * göre Türkçe i/İ ve ı/I harflerinde farklı davranabilir. Uygulamada
 * yapınca sonuç her ortamda birebir aynı olur.
 */
export function normalizeName(value: unknown): string {
  if (value === null || value === undefined) return "";

  let s = String(value);

  // 1) Türkçe harfleri ASCII'ye indir
  s = s.replace(/[İIıiŞşĞğÜüÖöÇçÂâÎîÛû]/g, (ch) => TR_TO_ASCII[ch] ?? ch);

  // 2) Küçük harfe çevir (artık ASCII olduğu için güvenli)
  s = s.toLowerCase();

  // 3) Harf ve rakam dışındaki her şeyi boşluğa çevir
  s = s.replace(/[^a-z0-9]+/g, " ");

  // 4) Baştaki/sondaki boşlukları at, aradakileri teke indir
  return s.trim().replace(/\s+/g, " ");
}

/**
 * Excel'in tarih sıra numarasını (serial) gerçek tarihe çevirir.
 * Excel, tarihleri 30 Aralık 1899'dan itibaren geçen gün sayısı olarak saklar.
 * Örnek: 46245 -> 11.08.2026
 */
function excelSerialToUTC(serial: number): Date | null {
  if (!Number.isFinite(serial)) return null;
  const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
  const MS_PER_DAY = 86400000;
  return new Date(EXCEL_EPOCH_UTC + Math.floor(serial) * MS_PER_DAY);
}

function formatUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const g = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${g}`;
}

/**
 * Tarihi Postgres DATE formatına (YYYY-MM-DD) çevirir.
 *
 * TEMEL KURAL: new Date(metin) ile TAHMİN ETTİRMİYORUZ.
 * İki sebepten:
 *   1) Excel'den sayı gelirse ("46245") JavaScript onu YIL sanır
 *      ve 46245 yılını üretir. Postgres bunu reddeder.
 *   2) Türkçe "11.08.2026" biçimini JavaScript Amerikan sanır ve
 *      8 Kasım'a çevirir. Bu SESSİZ bir hatadır, kimse fark etmez.
 *
 * Tanıdığımız biçimler dışındaki her şey için null döneriz.
 * Tarihsiz kayıt, yanlış tarihli kayıttan iyidir.
 */
export function normalizeDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;

  let d: Date | null = null;

  // 1) Zaten Date nesnesi (cellDates calistiysa)
  if (value instanceof Date) {
    d = isNaN(value.getTime()) ? null : value;
  }
  // 2) Excel sıra numarası (sayı olarak)
  else if (typeof value === "number") {
    d = excelSerialToUTC(value);
  }
  // 3) Metin
  else {
    const s = String(value).trim();

    // 3a) Sadece rakam -> Excel sıra numarası
    if (/^\d+(\.\d+)?$/.test(s)) {
      d = excelSerialToUTC(Number(s));
    }
    // 3b) ISO: 2026-08-11
    else {
      const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (iso) {
        d = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
      } else {
        // 3c) Türkçe gün-önce: 11.08.2026 / 11-08-2026 / 11/08/2026
        //     Yıl 2 haneliyse (26) 2000'li varsayıyoruz.
        const tr = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
        if (tr) {
          const gun = +tr[1];
          const ay = +tr[2];
          const yilRaw = +tr[3];
          const yil = tr[3].length === 2 ? 2000 + yilRaw : yilRaw;
          d = new Date(Date.UTC(yil, ay - 1, gun));
        }
      }
    }
  }

  if (!d || isNaN(d.getTime())) return null;

  // Akıl sağlığı kontrolü: bu uygulamada 1990-2100 dışı bir tarih
  // her zaman okuma hatasıdır. Sessizce kabul etmiyoruz.
  const yil = d.getUTCFullYear();
  if (yil < 1990 || yil > 2100) return null;

  return formatUTC(d);
}

/** Boş metinleri null'a çevirir. Veritabanında "" yerine NULL tutmak daha temizdir. */
export function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/**
 * "Fatura_Mirac__11_08_26.xlsx" gibi bir dosya adından tarihi çıkarmaya
 * çalışır. Yalnızca GÜN_AY_YIL veya GÜN.AY.YIL biçimini tanır — Excel
 * sıra numarasıyla karışmasın diye ayrı bir fonksiyon.
 * Tanıyamazsa null döner; TAHMİN ETMEZ.
 */
export function tarihFromDosyaAdi(dosyaAdi: string): string | null {
  const temiz = dosyaAdi.replace(/\.[^.]+$/, ""); // uzantıyı at

  // Önce ISO sıralı (YIL-AY-GÜN) dene — 4 haneli yıl her zaman öndedir,
  // bu yüzden karışıklık riski yok. Bunu ATLARSAK, "2026-08-11" gibi bir
  // dosya adı aşağıdaki gün-önce deseniyle "26-08-11" olarak yanlış
  // eşleşip 2011 yılını üretebilir (bunu burada test ederken yakaladım).
  const iso = temiz.match(/(\d{4})[._-](\d{1,2})[._-](\d{1,2})(?!\d)/);
  if (iso) {
    const yil = +iso[1];
    const ay = +iso[2];
    const gun = +iso[3];
    if (ay >= 1 && ay <= 12 && gun >= 1 && gun <= 31) {
      const d = new Date(Date.UTC(yil, ay - 1, gun));
      if (d.getUTCDate() === gun && d.getUTCMonth() === ay - 1) {
        return `${yil}-${String(ay).padStart(2, "0")}-${String(gun).padStart(2, "0")}`;
      }
    }
  }

  // Sonra Türkçe gün-önce (GÜN_AY_YIL) dene.
  const m = temiz.match(/(\d{1,2})[._-](\d{1,2})[._-](\d{2}|\d{4})(?!\d)/);
  if (!m) return null;
  const gun = +m[1];
  const ay = +m[2];
  const yilRaw = +m[3];
  const yil = m[3].length === 2 ? 2000 + yilRaw : yilRaw;
  if (gun < 1 || gun > 31 || ay < 1 || ay > 12) return null;
  const d = new Date(Date.UTC(yil, ay - 1, gun));
  if (d.getUTCDate() !== gun || d.getUTCMonth() !== ay - 1) return null; // 31 Şubat gibi durumları ele
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const gg = String(d.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${gg}`;
}

// Birim yazımları kaynaktan kaynağa değişiyor:
//   Master liste : Kg  / Adet / Lt
//   Miraç listesi: KG  / AD   / ADT / PAKET / PKT / BAĞ
//   Fatura       : Kg  / Adet
// Kıyaslama yapabilmek için hepsini tek bir kanonik forma indiriyoruz.
const BIRIM_MAP: Record<string, string> = {
  KG: "KG", KILO: "KG", KILOGRAM: "KG",
  AD: "AD", ADT: "AD", ADET: "AD",
  LT: "LT", L: "LT", LITRE: "LT",
  PAKET: "PAKET", PKT: "PAKET", PK: "PAKET",
  BAG: "BAG", DEMET: "BAG",
  KUTU: "KUTU", KOLI: "KOLI", KASA: "KASA",
};

/**
 * Birimi kanonik forma çevirir: "Adet" -> "AD", "PKT" -> "PAKET".
 * Tanımadığı birimi büyük harfe çevirip aynen döndürür — uydurmaz.
 * Böylece yeni bir birim çıktığında raporda görünür ve fark ederiz.
 */
export function normalizeUnit(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const k = normalizeName(value).replace(/\s+/g, "").toUpperCase();
  if (k === "") return null;
  return BIRIM_MAP[k] ?? k;
}