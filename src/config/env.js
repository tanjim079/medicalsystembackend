import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().optional().default('5000'),
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_SECRET_KEY: z.string().min(1, 'SUPABASE_SECRET_KEY is required'),
  // Fallback if needed, though secret key is preferred for backend
  SUPABASE_ANON_KEY: z.string().optional(),
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
