import { createClient } from '@supabase/supabase-js';

// Retrieve Supabase environment variables from either Web-Vite format or Native-Expo format fallbacks
const SUPABASE_URL = (((import.meta as any).env)?.VITE_SUPABASE_URL || process.env?.EXPO_PUBLIC_SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = (((import.meta as any).env)?.VITE_SUPABASE_ANON_KEY || process.env?.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();

let hasLoggedWarning = false;

// Custom robust mock interface matching the basic supabase-js CRUD signatures
const createMockSupabaseClient = () => {
  if (!hasLoggedWarning) {
    console.warn(
      "⚠️ Cirkel Warning: Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY keys. Enabling safe client-side offline mock database emulator."
    );
    hasLoggedWarning = true;
  }

  // Returns chainable offline helper
  const chain = {
    select: () => chain,
    insert: () => Promise.resolve({ data: [], error: null }),
    update: () => Promise.resolve({ data: [], error: null }),
    delete: () => Promise.resolve({ data: [], error: null }),
    eq: () => chain,
    neq: () => chain,
    single: () => Promise.resolve({ data: null, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    order: () => chain,
    limit: () => chain,
    range: () => chain,
  };

  return {
    from: () => chain,
    auth: {
      signUp: () => Promise.resolve({ data: { user: null }, error: null }),
      signInWithPassword: () => Promise.resolve({ data: { user: null }, error: null }),
      signOut: () => Promise.resolve({ error: null }),
      onAuthStateChange: (cb: any) => {
        // Return unsubscribe dummy
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
    },
    storage: {
      from: () => ({
        upload: () => Promise.resolve({ data: null, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: '' } }),
      }),
    },
  } as any;
};

// Export active or mock client
export const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : createMockSupabaseClient();
