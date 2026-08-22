import { createClient } from '@supabase/supabase-js'

// Vercel build esnasında şifreleri bulamazsa çökmemesi için geçici (dummy) anahtarlar veriyoruz.
// Kullanıcı canlıda siteye girdiğinde ise zaten gerçek şifreleri okuyacak.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dummy.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'dummy-key-to-bypass-vercel-build-error'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)