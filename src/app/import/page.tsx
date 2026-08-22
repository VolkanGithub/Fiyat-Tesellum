// ============================================================
//  src/app/import/page.tsx
//  STOKLAR.xlsx -> Supabase master_products aktarım ekranı
// ============================================================
"use client";

import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  UploadCloud,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  cleanText,
  normalizeDate,
  normalizeName,
  normalizeStockCode,
} from "@/lib/normalize";

// ---- Tipler ------------------------------------------------

type MasterRow = {
  stok_kodu: string;
  stok_adi: string;
  stok_adi_norm: string;
  stok_birim: string | null;
  stok_grup: string | null;
  son_alis_tarihi: string | null;
  son_satici: string | null;
};

type Sorun = {
  satir: number;
  kod: string;
  ad: string;
  sebep: string;
};

type Onizleme = {
  dosyaAdi: string;
  toplamSatir: number;
  gecerli: MasterRow[];
  sorunlar: Sorun[];
  tekrarEden: number; // dosyada birebir tekrar ettiği için teke indirilen satır
};

const PAKET_BOYUTU = 400; // Supabase'e kaç satırlık paketler halinde gönderelim

// ---- Yardımcı: Excel başlıklarını tolere ederek bul ---------
// "Stok Adı", "STOK ADI", "Stok adi" hepsi aynı sütundur.
function basligiBul(basliklar: string[], adaylar: string[]): string | null {
  const hedef = adaylar.map(normalizeName);
  return basliklar.find((b) => hedef.includes(normalizeName(b))) ?? null;
}

