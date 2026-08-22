// ============================================================
//  src/app/tedarikciler/page.tsx
//  Tedarikçi listesi ve ekleme
// ============================================================
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Loader2, Plus, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Tedarikci = {
  id: string;
  name: string;
  contact_info: string | null;
  created_at: string;
};

export default function TedarikcilerPage() {
  const [liste, setListe] = useState<Tedarikci[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [ad, setAd] = useState("");
  const [iletisim, setIletisim] = useState("");
  const [kaydediyor, setKaydediyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const ilkYukleme = async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name, contact_info, created_at")
        .order("name");

      if (isMounted) {
        if (error) setHata(error.message);
        else setListe(data ?? []);
        setYukleniyor(false);
      }
    };

    ilkYukleme();

    return () => {
      isMounted = false;
    };
  }, []);

  const listeyiYenile = async () => {
    const { data, error } = await supabase
      .from("suppliers")
      .select("id, name, contact_info, created_at")
      .order("name");

    if (!error) setListe(data ?? []);
  };

  const ekle = async () => {
    const temiz = ad.trim();
    if (!temiz) return;

    const mevcut = liste.find(
      (t) => t.name.trim().toLocaleLowerCase("tr") === temiz.toLocaleLowerCase("tr")
    );
    if (mevcut) {
      setHata(`"${mevcut.name}" zaten kayıtlı.`);
      return;
    }

    setKaydediyor(true);
    setHata(null);

    const { error } = await supabase
      .from("suppliers")
      .insert({ name: temiz, contact_info: iletisim.trim() || null });

    if (error) {
      setHata(error.message);
    } else {
      setAd("");
      setIletisim("");
      await listeyiYenile();
    }
    setKaydediyor(false);
  };

  return (
    <main className="min-h-screen bg-[#F7F8F6] text-[#0F1A14]">
      <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-[#5B6660] transition-colors hover:text-[#1F5C3D]"
        >
          <ArrowLeft className="h-4 w-4" />
          Ana sayfa
        </Link>

        <header className="mb-8">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#5B6660]">
            Adım 2
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Tedarikçiler
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[#5B6660]">
            Fiyat listesi ve fatura yükleyeceğin firmalar. Firma adını
            ElektraWeb&apos;de göründüğü gibi yazman, ileride karışıklığı önler.
          </p>
        </header>

        {/* Ekleme formu */}
        <section className="rounded-2xl border border-[#DDE3DC] bg-white p-5 sm:p-6">
          <div className="space-y-3">
            <div>
              <label htmlFor="ad" className="mb-1.5 block text-sm font-medium">
                Firma adı
              </label>
              <input
                id="ad"
                value={ad}
                onChange={(e) => setAd(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") ekle();
                }}
                placeholder="MİRAÇ SERACILIK TARIM ÜRÜNLERİ TİC. LTD.ŞTİ."
                className="w-full rounded-lg border border-[#DDE3DC] px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-[#B4BDB6] focus:border-[#1F5C3D] focus:ring-2 focus:ring-[#1F5C3D]/15"
              />
            </div>

            <div>
              <label htmlFor="iletisim" className="mb-1.5 block text-sm font-medium">
                İletişim <span className="font-normal text-[#5B6660]">(isteğe bağlı)</span>
              </label>
              <input
                id="iletisim"
                value={iletisim}
                onChange={(e) => setIletisim(e.target.value)}
                placeholder="Yetkili, telefon veya e-posta"
                className="w-full rounded-lg border border-[#DDE3DC] px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-[#B4BDB6] focus:border-[#1F5C3D] focus:ring-2 focus:ring-[#1F5C3D]/15"
              />
            </div>

            <button
              onClick={ekle}
              disabled={kaydediyor || ad.trim() === ""}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#1F5C3D] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#184A31] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5C3D] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
            >
              {kaydediyor ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Tedarikçi ekle
            </button>
          </div>
        </section>

        {hata && (
          <div className="mt-4 flex gap-3 rounded-xl border border-[#E9C9C6] bg-[#FDF4F3] p-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-[#B3261E]" />
            <p className="text-sm leading-relaxed text-[#7A1B15]">{hata}</p>
          </div>
        )}

        {/* Kayıtlı tedarikçiler */}
        <section className="mt-8">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-[#5B6660]">
            Kayıtlı tedarikçiler {liste.length > 0 && `(${liste.length})`}
          </h2>

          {yukleniyor ? (
            <div className="flex items-center gap-2 rounded-xl border border-[#DDE3DC] bg-white px-5 py-6 text-sm text-[#5B6660]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Yükleniyor…
            </div>
          ) : liste.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#DDE3DC] px-5 py-8 text-center">
              <Users className="mx-auto h-5 w-5 text-[#B4BDB6]" />
              <p className="mt-2 text-sm text-[#5B6660]">
                Henüz tedarikçi yok. Yukarıdan ilkini ekle.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[#DDE3DC] overflow-hidden rounded-xl border border-[#DDE3DC] bg-white">
              {liste.map((t) => (
                <li key={t.id} className="px-5 py-4">
                  <p className="text-sm font-medium">{t.name}</p>
                  {t.contact_info && (
                    <p className="mt-0.5 text-xs text-[#5B6660]">{t.contact_info}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}