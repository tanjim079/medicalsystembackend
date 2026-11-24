import { z } from 'zod';
import supabase from '../config/supabase.js';
import { logger } from '../config/logger.js';
import { invalidateUserRole } from '../services/authService.js';

// Account types the admin UI can assign. Some are presentation-level account types
// (student, officer) that are stored as `patient` in the public.profiles `user_role` enum.
export const ACCOUNT_TYPES = [
  'student', 'teacher', 'officer', 'patient',
  'doctor', 'receptionist', 'pathologist', 'pharmacist', 'staff', 'admin'
];

const PROFILE_ROLE_MAP = {
  student: 'patient',
  officer: 'patient',
  patient: 'patient'
};

export const PATIENT_ACCOUNT_TYPES = ['student', 'teacher', 'officer', 'patient'];

export const toProfileRole = (accountType) => PROFILE_ROLE_MAP[accountType] || accountType;

const BAN_FOREVER = '876000h'; // ~100 years

const optionalText = z.union([z.string(), z.number()]).optional().nullable()
  .transform((v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim()));

const patientDataSchema = z.object({
  universityId: optionalText,
  phone: optionalText,
  bloodGroup: optionalText,
  guardianName: optionalText,
  guardianPhone: optionalText,
  department: optionalText,
  age: optionalText
}).partial().optional().nullable();

const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  email: z.string().trim().toLowerCase().email('A valid email address is required'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  role: z.enum(ACCOUNT_TYPES, { message: 'Invalid role' }),
  patientData: patientDataSchema
});

const updateUserSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120).optional(),
  email: z.string().trim().toLowerCase().email('A valid email address is required').optional(),
  password: z.string().max(128).optional().transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || v.length >= 8, 'Password must be at least 8 characters'),
  role: z.enum(ACCOUNT_TYPES, { message: 'Invalid role' }).optional(),
  patientData: patientDataSchema
});

const formatZodError = (err) => ({
  error: 'Validation Error',
  details: (err.issues || []).map((i) => ({ field: i.path.join('.'), message: i.message }))
});

const isSelf = (req, id) => req.user?.id && String(req.user.id) === String(id);

const buildPatientRow = (id, patientData) => {
  const ageNum = patientData?.age != null ? parseInt(patientData.age, 10) : null;
  return {
    id,
    roll_number: patientData?.universityId ?? null,
    phone: patientData?.phone ?? null,
    blood_group: patientData?.bloodGroup ?? null,
    guardian_name: patientData?.guardianName ?? null,
    guardian_phone: patientData?.guardianPhone ?? null,
    department: patientData?.department ?? null,
    age: Number.isFinite(ageNum) ? ageNum : null
  };
};

/**
 * Loads auth-level metadata (account type, ban status, last sign-in) for all users.
 * Returns an empty map if the Auth admin API is unavailable so listing still works.
 */
const loadAuthUsers = async () => {
  const map = new Map();
  if (typeof supabase.auth?.admin?.listUsers !== 'function') return map;
  try {
    const perPage = 1000;
    for (let page = 1; page <= 20; page += 1) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      const batch = data?.users || [];
      batch.forEach((u) => map.set(u.id, u));
      if (batch.length < perPage) break;
    }
  } catch (err) {
    logger.warn(`[Users] Could not load auth user metadata: ${err.message}`);
  }
  return map;
};

const isBanned = (authUser) =>
  Boolean(authUser?.banned_until && new Date(authUser.banned_until).getTime() > Date.now());

const shapeUser = (profile, authUser) => {
  const patient = Array.isArray(profile.patients) ? profile.patients[0] : profile.patients;
  const accountType = String(authUser?.user_metadata?.role || profile.role || '').toLowerCase();
  return {
    ...profile,
    patients: patient || null,
    accountType: ACCOUNT_TYPES.includes(accountType) ? accountType : profile.role,
    status: isBanned(authUser) ? 'disabled' : 'active',
    lastSignInAt: authUser?.last_sign_in_at || null,
    emailConfirmed: authUser ? Boolean(authUser.email_confirmed_at) : null
  };
};

// @desc    Get all users or filter by role
// @route   GET /api/users?role=doctor
// @access  Admin
export const getUsers = async (req, res) => {
  try {
    let query = supabase.from('profiles').select('*, patients(*)');

    if (req.query.role) {
      const requested = String(req.query.role).toLowerCase();
      if (!ACCOUNT_TYPES.includes(requested)) {
        return res.status(400).json({ error: 'Invalid role filter' });
      }
      query = query.eq('role', toProfileRole(requested));
    }

    query = query.order('name', { ascending: true });

    const [{ data, error }, authUsers] = await Promise.all([query, loadAuthUsers()]);
    if (error) throw error;

    res.status(200).json((data || []).map((p) => shapeUser(p, authUsers.get(p.id))));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Get single user
// @route   GET /api/users/:id
// @access  Admin
export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.from('profiles').select('*, patients(*)').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'User not found' });

    let authUser = null;
    if (typeof supabase.auth?.admin?.getUserById === 'function') {
      const { data: authData } = await supabase.auth.admin.getUserById(id);
      authUser = authData?.user || null;
    }
    res.status(200).json(shapeUser(data, authUser));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// @desc    Create user
