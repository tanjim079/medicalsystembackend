import { z } from 'zod';

export const signupSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(6, 'Password must be at least 6 characters long'),
    name: z.string().min(2, 'Name is required'),
    role: z.enum(['patient', 'doctor', 'admin', 'pharmacist', 'pathologist', 'staff', 'student', 'teacher'], {
      required_error: 'Role is required',
      invalid_type_error: 'Invalid role type',
    }),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
  }),
});
