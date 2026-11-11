import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables from cwd, or fallback to backend directory .env
dotenv.config();
if (!process.env.SUPABASE_URL) {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
}

// In test environment, provide fallback mock credentials if none configured
if (process.env.NODE_ENV === 'test') {
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://placeholder-test-supabase.co';
  process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'placeholder-test-secret-key';
}

const envSchema = z.object({
  PORT: z.string().optional().default('5000'),
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_SECRET_KEY: z.string().min(1, 'SUPABASE_SECRET_KEY is required'),
  // Fallback if needed, though secret key is preferred for backend
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parseEnv = () => {
  try {
    return envSchema.parse(process.env);
  } catch (err) {
    console.error('❌ Invalid environment variables:', err.format());
    process.exit(1);
  }
};

export const env = parseEnv();
