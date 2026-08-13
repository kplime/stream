import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

// When env vars are missing (teammate's table isn't ready yet / offline demo),
// callers check `isSupabaseConfigured` and fall back to mock data instead of
// calling this client.
export const supabase = isSupabaseConfigured ? createClient(url!, anonKey!) : null
