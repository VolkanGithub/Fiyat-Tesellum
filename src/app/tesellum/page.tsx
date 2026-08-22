"use client";

import { useState } from "react";
import { AlertTriangle, Upload, CheckCircle2, TrendingUp, TrendingDown, HelpCircle, Edit } from "lucide-react";

// ============================================================================
// DEFANSİF KALKAN 1: Tam Tip Güvenliği (TypeScript Interface)
// Arka uçtan ne geleceğini kesin bir dille tanımlıyoruz.
// ============================================================================
interface TesellumItem {
  stokKodu: string;
  stokAdi: string;
  miktar: number;
  birim: string;
  alisFiyati: number;
  oncekiFiyat: number | null;
  farkTl: number;
  farkYuzde: number;
  durum: "aleyhte_fark" | "lehte_fark" | "fark_yok" | "eksik_veri" | "yeni_urun";
}

export default function TesellumAnaliz() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<TesellumItem[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ============================================================================
  // DEFANSİF KALKAN 2: Çökmeyen Formatlayıcılar
  // Değer undefined, null veya NaN gelse bile sayfayı çökertmez, "-" basar.
  // ============================================================================
  const formatCurrency = (value: number | null | undefined) => {
    if (typeof value !== "number" || isNaN(value)) return "-";
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(value);
  };

  const formatPercent = (value: number | null | undefined) => {
    if (typeof value !== "number" || isNaN(value)) return "-";
    return `%${value.toFixed(2)}`;
  };

  // ============================================================================
  // DURUM (BADGE) YÖNETİCİSİ: Görsel hiyerarşi oluşturur
  // ============================================================================
  const renderDurumBadge = (durum: TesellumItem["durum"]) => {
    switch (durum) {
      case "aleyhte_fark":
        return <span className="flex items-center gap-1 bg-red-100 text-red-700 px-2 py-1 rounded-md text-xs font-bold"><TrendingUp size={14} /> ZAMLI</span>;
      case "lehte_fark":
        return <span className="flex items-center gap-1 bg-green-100 text-green-700 px-2 py-1 rounded-md text-xs font-bold"><TrendingDown size={14} /> UCUZLAMIŞ</span>;
      case "fark_yok":
        return <span className="flex items-center gap-1 bg-slate-100 text-slate-600 px-2 py-1 rounded-md text-xs font-bold"><CheckCircle2 size={14} /> AYNI FİYAT</span>;
      case "yeni_urun":
        return <span className="flex items-center gap-1 bg-blue-100 text-blue-700 px-2 py-1 rounded-md text-xs font-bold"><HelpCircle size={14} /> YENİ ÜRÜN</span>;
      case "eksik_veri":
        return <span className="flex items-center gap-1 bg-orange-100 text-orange-700 px-2 py-1 rounded-md text-xs font-bold"><AlertTriangle size={14} /> DİKKAT</span>;
      default:
        return <span className="bg-gray-100 text-gray-500 px-2 py-1 rounded-md text-xs font-bold">BİLİNMİYOR</span>;
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    setFile(selectedFile);
  };

  const analyzePDF = async () => {
    if (!file) return;
    setLoading(true);
    setErrorMsg(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/read-pdf", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok || result.error) {
        throw new Error(result.error || "Sunucu hatası oluştu.");
      }

      setItems(result.data || []);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setErrorMsg(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Manuel Düzeltme butonuna tıklandığında çalışacak taslak fonksiyon
  const handleManuelDuzelt = (stokKodu: string) => {
    alert(`${stokKodu} kodlu ürün için manuel eşleştirme / birim çevrim ekranı açılacak.`);
    // Bir sonraki adımda buraya Modal (Açılır Pencere) bağlayacağız.
  };

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Başlık ve Yükleme Alanı */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Tesellüm Fişi Zırhlı Analiz (Şeffaf Mimari)</h1>
          <p className="text-slate-500 mb-6 text-sm">ElektraWeb PDF fişini yükleyin. Hiçbir veri gizlenmeyecek, kontrol daima sizde olacak.</p>

          <div className="flex items-center gap-4">
            <input
              type="file"
              accept=".xlsx, .xls"
              onClick={(e) => (e.currentTarget.value = "")}
              onChange={handleFileUpload}
              className="block w-full max-w-sm text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 transition-colors"
            />
            <button
              onClick={analyzePDF}
              disabled={!file || loading}
              className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded-md font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? "Analiz Ediliyor..." : <><Upload size={18} /> Fişi Okut</>}
            </button>
          </div>

          {errorMsg && (
            <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-md border border-red-200 flex items-center gap-2">
              <AlertTriangle size={18} />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Sonuç Tablosu */}
        {items.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <h2 className="font-semibold text-slate-700">Okunan Ürünler ({items.length})</h2>
              <span className="text-xs font-medium bg-red-100 text-red-700 px-3 py-1 rounded-full">
                {items.filter(i => i.durum === 'aleyhte_fark').length} Zamlı Ürün Bulundu
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Stok Kodu</th>
                    <th className="px-4 py-3">Stok Adı</th>
                    <th className="px-4 py-3">Miktar / Birim</th>
                    <th className="px-4 py-3 text-right">Önceki Fiyat</th>
                    <th className="px-4 py-3 text-right">Yeni Fiyat</th>
                    <th className="px-4 py-3 text-right">Fark (TL)</th>
                    <th className="px-4 py-3 text-center">Durum</th>
                    <th className="px-4 py-3 text-center">Aksiyon</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-600">{item.stokKodu}</td>
                      <td className="px-4 py-3 text-slate-800">{item.stokAdi}</td>
                      <td className="px-4 py-3 text-slate-600">{item.miktar} {item.birim}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(item.oncekiFiyat)}</td>
                      <td className="px-4 py-3 text-right font-medium text-slate-800">{formatCurrency(item.alisFiyati)}</td>

                      {/* Fark TL Sütunu */}
                      <td className={`px-4 py-3 text-right font-bold ${item.farkTl > 0 ? 'text-red-600' : item.farkTl < 0 ? 'text-green-600' : 'text-slate-400'}`}>
                        {item.farkTl > 0 ? "+" : ""}{item.farkTl === 0 ? "-" : formatCurrency(item.farkTl)}
                        {item.farkYuzde !== 0 && (
                          <span className="block text-[10px] opacity-75">{formatPercent(item.farkYuzde)}</span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-center">
                        {renderDurumBadge(item.durum)}
                      </td>

                      <td className="px-4 py-3 text-center">
                        {/* Eğer ürün eksik veri veya yeni ürün ise "Manuel Düzelt" butonu göster */}
                        {(item.durum === 'eksik_veri' || item.durum === 'yeni_urun' || item.birim === 'Koli' || item.birim === 'Kutu') ? (
                          <button
                            onClick={() => handleManuelDuzelt(item.stokKodu)}
                            className="inline-flex items-center gap-1 px-3 py-1 bg-white border border-slate-300 text-slate-700 rounded shadow-sm hover:bg-slate-50 hover:text-blue-600 transition-colors text-xs font-medium"
                          >
                            <Edit size={14} /> Düzelt
                          </button>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}