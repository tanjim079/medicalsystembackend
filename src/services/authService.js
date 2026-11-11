import supabase from '../config/supabase.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

// Allowed signing algorithms (asymmetric preferred, symmetric HS256 for backward compatibility)
const ALLOWED_ALGORITHMS = ['ES256', 'RS256', 'HS256'];
const PRIVILEGED_ROLES = ['admin', 'doctor', 'pharmacist', 'pathologist', 'receptionist', 'staff'];

// Bounded in-memory role cache: userId -> { role: string, expiresAt: number }
const roleCache = new Map();
const ROLE_CACHE_MAX_SIZE = 10000;
const ROLE_CACHE_TTL_MS = 60 * 1000; // 60 seconds bounded TTL

// Optional test JWKS store for isolated unit testing
let globalTestJwks = null;
let testProfilesMap = null;
let globalTestSessionValidator = null;

export const setTestJwks = (jwks) => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Security Error: setTestJwks cannot be invoked in production.');
  }
  globalTestJwks = jwks;
};

export const getTestJwks = () => {
  return process.env.NODE_ENV !== 'production' ? globalTestJwks : null;
};

export const setTestProfiles = (profiles) => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Security Error: setTestProfiles cannot be invoked in production.');
  }
  testProfilesMap = profiles;
};

export const setTestSessionValidator = (validator) => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Security Error: setTestSessionValidator cannot be invoked in production.');
  }
  globalTestSessionValidator = validator;
};

/**
 * Authoritatively verifies live session validity with Supabase Auth GoTrue server.
 * Distinguishes between account existence (PostgreSQL profiles) and active session validity (GoTrue Auth).
 */
export async function verifyServerSession(token, userId) {
  // Allow test mocking only in non-production environments
  if (process.env.NODE_ENV !== 'production' && globalTestSessionValidator) {
    return globalTestSessionValidator(token, userId);
  }

  try {
    // Authoritative check against Supabase GoTrue Auth
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return {
        valid: false,
        error: error?.message || 'Session not found, revoked, or expired'
      };
    }

    if (userId && data.user.id !== userId) {
      return {
        valid: false,
        error: 'Session identity mismatch'
      };
    }

    return {
      valid: true,
      user: data.user
    };
  } catch (err) {
    return {
      valid: false,
      error: err.message || 'Error communicating with Supabase Auth'
    };
  }
}

export const clearRoleCache = () => {
  roleCache.clear();
};

export const invalidateUserRole = (userId) => {
  if (userId) {
    roleCache.delete(String(userId));
  }
};

export const getRoleCacheStats = () => ({
  size: roleCache.size,
  maxSize: ROLE_CACHE_MAX_SIZE,
  ttlMs: ROLE_CACHE_TTL_MS
});

/**
 * Safely decodes base64url encoded string into a utf8 string.
 */
function decodeBase64Url(str) {
  return Buffer.from(str, 'base64url').toString('utf8');
}

/**
 * Parses and validates raw JWT structure without trusting the contents.
 */
export function parseJwtHeaderPayload(token) {
  if (typeof token !== 'string' || !token) {
    throw new Error('Malformed token: Token must be a non-empty string');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed token: Token must have exactly 3 dot-separated segments');
  }

  let header;
  let payload;

  try {
    header = JSON.parse(decodeBase64Url(parts[0]));
  } catch (err) {
    throw new Error('Malformed token: Invalid JSON in JWT header');
  }

  try {
    payload = JSON.parse(decodeBase64Url(parts[1]));
  } catch (err) {
    throw new Error('Malformed token: Invalid JSON in JWT payload');
  }

  return { header, payload, signature: parts[2] };
}

/**
 * Cryptographically verifies JWT claims using the Supabase SDK or locally cached JWKS.
 * Enforces cryptographic signature, expiration, issuer, audience, and subject claims.
 */
