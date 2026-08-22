"use client";

import { useState } from "react";
import { Upload, FileSpreadsheet, FileText, AlertTriangle, CheckCircle2, TrendingUp, TrendingDown, HelpCircle, AlertCircle, Download } from "lucide-react";
import { DenetimSatiri, manuelSecimUygula } from "@/lib/matchEngine";
import * as XLSX from "xlsx"; // EXCEL ÇIKTISI İÇİN EKLENDİ

export default function FaturaDenetim() {
  const [faturaDosyasi, setFaturaDosyasi] = useState<File | null>(null);
  const [teklifDosyasi, setTeklifDosyasi] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sonuclar, setSonuclar] = useState<DenetimSatiri[]>([]);

  // Yardımcı Formatlayıcılar
  const formatCurrency = (val: number | null) => {
    if (val === null || isNaN(val)) return "-";
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(val);
  };

  const formatPercent = (val: number | null) => {
    if (val === null || isNaN(val) || val === 0) return "";
    return `%${val.toFixed(2)}`;
  };

  // 1. API'ye İstek Atma
  const handleKarsilastir = async () => {
    if (!faturaDosyasi || !teklifDosyasi) return;
    setLoading(true);
    setErrorMsg(null);
    setSonuclar([]);

    const formData = new FormData();
    formData.append("fatura", faturaDosyasi);
    formData.append("teklif", teklifDosyasi);

    try {
      const response = await fetch("/api/compare-excel", { method: "POST", body: formData });
      const result = await response.json();

      if (!response.ok || result.error) throw new Error(result.error || "Karşılaştırma başarısız.");
      setSonuclar(result.data);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // 2. Özgür Dropdown: Her zaman değiştirilebilir Manuel Eşleştirme
  // 2. Özgür Dropdown ve Hafızaya Kayıt
  const handleManuelSecim = async (index: number, secilenUrunAdi: string) => {
    const satir = sonuclar[index];
    const secilenAday = satir.adaylar.find(a => a.teklifUrunAdi === secilenUrunAdi);
    if (!secilenAday) return;

    // Ekranda Anında Güncelle
    const guncellenmisSatir = manuelSecimUygula(satir, secilenAday);
    const yeniSonuclar = [...sonuclar];
    yeniSonuclar[index] = guncellenmisSatir;
    setSonuclar(yeniSonuclar);

    // Arka Planda Supabase'e Fısılda (Kullanıcıyı Bekletmez)
    try {
      await fetch('/api/save-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          faturaUrunAdi: satir.faturaUrunAdi,
          teklifUrunAdi: secilenUrunAdi
        })
      });
    } catch (error) {
      console.error("Öğrenen hafızaya kaydedilemedi:", error);
    }
  };

  // 3. Fiyat Farkı İtiraz Raporunu Excel Olarak İndirme
  const handleExportExcel = () => {
    const exportData = sonuclar.map(item => {
      const toplamFark = item.farkTl > 0 ? item.farkTl * item.faturaMiktar : 0;
      return {
        "Fatura Ürün Adı": item.faturaUrunAdi,
        "Miktar": item.faturaMiktar,
        "Birim": item.faturaBirim,
        "Eşleşen (Anlaşılan) Ürün": item.eslesenTeklifUrunAdi || "EŞLEŞTİRİLMEDİ",
        "Anlaşılan Fiyat (TL)": item.teklifFiyat || 0,
        "Faturadaki Kesilen Fiyat (TL)": item.faturaBirimFiyat,
        "Birim Başına Zam (TL)": item.farkTl > 0 ? item.farkTl : 0,
        "TOPLAM FAZLA KESİNTİ (TL)": toplamFark,
        "Durum": item.durum === 'aleyhte_fark' ? 'ZAMLI KESİLMİŞ' : (item.durum === 'lehte_fark' ? 'İNDİRİMLİ' : (item.durum === 'fark_yok' ? 'AYNI' : 'BELİRSİZ'))
      };
    });

    const ws = XLSX.utils.json_to_sheet(exportData);

    // Sütun Genişliklerini Ayarlama
    ws["!cols"] = [
      { wch: 30 }, { wch: 10 }, { wch: 10 }, { wch: 35 },
      { wch: 20 }, { wch: 25 }, { wch: 20 }, { wch: 25 }, { wch: 15 }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Fiyat Farkı İtirazları");

    // Dosyayı İndirt
    XLSX.writeFile(wb, `Fiyat_Farki_Itiraz_Raporu_${new Date().toLocaleDateString('tr-TR')}.xlsx`);
  };

  // Durum Renklendirmeleri
  const renderDurumBadge = (durum: DenetimSatiri["durum"]) => {
    switch (durum) {
      case "aleyhte_fark": return <span className="flex items-center gap-1 bg-red-100 text-red-700 px-2 py-1 rounded text-xs font-bold"><TrendingUp size={14} /> ZAMLI</span>;
      case "lehte_fark": return <span className="flex items-center gap-1 bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-bold"><TrendingDown size={14} /> UCUZLAMIŞ</span>;
      case "fark_yok": return <span className="flex items-center gap-1 bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs font-bold"><CheckCircle2 size={14} /> AYNI</span>;
      case "supheli_eslesme": return <span className="flex items-center gap-1 bg-orange-100 text-orange-700 px-2 py-1 rounded text-xs font-bold"><AlertTriangle size={14} /> ONAY BEKLİYOR</span>;
      case "eslesme_yok": return <span className="flex items-center gap-1 bg-slate-200 text-slate-700 px-2 py-1 rounded text-xs font-bold"><HelpCircle size={14} /> BULUNAMADI</span>;
      default: return null;
    }
  };

  const toplamZarar = sonuclar.filter(s => s.farkTl > 0).reduce((acc, curr) => acc + (curr.farkTl * curr.faturaMiktar), 0);

  return (
    <main className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Yükleme Modülü */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Fatura vs. Fiyat Listesi Denetimi</h1>
          <p className="text-slate-500 mb-6 text-sm">Faturanızı ve Fiyat Listenizi (Excel) yükleyin. Sistem gizli zamları tespit etsin.</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="border-2 border-dashed border-blue-200 bg-blue-50/50 rounded-lg p-6 text-center">
              <FileSpreadsheet className="text-blue-500 mb-3 mx-auto" size={32} />
              <label className="block text-sm font-medium text-slate-700 mb-2">1. Fatura Yükle (Excel)</label>
              <input type="file" accept=".xlsx, .xls" onChange={(e) => setFaturaDosyasi(e.target.files?.[0] || null)} className="block w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700" />
            </div>

            <div className="border-2 border-dashed border-emerald-200 bg-emerald-50/50 rounded-lg p-6 text-center">
              <FileText className="text-emerald-500 mb-3 mx-auto" size={32} />
              <label className="block text-sm font-medium text-slate-700 mb-2">2. Fiyat Listesi Yükle (Excel)</label>
              <input type="file" accept=".xlsx, .xls" onChange={(e) => setTeklifDosyasi(e.target.files?.[0] || null)} className="block w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:font-semibold file:bg-emerald-600 file:text-white hover:file:bg-emerald-700" />
            </div>
          </div>

          {errorMsg && (
            <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-md border border-red-200 flex items-center gap-2">
              <AlertCircle size={18} /><span>{errorMsg}</span>
            </div>
          )}

          <div className="mt-6 flex justify-end">
            <button onClick={handleKarsilastir} disabled={!faturaDosyasi || !teklifDosyasi || loading} className="flex items-center gap-2 bg-slate-800 text-white px-8 py-3 rounded-md font-medium hover:bg-slate-900 disabled:opacity-50">
              {loading ? "Karşılaştırılıyor..." : <><Upload size={18} /> Karşılaştırmayı Başlat</>}
            </button>
          </div>
        </div>

        {/* Sonuçlar ve CFO Özeti */}
        {sonuclar.length > 0 && (
          <div className="space-y-4">

            {/* CFO Dashboard Kartları ve Export Butonu */}
            <div className="flex flex-col md:flex-row gap-4 items-stretch">
              <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col">
                  <span className="text-sm font-medium text-slate-500">İncelenen Kalem</span>
                  <span className="text-2xl font-bold text-slate-800">{sonuclar.length} Ürün</span>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col">
                  <span className="text-sm font-medium text-slate-500">Müdahale Bekleyen</span>
                  <span className="text-2xl font-bold text-orange-600">{sonuclar.filter(s => s.durum === 'supheli_eslesme' || s.durum === 'eslesme_yok').length} Ürün</span>
                </div>
                <div className="bg-red-50 p-4 rounded-xl border border-red-200 shadow-sm flex flex-col">
                  <span className="text-sm font-medium text-red-600">Faturadaki Toplam Zarar</span>
                  <span className="text-2xl font-bold text-red-700">{formatCurrency(toplamZarar)}</span>
                </div>
              </div>

              {/* İtiraz Raporu İndir Butonu */}
              <button
                onClick={handleExportExcel}
                className="flex items-center justify-center gap-2 bg-emerald-600 text-white px-6 py-4 rounded-xl font-bold shadow-sm hover:bg-emerald-700 transition-colors"
              >
                <Download size={24} />
                <span className="text-left leading-tight">İtiraz Raporunu<br />Excel İndir</span>
              </button>
            </div>

            {/* Ana Tablo */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3">Fatura Ürün Adı</th>
                      <th className="px-4 py-3">Miktar</th>
                      <th className="px-4 py-3">Eşleşen (Teklif) Ürün</th>
                      <th className="px-4 py-3 text-right">Teklif Fiyatı</th>
                      <th className="px-4 py-3 text-right">Fatura Fiyatı</th>
                      <th className="px-4 py-3 text-right">Birim Farkı</th>
                      <th className="px-4 py-3 text-center">Durum</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sonuclar.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-800">{item.faturaUrunAdi}</td>
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{item.faturaMiktar} {item.faturaBirim}</td>

                        {/* ÖZGÜR DROPDOWN: Her zaman açık ve düzenlenebilir */}
                        <td className="px-4 py-3 min-w-[250px]">
                          <select
                            className={`w-full text-xs border rounded p-2 outline-none focus:ring-1 ${item.durum === 'eslesme_yok' || item.durum === 'supheli_eslesme'
                              ? 'border-orange-300 bg-orange-50 text-orange-800 focus:ring-orange-500'
                              : 'border-slate-200 bg-transparent text-slate-700 focus:ring-slate-500'
                              }`}
                            value={item.eslesenTeklifUrunAdi || ""}
                            onChange={(e) => handleManuelSecim(idx, e.target.value)}
                          >
                            <option value="" disabled>Doğru Ürünü Seçin (Eşleşme Yok)...</option>
                            {item.adaylar.map(aday => (
                              <option key={aday.teklifUrunAdi} value={aday.teklifUrunAdi}>
                                {aday.teklifUrunAdi} ({formatCurrency(aday.teklifFiyat)}) - %{aday.skor} Benzerlik
                              </option>
                            ))}
                          </select>
                        </td>

                        <td className="px-4 py-3 text-right text-slate-600">{formatCurrency(item.teklifFiyat)}</td>
                        <td className="px-4 py-3 text-right font-medium text-slate-800">{formatCurrency(item.faturaBirimFiyat)}</td>

                        <td className={`px-4 py-3 text-right font-bold whitespace-nowrap ${item.farkTl > 0 ? 'text-red-600' : item.farkTl < 0 ? 'text-green-600' : 'text-slate-400'}`}>
                          {item.farkTl > 0 ? "+" : ""}{item.farkTl === 0 ? "-" : formatCurrency(item.farkTl)}
                          {item.farkYuzde !== 0 && <span className="block text-[10px] opacity-75">{formatPercent(item.farkYuzde)}</span>}
                        </td>

                        <td className="px-4 py-3 flex justify-center">
                          {renderDurumBadge(item.durum)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}