export default function ImportPage() {
  const [onizleme, setOnizleme] = useState<Onizleme | null>(null);
  const [okuma, setOkuma] = useState(false);
  const [aktarim, setAktarim] = useState(false);
  const [ilerleme, setIlerleme] = useState(0);
  const [sonuc, setSonuc] = useState<string | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const dosyaRef = useRef<HTMLInputElement>(null);

  const hepsiniSifirla = () => {
    setOnizleme(null);
    setIlerleme(0);
    setSonuc(null);
    setHata(null);
    if (dosyaRef.current) dosyaRef.current.value = "";
  };

  // ---- AŞAMA 1: Dosyayı oku ve denetle ---------------------
  const dosyaSecildi = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const dosya = e.target.files?.[0];
    if (!dosya) return;

    setOkuma(true);
    setHata(null);
    setSonuc(null);

    try {
      const buf = await dosya.arrayBuffer();
      // cellDates: true -> tarih hücreleri sayı değil Date olarak gelsin
      const wb = XLSX.read(buf, { cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const satirlar = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
        defval: null,
      });

      if (satirlar.length === 0) {
        throw new Error("Dosyanın ilk sayfasında veri bulunamadı.");
      }

      const basliklar = Object.keys(satirlar[0]);
      const cKod = basligiBul(basliklar, ["Stok Kodu", "Kod"]);
      const cAd = basligiBul(basliklar, ["Stok Adı", "Ürün Adı"]);
      const cBirim = basligiBul(basliklar, ["Stok Birim", "Birim"]);
      const cGrup = basligiBul(basliklar, ["Stok Grup", "Grup"]);
      const cTarih = basligiBul(basliklar, ["Son Alış Tarihi"]);
      const cSatici = basligiBul(basliklar, ["Son Satıcı"]);

      if (!cKod || !cAd) {
        throw new Error(
          `"Stok Kodu" ve "Stok Adı" sütunları bulunamadı. Dosyadaki başlıklar: ${basliklar.join(", ")}`
        );
      }

      // TypeScript'in burada yaptığı "null değil" daraltmasını closure'lara
      // güvenle taşımak için sütun adlarını ayrı sabitlere alıyoruz.
      const sKod: string = cKod;
      const sAd: string = cAd;

      // Mükerrer kodları iki gruba ayırıyoruz:
      //   a) Satır birebir aynı  -> masum export tekrarı, sessizce teke indir
      //   b) Aynı kod farklı ürünlerde -> gerçek çakışma, ikisini de atla ve göster
      // Bu ayrımı yapmamızın sebebi: gereksiz uyarı çıkaran bir denetim
      // katmanına bir süre sonra kimse bakmaz.
      const imzaUret = (s: Record<string, unknown>, kod: string) =>
        [
          kod,
          normalizeName(s[sAd]),
          cBirim ? normalizeName(s[cBirim]) : "",
          cGrup ? normalizeName(s[cGrup]) : "",
        ].join("|");

      const kodImzalari = new Map<string, Set<string>>();
      for (const s of satirlar) {
        const kod = normalizeStockCode(s[sKod]);
        if (!kod) continue;
        if (!kodImzalari.has(kod)) kodImzalari.set(kod, new Set<string>());
        kodImzalari.get(kod)!.add(imzaUret(s, kod));
      }

      const gecerli: MasterRow[] = [];
      const sorunlar: Sorun[] = [];
      const eklenenKodlar = new Set<string>();
      let tekrarEden = 0;

      satirlar.forEach((s, i) => {
        const satirNo = i + 2; // +2: Excel'de 1. satır başlık
        const kod = normalizeStockCode(s[sKod]);
        const ad = cleanText(s[sAd]);

        if (!kod) {
          sorunlar.push({ satir: satirNo, kod: "—", ad: ad ?? "—", sebep: "Stok kodu boş" });
          return;
        }
        if (!ad) {
          sorunlar.push({ satir: satirNo, kod, ad: "—", sebep: "Stok adı boş" });
          return;
        }
        // (b) Gerçek çakışma: aynı kod farklı ürünlere verilmiş.
        // Bilerek aktarmıyoruz. "Son satır kazansın" deseydik hangi ürünün
        // kazandığı Excel'deki sıraya kalırdı ve bunu asla fark etmezdin.
        if ((kodImzalari.get(kod)?.size ?? 0) > 1) {
          sorunlar.push({
            satir: satirNo,
            kod,
            ad,
            sebep: "Aynı stok kodu farklı ürünlerde kullanılmış",
          });
          return;
        }

        // (a) Masum tekrar: aynı satır ikinci kez geldi, sessizce atla.
        if (eklenenKodlar.has(kod)) {
          tekrarEden++;
          return;
        }
        eklenenKodlar.add(kod);

        gecerli.push({
          stok_kodu: kod,
          stok_adi: ad,
          stok_adi_norm: normalizeName(ad),
          stok_birim: cBirim ? cleanText(s[cBirim]) : null,
          stok_grup: cGrup ? cleanText(s[cGrup]) : null,
          son_alis_tarihi: cTarih ? normalizeDate(s[cTarih]) : null,
          son_satici: cSatici ? cleanText(s[cSatici]) : null,
        });
      });

      setOnizleme({
        dosyaAdi: dosya.name,
        toplamSatir: satirlar.length,
        gecerli,
        sorunlar,
        tekrarEden,
      });
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Dosya okunamadı.");
    } finally {
      setOkuma(false);
    }
  };

  // ---- AŞAMA 2: Supabase'e aktar ---------------------------
  const aktar = async () => {
    if (!onizleme || onizleme.gecerli.length === 0) return;

    setAktarim(true);
    setHata(null);
    setSonuc(null);
    setIlerleme(0);

    try {
      const satirlar = onizleme.gecerli;
      let gonderilen = 0;

      for (let i = 0; i < satirlar.length; i += PAKET_BOYUTU) {
        const paket = satirlar
          .slice(i, i + PAKET_BOYUTU)
          .map((r) => ({ ...r, updated_at: new Date().toISOString() }));

        // upsert = "bu stok kodu varsa güncelle, yoksa ekle"
        // Bu sayede ekranı istediğin kadar tekrar çalıştırabilirsin.
        const { error } = await supabase
          .from("master_products")
          .upsert(paket, { onConflict: "stok_kodu" });

        if (error) throw new Error(error.message);

        gonderilen += paket.length;
        setIlerleme(Math.round((gonderilen / satirlar.length) * 100));
      }

      setSonuc(`${gonderilen} ürün master_products tablosuna aktarıldı.`);
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Aktarım sırasında hata oluştu.");
    } finally {
      setAktarim(false);
    }
  };

  // Sorunları sebebe göre gruplayıp özet çıkaralım
  const sorunOzeti = useMemo(() => {
    if (!onizleme) return [];
    const m = new Map<string, number>();
    for (const s of onizleme.sorunlar) m.set(s.sebep, (m.get(s.sebep) ?? 0) + 1);
    return [...m.entries()];
  }, [onizleme]);

  return (
    <main className="min-h-screen bg-[#F7F8F6] text-[#0F1A14]">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        {/* Başlık */}
        <header className="mb-8">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#5B6660]">
            Ana veri
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Stok kartlarını içeri al
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[#5B6660]">
            ElektraWeb&apos;den aldığın stok listesini yükle. Aktarmadan önce
            dosyayı denetler, sorunlu satırları gösterir. Aynı dosyayı tekrar
            yüklemek güvenlidir: mevcut kayıtlar güncellenir, mükerrer kayıt oluşmaz.
          </p>
        </header>

        {/* Dosya seçimi */}
        <section className="rounded-2xl border border-[#DDE3DC] bg-white p-5 sm:p-6">
          <label
            htmlFor="dosya"
            className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[#C6D0C6] bg-[#FAFBFA] px-4 py-10 text-center transition-colors hover:border-[#1F5C3D] hover:bg-[#F3F7F3] focus-within:ring-2 focus-within:ring-[#1F5C3D]"
          >
            {okuma ? (
              <Loader2 className="h-7 w-7 animate-spin text-[#1F5C3D]" />
            ) : (
              <UploadCloud className="h-7 w-7 text-[#1F5C3D]" />
            )}
            <span className="text-sm font-medium">
              {okuma ? "Dosya okunuyor…" : "Excel dosyası seç"}
            </span>
            <span className="text-xs text-[#5B6660]">.xlsx — ilk sayfa okunur</span>
            <input
              id="dosya"
              ref={dosyaRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={dosyaSecildi}
              disabled={okuma || aktarim}
              className="sr-only"
            />
          </label>
        </section>

        {/* Hata */}
        {hata && (
          <div className="mt-4 flex gap-3 rounded-xl border border-[#E9C9C6] bg-[#FDF4F3] p-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-[#B3261E]" />
            <p className="text-sm leading-relaxed text-[#7A1B15]">{hata}</p>
          </div>
        )}

        {/* Önizleme */}
        {onizleme && (
          <section className="mt-4 overflow-hidden rounded-2xl border border-[#DDE3DC] bg-white">
            <div className="flex items-center gap-2 border-b border-[#DDE3DC] px-5 py-4">
              <FileSpreadsheet className="h-4 w-4 text-[#1F5C3D]" />
              <span className="truncate text-sm font-medium">{onizleme.dosyaAdi}</span>
            </div>

            <div className="grid grid-cols-3 divide-x divide-[#DDE3DC] border-b border-[#DDE3DC]">
              <Kutu etiket="Okunan satır" deger={onizleme.toplamSatir} />
              <Kutu etiket="Aktarılacak" deger={onizleme.gecerli.length} vurgu="#1F5C3D" />
              <Kutu
                etiket="Sorunlu"
                deger={onizleme.sorunlar.length}
                vurgu={onizleme.sorunlar.length > 0 ? "#B3261E" : undefined}
              />
            </div>

            {/* Birebir tekrar eden satır bilgisi */}
            {onizleme.tekrarEden > 0 && (
              <p className="border-b border-[#DDE3DC] px-5 py-3 text-xs leading-relaxed text-[#5B6660]">
                {onizleme.tekrarEden} satır dosyada birebir tekrar ettiği için teke
                indirildi. Bilgi kaybı yok.
              </p>
            )}

            {/* Sorun listesi */}
            {onizleme.sorunlar.length > 0 && (
              <div className="border-b border-[#DDE3DC] px-5 py-4">
                <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
                  {sorunOzeti.map(([sebep, adet]) => (
                    <span key={sebep} className="text-xs text-[#5B6660]">
                      <span className="font-semibold text-[#B3261E]">{adet}</span> · {sebep}
                    </span>
                  ))}
                </div>
                <ul className="space-y-1.5">
                  {onizleme.sorunlar.map((s, i) => (
                    <li
                      key={`${s.satir}-${i}`}
                      className="flex gap-3 border-l-2 border-[#C9A227] py-1 pl-3 text-xs"
                    >
                      <span className="w-14 shrink-0 tabular-nums text-[#5B6660]">
                        satır {s.satir}
                      </span>
                      <span className="w-20 shrink-0 font-mono tabular-nums">{s.kod}</span>
                      <span className="min-w-0 flex-1 truncate">{s.ad}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs leading-relaxed text-[#5B6660]">
                  Bu satırlar aktarılmayacak. Kaynağı ElektraWeb&apos;de düzeltip
                  dosyayı tekrar yükle.
                </p>
              </div>
            )}

            {/* Aksiyon */}
            <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <button
                onClick={hepsiniSifirla}
                disabled={aktarim}
                className="inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm text-[#5B6660] transition-colors hover:bg-[#F0F3F0] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5C3D] disabled:opacity-40"
              >
                <RotateCcw className="h-4 w-4" />
                Başka dosya seç
              </button>

              <button
                onClick={aktar}
                disabled={aktarim || onizleme.gecerli.length === 0}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1F5C3D] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#184A31] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5C3D] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {aktarim && <Loader2 className="h-4 w-4 animate-spin" />}
                {aktarim
                  ? `Aktarılıyor… %${ilerleme}`
                  : `${onizleme.gecerli.length} ürünü aktar`}
              </button>
            </div>

            {/* İlerleme çubuğu */}
            {aktarim && (
              <div className="h-1 w-full bg-[#EDF0ED]">
                <div
                  className="h-full bg-[#C9A227] transition-[width] duration-300 motion-reduce:transition-none"
                  style={{ width: `${ilerleme}%` }}
                />
              </div>
            )}
          </section>
        )}

        {/* Başarı */}
        {sonuc && (
          <div className="mt-4 flex gap-3 rounded-xl border border-[#C3DCC9] bg-[#F2F8F3] p-4">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-[#1F5C3D]" />
            <p className="text-sm leading-relaxed text-[#1F5C3D]">{sonuc}</p>
          </div>
        )}
      </div>
    </main>
  );
}

// Küçük sayı kutusu
function Kutu({
  etiket,
  deger,
  vurgu,
}: {
  etiket: string;
  deger: number;
  vurgu?: string;
}) {
  return (
    <div className="px-4 py-4 text-center sm:px-5">
      <div
        className="text-xl font-semibold tabular-nums sm:text-2xl"
        style={vurgu ? { color: vurgu } : undefined}
      >
        {deger}
      </div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wider text-[#5B6660]">
        {etiket}
      </div>
    </div>
  );
}