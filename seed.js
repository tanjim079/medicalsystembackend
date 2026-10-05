import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import ws from 'ws';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: ws } }
);

const createDoc = async (email, password, name) => {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, role: 'doctor' }
  });
  if (error) console.error(error.message);
  else console.log('Created:', data.user.email);
};

await createDoc('doc001@ruet.ac.bd', 'password123', 'Dr. Md. Azizul Islam');
await createDoc('doc002@ruet.ac.bd', 'password123', 'Dr. Farhana Rahman');
