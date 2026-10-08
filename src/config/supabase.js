import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { env } from './env.js';

// We now use the guaranteed environment variables from env.js
const supabaseUrl = env.SUPABASE_URL;
const supabaseKey = env.SUPABASE_SECRET_KEY; // Using secret key for admin privileges

const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: {
    transport: ws,
  }
});

export default supabase;
