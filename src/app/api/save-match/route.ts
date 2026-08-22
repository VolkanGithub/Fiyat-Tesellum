export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(request: Request) {
  try {
    const { faturaUrunAdi, teklifUrunAdi } = await request.json();

    if (!faturaUrunAdi || !teklifUrunAdi) {
      return NextResponse.json({ error: 'Eksik veri' }, { status: 400 });
    }

    // Upsert: Eğer bu ürün daha önce kaydedilmişse yeni seçimi üstüne yazar (günceller), yoksa sıfırdan ekler.
    const { error } = await supabase
      .from('eslesme_hafizasi')
      .upsert(
        { fatura_urun_adi: faturaUrunAdi, teklif_urun_adi: teklifUrunAdi },
        { onConflict: 'fatura_urun_adi' }
      );

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Veritabanı hatası';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}