export async function verifyJwtClaims(token, options = {}) {
  try {
    // 1. Structure and algorithm pre-validation
    const { header, payload } = parseJwtHeaderPayload(token);

    if (!header || !header.alg) {
      return { data: null, error: new Error('Invalid JWT: missing alg header') };
    }

    if (header.alg === 'none') {
      return { data: null, error: new Error('Unsupported JWT algorithm: unsigned "none" algorithm is rejected') };
    }

    if (!ALLOWED_ALGORITHMS.includes(header.alg)) {
      return { data: null, error: new Error(`Unsupported JWT algorithm: ${header.alg}`) };
    }

    // 2. Prepare verification options (use test JWKS if supplied or configured in non-production)
    const getClaimsOptions = {};
    const jwksSource = options.jwks || (process.env.NODE_ENV !== 'production' ? globalTestJwks : null);
    if (jwksSource) {
      getClaimsOptions.jwks = jwksSource;
    }

    // 3. Cryptographic signature verification via Supabase SDK getClaims
    const { data, error } = await supabase.auth.getClaims(token, getClaimsOptions);

    if (error || !data || !data.claims) {
      return {
        data: null,
        error: error || new Error('Cryptographic signature verification failed')
      };
    }

    const claims = data.claims;

    // 4. Token expiration enforcement
    const currentEpochSeconds = Math.floor(Date.now() / 1000);
    if (!claims.exp || typeof claims.exp !== 'number') {
      return { data: null, error: new Error('Invalid JWT: missing exp claim') };
    }
    if (claims.exp <= currentEpochSeconds) {
      return { data: null, error: new Error('Invalid JWT: token has expired') };
    }

    // 5. Issuer validation (prevents cross-project Supabase token reuse)
    const expectedIssuer = options.expectedIssuer || `${env.SUPABASE_URL}/auth/v1`;
    if (claims.iss !== expectedIssuer) {
      return {
        data: null,
        error: new Error(`Invalid JWT issuer: expected "${expectedIssuer}", got "${claims.iss}"`)
      };
    }

    // 6. Audience validation
    const expectedAudience = options.expectedAudience || 'authenticated';
    const audValid = Array.isArray(claims.aud)
      ? claims.aud.includes(expectedAudience)
      : claims.aud === expectedAudience;

    if (!audValid) {
      return {
        data: null,
        error: new Error(`Invalid JWT audience: expected "${expectedAudience}", got "${claims.aud}"`)
      };
    }

    // 7. Identity claim validation
    if (!claims.sub || typeof claims.sub !== 'string' || claims.sub.trim() === '') {
      return { data: null, error: new Error('Invalid JWT: missing or invalid subject claim (sub)') };
    }

    return {
      data: {
        claims,
        header: data.header || header,
        signature: data.signature
      },
      error: null
    };
  } catch (err) {
    return { data: null, error: err };
  }
}

/**
 * Authoritatively resolves the user's role from public.profiles or tamper-proof app_metadata.
 * Never trusts client-supplied user_metadata as authority for privileged roles.
 */
export async function resolveAuthoritativeRole(userId, claims = {}, options = {}) {
  const userIdStr = String(userId);

  // 1. Check in-memory bounded cache unless skipCache is requested
  if (!options.skipCache) {
    const cached = roleCache.get(userIdStr);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.role;
    }
  }

  // 2. Check server-controlled app_metadata (tamper-proof in Supabase)
  if (claims?.app_metadata?.role) {
    const role = claims.app_metadata.role;
    setRoleInCache(userIdStr, role);
    return role;
  }

  // 3. Authoritative role resolution via test profiles (non-production) or database query
  if (process.env.NODE_ENV !== 'production' && testProfilesMap) {
    if (testProfilesMap[userIdStr]) {
      const role = testProfilesMap[userIdStr];
      setRoleInCache(userIdStr, role);
      return role;
    }
    // When testProfilesMap is configured, absence means no profile in DB
  } else {
    // In production, query authoritative public.profiles table
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userIdStr)
        .maybeSingle();

      if (!error && profile && profile.role) {
        setRoleInCache(userIdStr, profile.role);
        return profile.role;
      }
    } catch (err) {
      logger.warn(`Failed to query profiles table for user ${userIdStr}: ${err.message}`);
    }
  }

  // 4. Fallback for unprivileged roles from claims.user_metadata
  const userMetadataRole = claims?.user_metadata?.role;

  if (userMetadataRole && !PRIVILEGED_ROLES.includes(userMetadataRole)) {
    // Unprivileged roles (student, patient, teacher) are safe as defaults
    setRoleInCache(userIdStr, userMetadataRole);
    return userMetadataRole;
  }

  if (PRIVILEGED_ROLES.includes(userMetadataRole)) {
    // SECURITY SAFEGUARD: User metadata claims a privileged role (admin, doctor, etc.)
    // but there is no verified public.profiles record or app_metadata backing it.
    logger.warn(`[Security Alert] Blocked unverified privileged role '${userMetadataRole}' for user ${userIdStr} lacking authoritative database record.`);
    const safeFallback = 'patient';
    setRoleInCache(userIdStr, safeFallback);
    return safeFallback;
  }

  // Default fallback role for authenticated users with no role record
  const defaultRole = 'student';
  setRoleInCache(userIdStr, defaultRole);
  return defaultRole;
}

function setRoleInCache(userId, role) {
  // Evict oldest entry if cache exceeds bounds
  if (roleCache.size >= ROLE_CACHE_MAX_SIZE) {
    const firstKey = roleCache.keys().next().value;
    if (firstKey) roleCache.delete(firstKey);
  }

  roleCache.set(userId, {
    role,
    expiresAt: Date.now() + ROLE_CACHE_TTL_MS
  });
}
