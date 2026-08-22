// ============================================================
//  src/app/faturalar/page.tsx
//  Fatura yükleme (ElektraWeb export)
// ============================================================
"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  UploadCloud,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { normalizeName, tarihFromDosyaAdi } from "@/lib/normalize";
import { parseInvoiceFile, type FaturaKalemi } from "@/lib/parseInvoice";

type Tedarikci = { id: string; name: string };

const PAKET_BOYUTU = 200;

export default function FaturalarPage() {
  const [tedarikciler, setTedarikciler] = useState<Tedarikci[]>([]);
  const [tedarikcilerYuklendi, setTedarikcilerYuklendi] = useState(false);
  const [tedarikciId, setTedarikciId] = useState("");
  const [faturaNo, setFaturaNo] = useState("");
  const [faturaTarihi, setFaturaTarihi] = useState("");

  const [dosyaAdi, setDosyaAdi] = useState<string | null>(null);
  const [kalemler, setKalemler] = useState<FaturaKalemi[] | null>(null);
  const [atlanan, setAtlanan] = useState<{ satir: number; sebep: string }[]>([]);
  const [eslesmeMap, setEslesmeMap] = useState<Map<string, boolean>>(new Map());

  const [okuma, setOkuma] = useState(false);
  const [kaydediyor, setKaydediyor] = useState(false);
  const [ilerleme, setIlerleme] = useState(0);
  const [basarili, setBasarili] = useState<string | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const dosyaRef = useRef<HTMLInputElement>(null);

  // Tedarikçileri ve tüm master ürün isimlerini yalnızca ilk kullanımda çek.
  // Bir EVENT içinde tetikleniyor (dosya seçilince), effect değil.
  async function bagimlilikYukle() {
    if (tedarikcilerYuklendi) return;
    const { data, error } = await supabase.from("suppliers").select("id, name").order("name");
    if (error) setHata(error.message);
    else setTedarikciler(data ?? []);
    setTedarikcilerYuklendi(true);
  }

  const sifirla = () => {
    setKalemler(null);
    setAtlanan([]);
    setDosyaAdi(null);
    setIlerleme(0);
    setBasarili(null);
    setHata(null);
    if (dosyaRef.current) dosyaRef.current.value = "";
  };

  // --- AŞAMA 1: oku, önizle, master ürünlerle eşleş ---
  const dosyaSecildi = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const dosya = e.target.files?.[0];
    if (!dosya) return;

    setOkuma(true);
    setHata(null);
    setBasarili(null);

    try {
      await bagimlilikYukle();

      const buf = await dosya.arrayBuffer();
      const r = parseInvoiceFile(buf);

      // Faturadaki ürün isimleri master ile birebir eşleşiyor olmalı
      // (ElektraWeb mal kabulde stok kartı seçtirir). Kaç tanesinin
      // gerçekten eşleştiğini burada, kaydetmeden ÖNCE gösteriyoruz.
      const normlar = [...new Set(r.kalemler.map((k) => k.stok_adi_norm))];
      const { data: eslesenler } = await supabase
        .from("master_products")
        .select("stok_adi_norm")
        .in("stok_adi_norm", normlar);

      const bulunanlar = new Set((eslesenler ?? []).map((m) => m.stok_adi_norm));
      const harita = new Map<string, boolean>();
      for (const n of normlar) harita.set(n, bulunanlar.has(n));

      setKalemler(r.kalemler);
      setAtlanan(r.atlananSatirlar);
      setEslesmeMap(harita);
      setDosyaAdi(dosya.name);

      // Dosya adından tarih öner — SEN ONAYLAYANA kadar hiçbir yere
      // kaydedilmez, sadece kutuyu dolduruyoruz.
      const tarihOneri = tarihFromDosyaAdi(dosya.name);
      if (tarihOneri) setFaturaTarihi(tarihOneri);

      // Tedarikçi adını dosya adı içinde arayıp öner (basit alt-metin eşleşmesi).
      const dosyaNorm = normalizeName(dosya.name);
      const eslesenTedarikci = (tedarikciler.length ? tedarikciler : []).find((t) => {
        const ilkKelime = normalizeName(t.name).split(" ")[0];
        return ilkKelime.length >= 3 && dosyaNorm.includes(ilkKelime);
      });
      if (eslesenTedarikci) setTedarikciId(eslesenTedarikci.id);
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Dosya okunamadı.");
      setKalemler(null);
    } finally {
      setOkuma(false);
    }
  };

  // --- AŞAMA 2: kaydet ---
  const kaydet = async () => {
    if (!kalemler || !dosyaAdi || !tedarikciId || !faturaTarihi) return;

    setKaydediyor(true);
    setHata(null);
    setIlerleme(0);

    try {
      const { data: fatura, error: faturaHata } = await supabase
        .from("invoices")
        .insert({
          supplier_id: tedarikciId,
          fatura_no: faturaNo.trim() || null,
          fatura_tarihi: faturaTarihi,
          dosya_adi: dosyaAdi,
        })
        .select("id")
        .single();

      if (faturaHata) {
        // Aynı dosya adıyla bu tedarikçiye ikinci kez fatura yüklenmeye
        // çalışılırsa buraya düşer (UNIQUE kısıtı). Anlaşılır mesaj verelim.
        if (faturaHata.code === "23505") {
          throw new Error(
            "Bu fatura zaten yüklenmiş görünüyor (aynı tedarikçi + aynı dosya adı). " +
            "Aynı iade talebini iki kez oluşturmamak için tekrar yüklenmedi."
          );
        }
        throw new Error(faturaHata.message);
      }

      // Master ürün eşleşmesi olanları bağla, olmayanları boş bırak —
      // eşleştirme ekranında elle bağlanacak.
      const normToId = new Map<string, string>();
      const normlar = [...eslesmeMap.keys()];
      if (normlar.length > 0) {
        const { data } = await supabase
          .from("master_products")
          .select("id, stok_adi_norm")
          .in("stok_adi_norm", normlar);
        for (const m of data ?? []) normToId.set(m.stok_adi_norm, m.id);
      }

      const satirlar = kalemler.map((k) => ({
        invoice_id: fatura.id,
        satir_no: k.satir_no,
        stok_adi: k.stok_adi,
        stok_adi_norm: k.stok_adi_norm,
        birim: k.birim,
        birim_norm: k.birim_norm,
        miktar: k.miktar,
        birim_fiyat: k.birim_fiyat,
        satir_toplam: k.satir_toplam,
        kdv_orani: k.kdv_orani,
        vergi_dahil_toplam: k.vergi_dahil_toplam,
        checksum_ok: k.checksum_ok,
        master_product_id: normToId.get(k.stok_adi_norm) ?? null,
      }));

      let gonderilen = 0;
      for (let i = 0; i < satirlar.length; i += PAKET_BOYUTU) {
        const paket = satirlar.slice(i, i + PAKET_BOYUTU);
        const { error } = await supabase.from("invoice_items").insert(paket);
        if (error) throw new Error(error.message);
        gonderilen += paket.length;
        setIlerleme(Math.round((gonderilen / satirlar.length) * 100));
      }

      setBasarili(`Fatura kaydedildi — ${gonderilen} satır.`);
      sifirla();
      setFaturaNo("");
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Kayıt sırasında hata oluştu.");
    } finally {
      setKaydediyor(false);
    }
  };

  const eslesenSayi = useMemo(() => {
    if (!kalemler) return 0;
    return kalemler.filter((k) => eslesmeMap.get(k.stok_adi_norm)).length;
  }, [kalemler, eslesmeMap]);

  const checksumSorunlu = useMemo(() => {
    if (!kalemler) return [];
    return kalemler.filter((k) => k.checksum_ok === false);
  }, [kalemler]);

  return (
    <main className="min-h-screen bg-[#F7F8F6] text-[#0F1A14]">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-[#5B6660] transition-colors hover:text-[#1F5C3D]"
        >
          <ArrowLeft className="h-4 w-4" />
          Ana sayfa
        </Link>

        <header className="mb-8">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#5B6660]">
            Adım 4
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Fatura yükle
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[#5B6660]">
            ElektraWeb fatura satırı export&apos;unu yükle. Tarih ve tedarikçi dosya
            adından tahmin edilir — kaydetmeden önce kontrol et.
          </p>
        </header>

        {/* Dosya */}
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
              {okuma ? "Fatura okunuyor…" : "Fatura Excel'ini seç"}
            </span>
            <span className="text-xs text-[#5B6660]">.xlsx — ilk sayfa okunur</span>
            <input
              id="dosya"
              ref={dosyaRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={dosyaSecildi}
              disabled={okuma || kaydediyor}
              className="sr-only"
            />
          </label>
        </section>

        {hata && (
          <div className="mt-4 flex gap-3 rounded-xl border border-[#E9C9C6] bg-[#FDF4F3] p-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-[#B3261E]" />
            <p className="text-sm leading-relaxed text-[#7A1B15]">{hata}</p>
          </div>
        )}

        {basarili && (
          <div className="mt-4 flex gap-3 rounded-xl border border-[#C3DCC9] bg-[#F2F8F3] p-4">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-[#1F5C3D]" />
            <p className="text-sm leading-relaxed text-[#1F5C3D]">{basarili}</p>
          </div>
        )}

        {kalemler && dosyaAdi && (
          <>
            {/* Fatura bilgileri — dosya adından öneri, sen onaylıyorsun */}
            <section className="mt-4 rounded-2xl border border-[#DDE3DC] bg-white p-5 sm:p-6">
              <div className="flex items-center gap-2 pb-4">
                <FileSpreadsheet className="h-4 w-4 text-[#1F5C3D]" />
                <span className="truncate text-sm font-medium">{dosyaAdi}</span>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="ted" className="mb-1.5 block text-sm font-medium">
                    Tedarikçi
                  </label>
                  <select
                    id="ted"
                    value={tedarikciId}
                    onChange={(e) => setTedarikciId(e.target.value)}
                    className="w-full rounded-lg border border-[#DDE3DC] bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-[#1F5C3D] focus:ring-2 focus:ring-[#1F5C3D]/15"
                  >
                    <option value="">Seç…</option>
                    {tedarikciler.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="tarih" className="mb-1.5 block text-sm font-medium">
                    Fatura tarihi
                  </label>
                  <input
                    id="tarih"
                    type="date"
                    value={faturaTarihi}
                    onChange={(e) => setFaturaTarihi(e.target.value)}
                    className="w-full rounded-lg border border-[#DDE3DC] px-3 py-2.5 text-sm outline-none transition-colors focus:border-[#1F5C3D] focus:ring-2 focus:ring-[#1F5C3D]/15"
                  />
                  {!tarihFromDosyaAdi(dosyaAdi) && (
                    <p className="mt-1.5 text-xs text-[#8A6D12]">
                      Dosya adından tarih çıkarılamadı, elle gir.
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="no" className="mb-1.5 block text-sm font-medium">
                    Fatura no{" "}
                    <span className="font-normal text-[#5B6660]">(isteğe bağlı)</span>
                  </label>
                  <input
                    id="no"
                    value={faturaNo}
                    onChange={(e) => setFaturaNo(e.target.value)}
                    placeholder="Export'ta yoksa boş bırak"
                    className="w-full rounded-lg border border-[#DDE3DC] px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-[#B4BDB6] focus:border-[#1F5C3D] focus:ring-2 focus:ring-[#1F5C3D]/15"
                  />
                </div>
              </div>
            </section>

            {/* Önizleme */}
            <section className="mt-4 overflow-hidden rounded-2xl border border-[#DDE3DC] bg-white">
              <div className="grid grid-cols-3 divide-x divide-[#DDE3DC] border-b border-[#DDE3DC]">
                <Kutu etiket="Satır" deger={kalemler.length} />
                <Kutu
                  etiket="Master ürünle eşleşen"
                  deger={eslesenSayi}
                  vurgu={eslesenSayi === kalemler.length ? "#1F5C3D" : "#8A6D12"}
                />
                <Kutu
                  etiket="Eşleşmeyen"
                  deger={kalemler.length - eslesenSayi}
                  vurgu={kalemler.length - eslesenSayi > 0 ? "#B3261E" : undefined}
                />
              </div>

              {kalemler.length - eslesenSayi > 0 && (
                <p className="border-b border-[#DDE3DC] px-5 py-3 text-xs leading-relaxed text-[#5B6660]">
                  Eşleşmeyen satırlar yine de kaydedilir — bağlantısı boş kalır ve
                  denetim ekranında elle bağlarsın.
                </p>
              )}

              {checksumSorunlu.length > 0 && (
                <div className="flex gap-3 border-b border-[#DDE3DC] bg-[#FDF4F3] px-5 py-3">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-[#B3261E]" />
                  <p className="text-xs leading-relaxed text-[#7A1B15]">
                    {checksumSorunlu.length} satırda KDV kontrolü tutmuyor —
                    Satır Toplam × (1+KDV) faturadaki Vergi Dahil Toplam ile
                    örtüşmüyor. Bir okuma hatası olabilir, satırları kontrol et:{" "}
                    {checksumSorunlu.map((k) => k.stok_adi).join(", ")}
                  </p>
                </div>
              )}

              {atlanan.length > 0 && (
                <p className="border-b border-[#DDE3DC] px-5 py-3 text-xs leading-relaxed text-[#8A6D12]">
                  {atlanan.length} satır atlandı: {atlanan.map((a) => `satır ${a.satir} (${a.sebep})`).join(", ")}
                </p>
              )}

              <div className="max-h-80 overflow-y-auto border-b border-[#DDE3DC]">
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-[#EDF0ED]">
                    {kalemler.map((k) => {
                      const eslesti = eslesmeMap.get(k.stok_adi_norm);
                      return (
                        <tr key={k.satir_no}>
                          <td className="px-5 py-1.5">
                            <span
                              className={
                                eslesti
                                  ? "inline-block h-1.5 w-1.5 rounded-full bg-[#1F5C3D]"
                                  : "inline-block h-1.5 w-1.5 rounded-full bg-[#B3261E]"
                              }
                            />
                          </td>
                          <td className="py-1.5 pr-2">{k.stok_adi}</td>
                          <td className="py-1.5 pr-2 text-[#5B6660]">{k.birim_norm}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums text-[#5B6660]">
                            {k.miktar}
                          </td>
                          <td className="px-5 py-1.5 text-right tabular-nums">
                            {k.birim_fiyat.toLocaleString("tr-TR", {
                              minimumFractionDigits: 2,
                            })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <button
                  onClick={sifirla}
                  disabled={kaydediyor}
                  className="inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm text-[#5B6660] transition-colors hover:bg-[#F0F3F0] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5C3D] disabled:opacity-40"
                >
                  <RotateCcw className="h-4 w-4" />
                  Başka dosya
                </button>

                <button
                  onClick={kaydet}
                  disabled={kaydediyor || !tedarikciId || !faturaTarihi}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1F5C3D] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#184A31] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5C3D] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {kaydediyor && <Loader2 className="h-4 w-4 animate-spin" />}
                  {kaydediyor ? `Kaydediliyor… %${ilerleme}` : `${kalemler.length} satırı kaydet`}
                </button>
              </div>

              {kaydediyor && (
                <div className="h-1 w-full bg-[#EDF0ED]">
                  <div
                    className="h-full bg-[#C9A227] transition-[width] duration-300 motion-reduce:transition-none"
                    style={{ width: `${ilerleme}%` }}
                  />
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function Kutu({ etiket, deger, vurgu }: { etiket: string; deger: number; vurgu?: string }) {
  return (
    <div className="px-4 py-4 text-center sm:px-5">
      <div className="text-xl font-semibold tabular-nums sm:text-2xl" style={vurgu ? { color: vurgu } : undefined}>
        {deger}
      </div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wider text-[#5B6660]">{etiket}</div>
    </div>
  );
}