import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import ws from 'ws';
import fs from 'fs';
import path from 'path';

dotenv.config();

let supabaseUrl = process.env.SUPABASE_URL;
let supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY;

try {
  const envContent = fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf-8');
  const envUrl = envContent.match(/SUPABASE_URL=(.*)/)?.[1]?.trim();
  const envSecret = envContent.match(/SUPABASE_SECRET_KEY=(.*)/)?.[1]?.trim();
  if (envUrl) supabaseUrl = envUrl;
  if (envSecret) supabaseKey = envSecret;
} catch (e) {
  console.log('Error reading .env manually', e);
}

if (!supabaseUrl || !supabaseKey) {
  console.warn('Supabase URL or Key is missing from environment variables.');
}

const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseKey || 'placeholder-key', {
  realtime: {
    transport: ws,
  }
});

export default supabase;