// @route   POST /api/users
// @access  Admin
export const createUser = async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));

  const { email, password, role, name, patientData } = parsed.data;
  const profileRole = toProfileRole(role);

  try {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role }
    });
    if (error) {
      const status = /already|registered|exists/i.test(error.message) ? 409 : 400;
      return res.status(status).json({ error: error.message });
    }

    const userId = data.user.id;

    // Profiles may be created by a database trigger; upsert keeps role/name authoritative either way.
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({ id: userId, email, name, role: profileRole });

    if (profileError) {
      // Roll back the auth account so we never leave an orphaned login without a profile/role.
      logger.error(`[Users] Profile creation failed for ${userId}: ${profileError.message}`);
      await supabase.auth.admin.deleteUser(userId).catch(() => {});
      return res.status(400).json({ error: `Could not create profile: ${profileError.message}` });
    }

    let patientWarning = null;
    if (patientData && PATIENT_ACCOUNT_TYPES.includes(role)) {
      const { error: patientError } = await supabase.from('patients').upsert(buildPatientRow(userId, patientData));
      if (patientError) {
        patientWarning = `User created but patient details were not saved: ${patientError.message}`;
        logger.warn(`[Users] ${patientWarning}`);
      }
    }

    invalidateUserRole(userId);

    res.status(201).json({
      id: userId,
      email,
      name,
      role: profileRole,
      accountType: role,
      status: 'active',
      created_at: data.user.created_at || new Date().toISOString(),
      patients: patientData && PATIENT_ACCOUNT_TYPES.includes(role) && !patientWarning
        ? buildPatientRow(userId, patientData)
        : null,
      ...(patientWarning ? { warning: patientWarning } : {})
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// @desc    Update user
// @route   PUT /api/users/:id
// @access  Admin
export const updateUser = async (req, res) => {
  const parsed = updateUserSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json(formatZodError(parsed.error));

  const { id } = req.params;
  const { email, password, role, name, patientData } = parsed.data;

  if (isSelf(req, id) && role && role !== 'admin') {
    return res.status(400).json({ error: 'You cannot remove your own administrator role' });
  }

  try {
    const updateData = {};
    if (email) updateData.email = email;
    if (password) updateData.password = password;
    if (name || role) {
      updateData.user_metadata = {};
      if (name) updateData.user_metadata.name = name;
      if (role) updateData.user_metadata.role = role;
    }

    if (Object.keys(updateData).length > 0) {
      const { error: authError } = await supabase.auth.admin.updateUserById(id, updateData);
      if (authError) throw authError;
    }

    const profileUpdate = {};
    if (name) profileUpdate.name = name;
    if (role) profileUpdate.role = toProfileRole(role);
    if (email) profileUpdate.email = email;

    if (Object.keys(profileUpdate).length > 0) {
      const { error: profileError } = await supabase.from('profiles').update(profileUpdate).eq('id', id);
      if (profileError) throw profileError;
    }

    const effectiveRole = role || null;
    if (patientData && (!effectiveRole || PATIENT_ACCOUNT_TYPES.includes(effectiveRole))) {
      const { error: patientError } = await supabase.from('patients').upsert(buildPatientRow(id, patientData));
      if (patientError) throw patientError;
    }

    // Explicit cache invalidation on role or account update
    invalidateUserRole(id);

    res.status(200).json({
      id,
      ...profileUpdate,
      ...(role ? { accountType: role } : {}),
      ...(patientData ? { patients: buildPatientRow(id, patientData) } : {})
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// @desc    Enable / disable a user account
// @route   PATCH /api/users/:id/status   { active: boolean }
// @access  Admin
export const setUserStatus = async (req, res) => {
  const { id } = req.params;
  const active = req.body?.active;
  if (typeof active !== 'boolean') {
    return res.status(400).json({ error: '`active` must be a boolean' });
  }
  if (isSelf(req, id) && !active) {
    return res.status(400).json({ error: 'You cannot disable your own account' });
  }

  try {
    const { error } = await supabase.auth.admin.updateUserById(id, {
      ban_duration: active ? 'none' : BAN_FOREVER
    });
    if (error) throw error;
    invalidateUserRole(id);
    res.status(200).json({ id, status: active ? 'active' : 'disabled' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// @desc    Reset a user's password
// @route   PUT /api/users/:id/password   { password }
// @access  Admin
export const resetUserPassword = async (req, res) => {
  const { id } = req.params;
  const password = req.body?.password;
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'Password must be between 8 and 128 characters' });
  }
  try {
    const { error } = await supabase.auth.admin.updateUserById(id, { password });
    if (error) throw error;
    res.status(200).json({ id, message: 'Password updated successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// @desc    Delete user
// @route   DELETE /api/users/:id
// @access  Admin
export const deleteUser = async (req, res) => {
  const { id } = req.params;
  if (isSelf(req, id)) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }

  try {
    // Remove dependent rows first so FK constraints don't block profile removal.
    await Promise.allSettled([
      supabase.from('patients').delete().eq('id', id),
      supabase.from('teachers').delete().eq('id', id)
    ]);
    const { error: profileError } = await supabase.from('profiles').delete().eq('id', id);
    if (profileError) logger.warn(`[Users] Profile delete for ${id} reported: ${profileError.message}`);

    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) throw error;

    // Explicit cache invalidation on account deletion
    invalidateUserRole(id);

    res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
