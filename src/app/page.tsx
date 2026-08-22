// ============================================================
//  src/app/page.tsx
//  Ana sayfa: iş akışı sırasına göre menü
// ============================================================
import Link from "next/link";
import type { ComponentType } from "react";
import {
  ArrowRight,
  Boxes,
  ClipboardCheck,
  FileSpreadsheet,
  ReceiptText,
  Scale,
  Users,
} from "lucide-react";

// Sıra numaraları süs değil: her adım bir öncekine bağımlı.
// Fiyat listesi yüklemeden fatura denetleyemezsin, master ürün
// olmadan fiyat listesini eşleştiremezsin.

const AKTIF_KART =
  "group flex items-start gap-4 rounded-2xl border border-[#DDE3DC] bg-white p-5 transition-colors hover:border-[#1F5C3D] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5C3D] focus-visible:ring-offset-2";

function AdimIcerik({
  no,
  Ikon,
  baslik,
  aciklama,
  pasif = false,
}: {
  no: number;
  Ikon: ComponentType<{ className?: string }>;
  baslik: string;
  aciklama: string;
  pasif?: boolean;
}) {
  return (
    <>
      <span
        className={
          pasif
            ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#DDE3DC] text-sm font-semibold tabular-nums text-[#9AA69E]"
            : "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#1F5C3D] text-sm font-semibold tabular-nums text-white"
        }
      >
        {no}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <Ikon className={pasif ? "h-4 w-4 text-[#9AA69E]" : "h-4 w-4 text-[#1F5C3D]"} />
          <span className={pasif ? "font-medium text-[#5B6660]" : "font-medium"}>
            {baslik}
          </span>
          {pasif && (
            <span className="rounded-full bg-[#F5EEDA] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#8A6D12]">
              Yakında
            </span>
          )}
        </span>
        <span
          className={
            pasif
              ? "mt-1 block text-sm leading-relaxed text-[#9AA69E]"
              : "mt-1 block text-sm leading-relaxed text-[#5B6660]"
          }
        >
          {aciklama}
        </span>
      </span>
    </>
  );
}

const OK =
  "mt-1 h-4 w-4 shrink-0 text-[#C6D0C6] transition-colors group-hover:text-[#1F5C3D]";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#F7F8F6] text-[#0F1A14]">
      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
        <header className="mb-10">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#5B6660]">
            Longosphere
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Fiyat Farkı Kontrol Sistemi
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-[#5B6660]">
            Tedarikçi faturalarındaki birim fiyatları fiyat listesiyle karşılaştırır,
            aleyhe farkları ve iade edilecek tutarı hesaplar.
          </p>
        </header>

        <ol className="space-y-3">
          {/* 1 — hazır */}
          <li>
            <Link href="/import" className={AKTIF_KART}>
              <AdimIcerik
                no={1}
                Ikon={Boxes}
                baslik="Stok kartları"
                aciklama="ElektraWeb stok listesini master ürün tablosuna aktar."
              />
              <ArrowRight className={OK} />
            </Link>
          </li>

          {/* 2 — hazır */}
          <li>
            <Link href="/tedarikciler" className={AKTIF_KART}>
              <AdimIcerik
                no={2}
                Ikon={Users}
                baslik="Tedarikçiler"
                aciklama="Fiyat listesi ve fatura yükleyeceğin firmaları tanımla."
              />
              <ArrowRight className={OK} />
            </Link>
          </li>

          {/* 3 — hazır */}
          <li>
            <Link href="/fiyat-listeleri" className={AKTIF_KART}>
              <AdimIcerik
                no={3}
                Ikon={FileSpreadsheet}
                baslik="Fiyat listeleri"
                aciklama="Tedarikçinin Excel listesini yükle. Denetimde bu listelerden bir veya birkaçını seçeceksin."
              />
              <ArrowRight className={OK} />
            </Link>
          </li>

          {/* 4 — hazır */}
          <li>
            <Link href="/faturalar" className={AKTIF_KART}>
              <AdimIcerik
                no={4}
                Ikon={ReceiptText}
                baslik="Faturalar"
                aciklama="ElektraWeb fatura export'unu yükle, satırları master ürünlere bağla."
              />
              <ArrowRight className={OK} />
            </Link>
          </li>

          {/* 5 — hazır */}
          <li>
            <Link href="/denetim" className={AKTIF_KART}>
              <AdimIcerik
                no={5}
                Ikon={Scale}
                baslik="Fiyat farkı denetimi"
                aciklama="Fatura birim fiyatlarını seçtiğin listelerle kıyasla, aleyhe farkları hesapla, iade raporunu üret."
              />
              <ArrowRight className={OK} />
            </Link>
          </li>
        </ol>

        <section className="mt-10">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-[#5B6660]">
            Diğer ekranlar
          </h2>
          <Link
            href="/tesellum"
            className="group flex items-center gap-3 rounded-xl border border-[#DDE3DC] bg-white px-5 py-4 transition-colors hover:border-[#1F5C3D] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1F5C3D] focus-visible:ring-offset-2"
          >
            <ClipboardCheck className="h-4 w-4 shrink-0 text-[#1F5C3D]" />
            <span className="flex-1 text-sm font-medium">Tesellüm</span>
            <ArrowRight className="h-4 w-4 text-[#C6D0C6] transition-colors group-hover:text-[#1F5C3D]" />
          </Link>
        </section>
      </div>
    </main>
  );
}