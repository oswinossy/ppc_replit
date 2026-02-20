import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables');
}

// Capture invite flow from URL hash BEFORE createClient() processes and clears it.
// Supabase's GoTrueClient only fires PASSWORD_RECOVERY for type=recovery.
// For type=invite it fires SIGNED_IN, making invites indistinguishable from
// normal logins. We sniff the hash here and persist a flag in sessionStorage
// so AuthContext and AuthCallbackPage can detect the invite flow.
if (typeof window !== 'undefined' && window.location.hash) {
  try {
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    if (hashParams.get('type') === 'invite') {
      sessionStorage.setItem('passwordSetupRequired', 'true');
    }
  } catch {
    // hash is not a valid query string, ignore
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
