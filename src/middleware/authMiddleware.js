import { performance } from 'node:perf_hooks';
import { logger } from '../config/logger.js';
import {
  verifyJwtClaims,
  resolveAuthoritativeRole,
  verifyServerSession,
  invalidateUserRole,
  clearRoleCache,
  getRoleCacheStats
} from '../services/authService.js';

// Module-private WeakSet storing cryptographically verified Request objects.
// Inaccessible to external modules, request bodies, query params, or global Symbol lookup.
const verifiedRequests = new WeakSet();

/**
 * Read-only inspector to check if a request has been cryptographically verified
 * by this authentication middleware.
 */
export const isRequestVerified = (req) => {
  return typeof req === 'object' && req !== null ? verifiedRequests.has(req) : false;
};

// Re-export utility functions so consumers and tests have clean access
export {
  verifyJwtClaims,
  resolveAuthoritativeRole,
  verifyServerSession,
  invalidateUserRole,
  clearRoleCache,
  getRoleCacheStats
};

/**
 * Internal core handler for authenticating requests.
 */
const authenticateRequest = async (req, res, next, options = {}) => {
  // 1. Optimize repeated work: ONLY reuse identity if request is recorded in module-private WeakSet
  if (verifiedRequests.has(req) && req.user && req.user.id) {
    return next();
  }

  const startTime = performance.now();
  let jwtVerifyDuration = 0;
  let roleLookupDuration = 0;

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split(' ')[1];
    if (!token || token.trim() === '') {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    // 2. Cryptographic JWT verification with local JWKS caching
    const jwtStart = performance.now();
    const { data: claimsData, error: jwtError } = await verifyJwtClaims(token, options);
    jwtVerifyDuration = performance.now() - jwtStart;

    if (jwtError || !claimsData || !claimsData.claims) {
      logger.debug(`[Auth] JWT verification rejected: ${jwtError?.message || 'Invalid claims'}`);
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    const claims = claimsData.claims;

    // 3. Authoritative Session Revocation Check (when fresh session is required)
    // Distinguishes active Supabase Auth session validity from PostgreSQL account status
    if (options.requireFreshSession) {
      const sessionResult = await verifyServerSession(token, claims.sub);
      if (!sessionResult.valid) {
        logger.warn(`[Auth] Fresh session check failed for user ${claims.sub}: ${sessionResult.error}`);
        return res.status(401).json({ error: 'Unauthorized: Session has been revoked or expired' });
      }
    }

    // 4. Construct user object preserving standard Supabase User schema
    const user = {
      id: claims.sub,
      sub: claims.sub,
      email: claims.email || '',
      phone: claims.phone || '',
      role: claims.role || 'authenticated', // Postgres DB role
      app_metadata: claims.app_metadata || {},
      user_metadata: { ...(claims.user_metadata || {}) },
      aud: claims.aud,
      created_at: claims.created_at || (claims.iat ? new Date(claims.iat * 1000).toISOString() : undefined),
      session_id: claims.session_id,
      aal: claims.aal,
      amr: claims.amr
    };

    // 5. Privilege Freshness & Authoritative Role Resolution
    // State-changing mutations (POST, PUT, PATCH, DELETE) ALWAYS bypass the role cache
    // to guarantee an outdated 60-second cache cannot authorize actions after role revocation.
    const isMutation = typeof req.method === 'string' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());
    const shouldSkipRoleCache = isMutation || options.skipCache || options.requireFreshRole || options.requireFreshSession;

    const roleStart = performance.now();
    const roleResolutionOptions = { ...options, skipCache: shouldSkipRoleCache };
    const authoritativeRole = await resolveAuthoritativeRole(claims.sub, claims, roleResolutionOptions);
    roleLookupDuration = performance.now() - roleStart;

    if (options.requireFreshSession && (!authoritativeRole || authoritativeRole === 'disabled')) {
      return res.status(401).json({ error: 'Unauthorized: Session revoked or account disabled' });
    }

    // Synchronize both appRole and user_metadata.role for seamless downstream compatibility
    user.appRole = authoritativeRole;
    user.user_metadata.role = authoritativeRole;

    // 6. Performance instrumentation (privacy-preserving, non-sensitive)
    const totalDuration = performance.now() - startTime;
    req.authMetrics = {
      jwtVerifyMs: Number(jwtVerifyDuration.toFixed(3)),
      roleLookupMs: Number(roleLookupDuration.toFixed(3)),
      totalMs: Number(totalDuration.toFixed(3))
    };

    logger.debug(`[Auth] Authenticated user in ${totalDuration.toFixed(2)}ms (JWT: ${jwtVerifyDuration.toFixed(2)}ms, Role: ${roleLookupDuration.toFixed(2)}ms)`);

    // Record verified request in module-private WeakSet and attach verified user
    verifiedRequests.add(req);
    req.user = user;
    next();
  } catch (err) {
    logger.error(`[Auth] Middleware unexpected error: ${err.message}`);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

/**
 * Universal Authentication Middleware.
 * Can be used directly as middleware: router.use(requireAuth)
 * Or configured with options: router.use(requireAuth({ ... }))
 */
export const requireAuth = (arg1, arg2, arg3) => {
  // If called directly as Express middleware: (req, res, next)
  if (arg1 && arg1.headers && typeof arg2?.status === 'function') {
    return authenticateRequest(arg1, arg2, arg3, {});
  }

  // If called as a middleware factory: requireAuth(options)(req, res, next)
  const options = typeof arg1 === 'object' && arg1 !== null ? arg1 : {};
  return (req, res, next) => authenticateRequest(req, res, next, options);
};

/**
 * Role-Based Access Control Middleware.
 * Enforces that authenticated user possesses one of the allowed authoritative roles.
 */
export const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized: User not authenticated' });
    }

    const userRole = req.user.appRole || req.user.user_metadata?.role;

    if (!userRole || !allowedRoles.includes(userRole)) {
      return res.status(403).json({ 
        error: `Forbidden: Requires one of roles [${allowedRoles.join(', ')}]` 
      });
    }

    next();
  };
};
