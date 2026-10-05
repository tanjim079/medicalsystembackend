import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

let supabaseUrl = process.env.SUPABASE_URL;
let supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SECRET_KEY;

try {
  const envContent = fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf-8');
  const envUrl = envContent.match(/SUPABASE_URL=(.*)/)?.[1]?.trim();
  const envKey = envContent.match(/SUPABASE_PUBLISHABLE_KEY=(.*)/)?.[1]?.trim();
  if (envUrl) supabaseUrl = envUrl;
  if (envKey) supabaseKey = envKey;
} catch (e) {
  console.log('Error reading .env manually', e);
}

import ws from 'ws';

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  realtime: { transport: ws },
});

async function seedStaff() {
  const staff = [
    {
      email: 'admin@ruet.ac.bd',
      password: 'adminpassword123',
      name: 'System Administrator',
      role: 'admin'
    }
  ];

  for (const s of staff) {
    console.log(`Creating user: ${s.email} (${s.role})...`);
    // We use signUp instead of admin.createUser because the secret key format
    // is not a standard JWT service_role key, so admin API rejects it.
    // Since the database ENUM is now updated, signUp will succeed!
    const { data, error } = await supabase.auth.signUp({
      email: s.email,
      password: s.password,
      options: {
        data: {
          name: s.name,
          role: s.role
        }
      }
    });

    if (error) {
      console.error(`Error creating ${s.email}:`, error);
    } else {
      console.log(`Successfully created ${s.email} with ID: ${data.user.id}`);
    }
  }
}

seedStaff();
