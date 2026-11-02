import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { env } from './env.js';

// Polyfill global WebSocket for Node.js environments (< Node 22)
if (!globalThis.WebSocket) {
  globalThis.WebSocket = ws;
}

// We now use the guaranteed environment variables from env.js
const supabaseUrl = env.SUPABASE_URL;
const supabaseKey = env.SUPABASE_SECRET_KEY; // Using secret key for admin privileges
const pubKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || env.SUPABASE_SECRET_KEY;

// Dedicated service_role client for database operations (bypasses RLS)
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  realtime: {
    transport: ws,
  }
});

// Dedicated isolated client for user authentication operations (sign-in, sign-up, refresh)
export const authClient = createClient(supabaseUrl, pubKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  realtime: {
    transport: ws,
  }
});

// Delegate user authentication methods to authClient so the primary DB client's
// service_role authorization header is NEVER overwritten by user session tokens
supabase.auth.signInWithPassword = (credentials) => authClient.auth.signInWithPassword(credentials);
supabase.auth.signUp = (credentials) => authClient.auth.signUp(credentials);
supabase.auth.refreshSession = (params) => authClient.auth.refreshSession(params);

export default supabase;
