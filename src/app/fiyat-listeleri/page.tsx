// ============================================================
//  src/app/fiyat-listeleri/page.tsx
//  Tedarikçi fiyat listesi yükleme (Excel)
// ============================================================
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { parsePriceListFile, type ListeParseSonucu } from "@/lib/parsePriceList";

type Tedarikci = { id: string; name: string };
type KayitliListe = {
  id: string;
  liste_etiketi: string | null;
  dosya_adi: string;
  yuklenme_tarihi: string;
};

const PAKET_BOYUTU = 400;

export default function FiyatListeleriPage() {
  const [tedarikciler, setTedarikciler] = useState<Tedarikci[]>([]);
  const [tedarikciId, setTedarikciId] = useState("");
  const [etiket, setEtiket] = useState("");

  const [dosyaAdi, setDosyaAdi] = useState<string | null>(null);
  const [sonuc, setSonuc] = useState<ListeParseSonucu | null>(null);
  const [kayitli, setKayitli] = useState<KayitliListe[]>([]);

  const [okuma, setOkuma] = useState(false);
  const [kaydediyor, setKaydediyor] = useState(false);
  const [ilerleme, setIlerleme] = useState(0);
  const [basarili, setBasarili] = useState<string | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const dosyaRef = useRef<HTMLInputElement>(null);

  // --- Tedarikçileri getir ---
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name")
        .order("name");
      if (error) setHata(error.message);
      else setTedarikciler(data ?? []);
    })();
  }, []);

  // --- Seçili tedarikçinin kayıtlı listeleri ---
  // İlk await'ten önce setState yok (bkz. react-hooks/set-state-in-effect).
  const kayitliGetir = useCallback(async (id: string) => {
    const { data } = await supabase
      .from("price_lists")
      .select("id, liste_etiketi, dosya_adi, yuklenme_tarihi")
      .eq("supplier_id", id)
      .order("yuklenme_tarihi", { ascending: false });
    setKayitli(data ?? []);
  }, []);

  // Bu bir EFFECT değil, bir EVENT HANDLER.
  // Tedarikçi değişmesi kullanıcının yaptığı bir eylemdir; onun sonucunu
  // effect ile "senkronize etmeye" çalışmak gereksiz. React'in kendi
  // tavsiyesi de bu: "You Might Not Need an Effect".
  // Event handler içindeki setState çağrıları lint kuralının kapsamı dışında.
  const tedarikciSecildi = async (id: string) => {
    setTedarikciId(id);
    setKayitli([]);
    if (!id) return;
    await kayitliGetir(id);
  };

  const sifirla = () => {
    setSonuc(null);
    setDosyaAdi(null);
    setIlerleme(0);
    setBasarili(null);
    setHata(null);
    if (dosyaRef.current) dosyaRef.current.value = "";
  };

  // --- AŞAMA 1: oku ve önizle ---
  const dosyaSecildi = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const dosya = e.target.files?.[0];
    if (!dosya) return;

    setOkuma(true);
    setHata(null);
    setBasarili(null);

    try {
      const buf = await dosya.arrayBuffer();
      const r = parsePriceListFile(buf);
      setSonuc(r);
      setDosyaAdi(dosya.name);
      // Etiket boşsa dosya adından bir başlangıç önerisi ver
      if (etiket.trim() === "") setEtiket(dosya.name.replace(/\.[^.]+$/, ""));
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Dosya okunamadı.");
      setSonuc(null);
    } finally {
      setOkuma(false);
    }
  };

  // --- AŞAMA 2: kaydet ---
  const kaydet = async () => {
    if (!sonuc || !tedarikciId || !dosyaAdi) return;
    if (etiket.trim() === "") {
      setHata("Listeye bir etiket ver — denetim ekranında bununla seçeceksin.");
      return;
    }

    setKaydediyor(true);
    setHata(null);
    setIlerleme(0);

    try {
      const { data: liste, error: listeHata } = await supabase
        .from("price_lists")
        .insert({
          supplier_id: tedarikciId,
          dosya_adi: dosyaAdi,
          kaynak_tip: "excel",
          liste_etiketi: etiket.trim(),
          dosyadaki_tarih: sonuc.dosyadakiTarih,
        })
        .select("id")
        .single();

      if (listeHata) throw new Error(listeHata.message);

      const satirlar = sonuc.kalemler.map((k) => ({
        price_list_id: liste.id,
        kategori: k.kategori,
        sira_no: k.sira_no,
        urun_adi: k.urun_adi,
        urun_adi_norm: k.urun_adi_norm,
        birim: k.birim,
        birim_norm: k.birim_norm,
        birim_fiyat: k.birim_fiyat,
      }));

      let gonderilen = 0;
      for (let i = 0; i < satirlar.length; i += PAKET_BOYUTU) {
        const paket = satirlar.slice(i, i + PAKET_BOYUTU);
        const { error } = await supabase.from("price_list_items").insert(paket);
        if (error) throw new Error(error.message);
        gonderilen += paket.length;
        setIlerleme(Math.round((gonderilen / satirlar.length) * 100));
      }

      setBasarili(`"${etiket.trim()}" listesi kaydedildi — ${gonderilen} kalem.`);
      setSonuc(null);
      setDosyaAdi(null);
      setEtiket("");
      if (dosyaRef.current) dosyaRef.current.value = "";
      await kayitliGetir(tedarikciId);
    } catch (err) {
      setHata(err instanceof Error ? err.message : "Kayıt sırasında hata oluştu.");
    } finally {
      setKaydediyor(false);
    }
  };

  const kategoriOzeti = useMemo(() => {
    if (!sonuc) return [];
    const m = new Map<string, number>();
    for (const k of sonuc.kalemler) {
      const ad = k.kategori ?? "Kategorisiz";
      m.set(ad, (m.get(ad) ?? 0) + 1);
    }
    return [...m.entries()];
  }, [sonuc]);

  const fiyatli = sonuc
    ? sonuc.kalemler.length - sonuc.fiyatsiz.length
    : 0;

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
            Adım 3
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Fiyat listesi yükle
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[#5B6660]">
            Excel listeyi yükle. Denetim yaparken bu listelerden bir veya
            birkaçını seçeceksin; baz fiyat, seçtiklerinin en düşüğü olacak.
          </p>
        </header>

        {/* Tedarikçi + etiket */}
        <section className="rounded-2xl border border-[#DDE3DC] bg-white p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ted" className="mb-1.5 block text-sm font-medium">
                Tedarikçi
              </label>
              <select
                id="ted"
                value={tedarikciId}
                onChange={(e) => tedarikciSecildi(e.target.value)}
                className="w-full rounded-lg border border-[#DDE3DC] bg-white px-3 py-2.5 text-sm outline-none transition-colors focus:border-[#1F5C3D] focus:ring-2 focus:ring-[#1F5C3D]/15"
              >
                <option value="">Seç…</option>
                {tedarikciler.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {tedarikciler.length === 0 && (
                <p className="mt-1.5 text-xs text-[#5B6660]">
                  Henüz tedarikçi yok —{" "}
                  <Link href="/tedarikciler" className="text-[#1F5C3D] underline">
                    önce ekle
                  </Link>
                  .
                </p>
              )}
            </div>

            <div>
              <label htmlFor="etiket" className="mb-1.5 block text-sm font-medium">
                Liste etiketi
              </label>
              <input
                id="etiket"
                value={etiket}
                onChange={(e) => setEtiket(e.target.value)}
                placeholder="Liste B — 11 Ağustos"
                className="w-full rounded-lg border border-[#DDE3DC] px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-[#B4BDB6] focus:border-[#1F5C3D] focus:ring-2 focus:ring-[#1F5C3D]/15"
              />
            </div>
          </div>
        </section>

        {/* Dosya */}
        <section className="mt-4 rounded-2xl border border-[#DDE3DC] bg-white p-5 sm:p-6">
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
              {okuma ? "Liste okunuyor…" : "Fiyat listesi Excel'ini seç"}
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

        {/* Önizleme */}
        {sonuc && dosyaAdi && (
          <section className="mt-4 overflow-hidden rounded-2xl border border-[#DDE3DC] bg-white">
            <div className="flex items-center gap-2 border-b border-[#DDE3DC] px-5 py-4">
              <FileSpreadsheet className="h-4 w-4 text-[#1F5C3D]" />
              <span className="truncate text-sm font-medium">{dosyaAdi}</span>
            </div>

            <div className="grid grid-cols-3 divide-x divide-[#DDE3DC] border-b border-[#DDE3DC]">
              <Kutu etiket="Kalem" deger={sonuc.kalemler.length} />
              <Kutu etiket="Fiyatlı" deger={fiyatli} vurgu="#1F5C3D" />
              <Kutu
                etiket="Fiyatsız"
                deger={sonuc.fiyatsiz.length}
                vurgu={sonuc.fiyatsiz.length > 0 ? "#8A6D12" : undefined}
              />
            </div>

            <div className="border-b border-[#DDE3DC] px-5 py-4">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {kategoriOzeti.map(([ad, adet]) => (
                  <span key={ad} className="text-xs text-[#5B6660]">
                    <span className="font-semibold text-[#0F1A14]">{adet}</span> · {ad}
                  </span>
                ))}
              </div>
              {sonuc.dosyadakiTarih && (
                <p className="mt-3 text-xs leading-relaxed text-[#5B6660]">
                  Dosyada yazan tarih: <strong>{sonuc.dosyadakiTarih}</strong> — bilgi
                  olarak saklanır, hesapta kullanılmaz.
                </p>
              )}
            </div>

            {sonuc.fiyatsiz.length > 0 && (
              <div className="border-b border-[#DDE3DC] px-5 py-4">
                <p className="mb-2 text-xs leading-relaxed text-[#5B6660]">
                  Bu kalemlerde fiyat yok (listede <code>0</code> veya <code>-</code>).
                  Kaydedilir ama kıyaslamada kullanılmaz — bedava sayılmaz.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {sonuc.fiyatsiz.map((ad, i) => (
                    <span
                      key={`${ad}-${i}`}
                      className="rounded-md bg-[#F5EEDA] px-2 py-0.5 text-xs text-[#8A6D12]"
                    >
                      {ad}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {sonuc.cakisan.length > 0 && (
              <div className="border-b border-[#DDE3DC] px-5 py-4">
                <p className="text-xs leading-relaxed text-[#B3261E]">
                  Aynı ürün listede birden fazla kez geçiyor, ilki alındı:{" "}
                  {sonuc.cakisan.join(", ")}
                </p>
              </div>
            )}

            {/* İlk kalemler */}
            <div className="max-h-72 overflow-y-auto border-b border-[#DDE3DC]">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-[#EDF0ED]">
                  {sonuc.kalemler.map((k, i) => (
                    <tr key={`${k.urun_adi_norm}-${i}`}>
                      <td className="px-5 py-1.5 text-[#5B6660]">{k.kategori}</td>
                      <td className="px-2 py-1.5">{k.urun_adi}</td>
                      <td className="px-2 py-1.5 text-[#5B6660]">{k.birim_norm}</td>
                      <td className="px-5 py-1.5 text-right tabular-nums">
                        {k.birim_fiyat === null ? (
                          <span className="text-[#8A6D12]">fiyat yok</span>
                        ) : (
                          k.birim_fiyat.toLocaleString("tr-TR", {
                            minimumFractionDigits: 2,
                          })
                        )}
                      </td>
                    </tr>
                  ))}
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
                disabled={kaydediyor || !tedarikciId}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1F5C3D] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#184A31] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5C3D] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {kaydediyor && <Loader2 className="h-4 w-4 animate-spin" />}
                {kaydediyor
                  ? `Kaydediliyor… %${ilerleme}`
                  : `${sonuc.kalemler.length} kalemi kaydet`}
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
        )}

        {/* Kayıtlı listeler */}
        {tedarikciId && (
          <section className="mt-8">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-[#5B6660]">
              Bu tedarikçinin kayıtlı listeleri {kayitli.length > 0 && `(${kayitli.length})`}
            </h2>
            {kayitli.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#DDE3DC] px-5 py-6 text-center text-sm text-[#5B6660]">
                Henüz liste yok.
              </div>
            ) : (
              <ul className="divide-y divide-[#DDE3DC] overflow-hidden rounded-xl border border-[#DDE3DC] bg-white">
                {kayitli.map((l) => (
                  <li key={l.id} className="flex items-baseline gap-3 px-5 py-3">
                    <span className="flex-1 text-sm font-medium">
                      {l.liste_etiketi ?? l.dosya_adi}
                    </span>
                    <span className="text-xs tabular-nums text-[#5B6660]">
                      {new Date(l.yuklenme_tarihi).toLocaleString("tr-TR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

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