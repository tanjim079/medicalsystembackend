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

// Test mock hooks for deterministic offline testing (strictly disabled in production)
let testAuthHandlers = null;
let testDbHandler = null;

export const setTestAuthHandlers = (handlers) => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Security Error: setTestAuthHandlers cannot be invoked in production.');
  }
  testAuthHandlers = handlers;
};

export const setTestDbHandler = (handler) => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Security Error: setTestDbHandler cannot be invoked in production.');
  }
  testDbHandler = handler;
};

// Wrap supabase.from for deterministic offline testing without network delays
const originalFrom = supabase.from.bind(supabase);
supabase.from = (table) => {
  if (process.env.NODE_ENV !== 'production' && testDbHandler) {
    return testDbHandler(table);
  }
  return originalFrom(table);
};

// Delegate user authentication methods to authClient so the primary DB client's
// service_role authorization header is NEVER overwritten by user session tokens
supabase.auth.signInWithPassword = async (credentials) => {
  if (process.env.NODE_ENV !== 'production' && testAuthHandlers?.signInWithPassword) {
    return testAuthHandlers.signInWithPassword(credentials);
  }
  return authClient.auth.signInWithPassword(credentials);
};

supabase.auth.signUp = async (credentials) => {
  if (process.env.NODE_ENV !== 'production' && testAuthHandlers?.signUp) {
    return testAuthHandlers.signUp(credentials);
  }
  return authClient.auth.signUp(credentials);
};

supabase.auth.refreshSession = async (params) => {
  if (process.env.NODE_ENV !== 'production' && testAuthHandlers?.refreshSession) {
    return testAuthHandlers.refreshSession(params);
  }
  return authClient.auth.refreshSession(params);
};

if (supabase.auth.admin) {
  const originalCreateUser = supabase.auth.admin.createUser?.bind(supabase.auth.admin);
  supabase.auth.admin.createUser = async (attrs) => {
    if (process.env.NODE_ENV !== 'production' && testAuthHandlers?.adminCreateUser) {
      return testAuthHandlers.adminCreateUser(attrs);
    }
    return originalCreateUser ? originalCreateUser(attrs) : { data: null, error: new Error('Not supported') };
  };
}

export default supabase;
