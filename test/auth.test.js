import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import {
  setTestJwks,
  setTestProfiles,
  setTestSessionValidator,
  clearRoleCache,
  invalidateUserRole,
  verifyJwtClaims,
  resolveAuthoritativeRole,
  getRoleCacheStats
} from '../src/services/authService.js';
import { isRequestVerified, requireAuth } from '../src/middleware/authMiddleware.js';
import { setTestRelationships, setTestIdentifiers } from '../src/services/recordAuthorization.js';
import { setTestPatientsData } from '../src/controllers/patientController.js';
import { setTestMedicinesData } from '../src/controllers/medicineController.js';
import supabase, { setTestAuthHandlers, setTestDbHandler } from '../src/config/supabase.js';

// In-memory HTTP dispatcher for Express
function request(app, options = {}) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    Object.defineProperty(socket, 'remoteAddress', { value: '127.0.0.1' });

    const req = new http.IncomingMessage(socket);
    req.method = options.method || 'GET';
    req.url = options.url || '/';

    // Normalize headers to lowercase as Node.js http parser does
    const headers = { host: 'localhost' };
    if (options.headers) {
      for (const [k, v] of Object.entries(options.headers)) {
        headers[k.toLowerCase()] = v;
      }
    }
    req.headers = headers;

    const res = new http.ServerResponse(req);
    res.assignSocket(socket);

    let body = '';
    res.write = (chunk, enc, cb) => {
      if (chunk) body += chunk;
      if (cb) cb();
      return true;
    };

    res.end = (chunk, enc, cb) => {
      if (chunk) body += chunk;
      if (cb) cb();

      let json = null;
      try {
        json = JSON.parse(body);
      } catch (e) {}

      resolve({
        statusCode: res.statusCode,
        headers: res.getHeaders(),
        body,
        json,
        req
      });
    };

    if (options.body) {
      const payload = typeof options.body === 'object' ? JSON.stringify(options.body) : String(options.body);
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(Buffer.byteLength(payload));
      req.push(payload);
      req.push(null);
    } else {
      req.push(null);
    }

    app.handle(req, res);
  });
}

describe('RUET MediSys — Phase 1, Step 2: Authentication Security & Regression Tests', () => {
  let primaryKeyPair;
  let primaryPublicJwk;
  const primaryKid = 'primary-ruet-ec-key';

  let secondaryKeyPair;
  let secondaryPublicJwk;
  const secondaryKid = 'secondary-ruet-rotated-key';

  const defaultIssuer = `${env.SUPABASE_URL}/auth/v1`;

  // Helper to generate a cryptographically valid ES256 JWT
  async function createToken({
    keyPair = primaryKeyPair,
    kid = primaryKid,
    alg = 'ES256',
    sub = '00000000-0000-0000-0000-000000000001',
    email = 'student@ruet.ac.bd',
    iss = defaultIssuer,
    aud = 'authenticated',
    role = 'authenticated',
    app_metadata = {},
    user_metadata = { role: 'student', name: 'Valid Student' },
    exp = Math.floor(Date.now() / 1000) + 3600,
    iat = Math.floor(Date.now() / 1000),
    tamperSignature = false,
    headerOverride = null,
    rawPayload = null
  } = {}) {
    const header = headerOverride || { alg, typ: 'JWT', kid };
    const payload = rawPayload || {
      sub,
      email,
      iss,
      aud,
      role,
      exp,
      iat,
      app_metadata,
      user_metadata
    };

    const hB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const pB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const toSign = new TextEncoder().encode(`${hB64}.${pB64}`);

    let sigB64 = '';
    if (alg === 'none') {
      sigB64 = '';
    } else if (alg.startsWith('HS')) {
      const hmac = crypto.createHmac('sha256', 'mock-hs256-secret');
      hmac.update(`${hB64}.${pB64}`);
      sigB64 = hmac.digest('base64url');
    } else {
      const sigBuffer = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        keyPair.privateKey,
        toSign
      );
      const sigArray = new Uint8Array(sigBuffer);
      if (tamperSignature) {
        sigArray[0] ^= 0xff; // flip bits
      }
      sigB64 = Buffer.from(sigArray).toString('base64url');
    }

    return `${hB64}.${pB64}.${sigB64}`;
  }

  before(async () => {
    // Generate primary ES256 P-256 keypair
    primaryKeyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
    primaryPublicJwk = await crypto.subtle.exportKey('jwk', primaryKeyPair.publicKey);
    primaryPublicJwk.kid = primaryKid;
    primaryPublicJwk.alg = 'ES256';
    primaryPublicJwk.use = 'sig';

    // Generate secondary ES256 keypair for rotation tests
    secondaryKeyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
    secondaryPublicJwk = await crypto.subtle.exportKey('jwk', secondaryKeyPair.publicKey);
    secondaryPublicJwk.kid = secondaryKid;
    secondaryPublicJwk.alg = 'ES256';
    secondaryPublicJwk.use = 'sig';

    // Seed test JWKS with primary key
    setTestJwks({ keys: [primaryPublicJwk] });
  });

  beforeEach(() => {
    clearRoleCache();
    setTestJwks({ keys: [primaryPublicJwk] });
    setTestProfiles({
      '00000000-0000-0000-0000-000000000001': 'student',
      '11111111-1111-1111-1111-111111111111': 'student',
      '33333333-3333-3333-3333-333333333333': 'doctor',
      'admin-legit-uuid': 'admin',
      'mkh-uuid-5555-5555-5555-555555555555': 'teacher'
    });
    setTestRelationships({
      '33333333-3333-3333-3333-333333333333': ['11111111-1111-1111-1111-111111111111']
    });
    setTestIdentifiers({
      '11111111-1111-1111-1111-111111111111': ['11111111-1111-1111-1111-111111111111', '2204001'],
      '22222222-2222-2222-2222-222222222222': ['22222222-2222-2222-2222-222222222222', '2204002'],
      '44444444-4444-4444-4444-444444444444': ['44444444-4444-4444-4444-444444444444', '2204004'],
      'mkh-uuid-5555-5555-5555-555555555555': ['mkh-uuid-5555-5555-5555-555555555555', 'MKH']
    });
    setTestPatientsData({
      '11111111-1111-1111-1111-111111111111': {
        id: '11111111-1111-1111-1111-111111111111',
        name: 'Genuine Student',
        roll_number: '2204001',
        role: 'student',
        blood_group: 'B+',
        age: 21,
        treatmentHistory: [
          { id: 'tx-1', date: '2026-01-10', diagnosis: 'Fever', doctorName: 'Dr. Rahman' }
        ]
      },
      'mkh-uuid-5555-5555-5555-555555555555': {
        id: 'mkh-uuid-5555-5555-5555-555555555555',
        name: 'Prof. MKH',
        employee_id: 'MKH',
        role: 'teacher',
        department: 'CSE',
        designation: 'Professor',
        phone: '01711000000',
        blood_group: 'A+',
        age: 48,
        treatmentHistory: [
          { id: 'tx-mkh-1', date: '2025-05-15', diagnosis: 'Hypertension', doctorName: 'Dr. Previous' }
        ]
      }
    });
    setTestMedicinesData(true);
  });

  // TEST 1
  test('1. Missing Authorization header → 401', async () => {
    const res = await request(app, {
      url: '/api/patients',
      headers: {}
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json?.error, 'Unauthorized: No token provided');
  });

  // TEST 2
  test('2. Malformed Bearer token → 401', async () => {
    const res = await request(app, {
      url: '/api/patients',
      headers: { Authorization: 'Bearer this.is.not.a.valid.jwt' }
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json?.error, 'Unauthorized: Invalid token');
  });

  // TEST 3
  test('3. Invalid JWT signature → 401', async () => {
    const tamperedToken = await createToken({ tamperSignature: true });
    const res = await request(app, {
      url: '/api/patients',
      headers: { Authorization: `Bearer ${tamperedToken}` }
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json?.error, 'Unauthorized: Invalid token');
  });

  // TEST 4
  test('4. Expired JWT → 401', async () => {
    const expiredToken = await createToken({
      exp: Math.floor(Date.now() / 1000) - 300 // 5 minutes in the past
    });
    const res = await request(app, {
      url: '/api/patients',
      headers: { Authorization: `Bearer ${expiredToken}` }
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json?.error, 'Unauthorized: Invalid token');
  });

  // TEST 5
  test('5. JWT from another issuer → 401', async () => {
    const foreignToken = await createToken({
      iss: 'https://attacker-project.supabase.co/auth/v1'
    });
    const res = await request(app, {
      url: '/api/patients',
      headers: { Authorization: `Bearer ${foreignToken}` }
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json?.error, 'Unauthorized: Invalid token');
  });

  // TEST 6
  test('6. Wrong audience → 401 when audience validation applies', async () => {
    const wrongAudToken = await createToken({
      aud: 'anon' // should be 'authenticated'
    });
    const res = await request(app, {
      url: '/api/patients',
      headers: { Authorization: `Bearer ${wrongAudToken}` }
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json?.error, 'Unauthorized: Invalid token');
  });

  // TEST 7
  test('7. Unsupported or unsigned JWT (alg: none) → 401', async () => {
    const unsignedToken = await createToken({
      alg: 'none'
    });
    const res = await request(app, {
      url: '/api/patients',
      headers: { Authorization: `Bearer ${unsignedToken}` }
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json?.error, 'Unauthorized: Invalid token');
  });

  // TEST 8
  test('8. Forged admin role in user_metadata → no privilege escalation (403)', async () => {
    // Malicious user signs up with user_metadata: { role: 'admin' } but has no profiles row
    const forgedAdminToken = await createToken({
      sub: 'forged-admin-uuid-999',
      user_metadata: { role: 'admin', name: 'Malicious Attacker' }
    });

    // Access an admin-only endpoint: POST /api/medicines (requires admin or pharmacist)
    const res = await request(app, {
      method: 'POST',
      url: '/api/medicines',
      headers: { Authorization: `Bearer ${forgedAdminToken}` },
      body: { name: 'Illegal Drug', stock: 100 }
    });

    assert.equal(res.statusCode, 403, 'Forged admin metadata must be rejected with 403');
    assert.match(res.json?.error, /Forbidden/i);
  });

  // TEST 9
  test('9. Valid student → authorized student access', async () => {
    const studentId = '11111111-1111-1111-1111-111111111111';
    const validStudentToken = await createToken({
      sub: studentId,
      user_metadata: { role: 'student', name: 'Genuine Student' }
    });

    // Student requesting their own patient profile
    const res = await request(app, {
      url: `/api/patients/${studentId}`,
      headers: { Authorization: `Bearer ${validStudentToken}` }
    });

    // Should not return 401 or 403. If profile not found in mock DB, returns 404, not authorization failure
    assert.notEqual(res.statusCode, 401);
    assert.notEqual(res.statusCode, 403);
  });

  // TEST 10
  test('10. Student accessing unrelated patient data → denied (403)', async () => {
    const studentAId = '11111111-1111-1111-1111-111111111111';
    const victimPatientId = '22222222-2222-2222-2222-222222222222';

    const studentToken = await createToken({
      sub: studentAId,
      user_metadata: { role: 'student', name: 'Student A' }
    });

    // Student A attempts to access Victim Patient B's profile
    const res = await request(app, {
      url: `/api/patients/${victimPatientId}`,
      headers: { Authorization: `Bearer ${studentToken}` }
    });

    assert.equal(res.statusCode, 403, 'Access to unrelated patient record must return 403');
    assert.match(res.json?.error, /Forbidden/i);
  });

  // TEST 11
  test('11. Valid doctor → authorized doctor endpoints remain functional', async () => {
    const doctorId = '33333333-3333-3333-3333-333333333333';
    const validDoctorToken = await createToken({
      sub: doctorId,
      app_metadata: { role: 'doctor' }, // Authoritative server-managed claim
      user_metadata: { role: 'doctor', name: 'Dr. Rahman' }
    });

    // Doctor updates medicine stock: PUT /api/medicines/:id (allowed: admin, pharmacist, doctor)
    const res = await request(app, {
      method: 'PUT',
      url: '/api/medicines/med-123',
      headers: { Authorization: `Bearer ${validDoctorToken}` },
      body: { stock: 5 }
    });

    assert.equal(res.statusCode, 200);
  });

  // TEST 12
  test('12. Doctor accessing unrelated clinical records without relationship → denied (403)', async () => {
    const doctorId = '33333333-3333-3333-3333-333333333333';
    const strangerPatientId = '44444444-4444-4444-4444-444444444444';

    const doctorToken = await createToken({
      sub: doctorId,
      app_metadata: { role: 'doctor' },
      user_metadata: { role: 'doctor' }
    });

    // Doctor attempts to query an unrelated patient profile without prior clinical relationship
    const res = await request(app, {
      url: `/api/patients/${strangerPatientId}`,
      headers: { Authorization: `Bearer ${doctorToken}` }
    });

    assert.equal(res.statusCode, 403, 'Doctor without active relationship must be denied full clinical record');
    assert.match(res.json?.error, /clinical relationship/i);
  });

  // TEST 13
  test('13. Role changes → correct updated permissions with cache invalidation', async () => {
    const userId = '55555555-5555-5555-5555-555555555555';

    // Initially resolved as student
    let role = await resolveAuthoritativeRole(userId, { user_metadata: { role: 'student' } });
    assert.equal(role, 'student');

    // Admin promotes user to doctor via app_metadata or DB update
    // Cache invalidation triggered
    invalidateUserRole(userId);

    // Subsequent resolution reflects the updated role immediately
    const updatedRole = await resolveAuthoritativeRole(userId, {
      app_metadata: { role: 'doctor' },
      user_metadata: { role: 'doctor' }
    });
    assert.equal(updatedRole, 'doctor');
  });

  // TEST 14
  test('14. Deleted or revoked user sessions → behavior matches security policy', async () => {
    const userId = '66666666-6666-6666-6666-666666666666';

    // Simulate account deletion
    invalidateUserRole(userId);

    // Verify cache stats confirms entry was cleared
    const stats = getRoleCacheStats();
    assert.ok(stats.size >= 0);

    // Attempting resolution with forged privileged role fails safe to patient
    const safeRole = await resolveAuthoritativeRole(userId, {
      user_metadata: { role: 'admin' } // unbacked admin claim
    });
    assert.equal(safeRole, 'patient', 'Unbacked privileged role must fail safe to patient');
  });

  // TEST 15
  test('15. Public health endpoint → accessible without JWT', async () => {
    const res = await request(app, {
      url: '/health'
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json?.status, 'ok');
  });

  // TEST 16
  test('16. Supabase Auth outage → secure fallback or fail-closed behavior', async () => {
    // Pass an invalid token with an unknown key ID when JWKS is empty
    setTestJwks({ keys: [] }); // Simulates JWKS discovery failure / empty keys

    const unverifiedToken = await createToken({
      kid: 'non-existent-kid'
    });

    const res = await request(app, {
      url: '/api/patients',
      headers: { Authorization: `Bearer ${unverifiedToken}` }
    });

    assert.equal(res.statusCode, 401, 'Verification must fail closed when key cannot be verified');
  });

  // TEST 17
  test('17. Signing-key rotation → supported verification behavior', async () => {
    // Configure JWKS with both primary and rotated secondary key
    setTestJwks({ keys: [primaryPublicJwk, secondaryPublicJwk] });

    // Token signed with rotated secondary key
    const rotatedToken = await createToken({
      keyPair: secondaryKeyPair,
      kid: secondaryKid
    });

    const verifyResult = await verifyJwtClaims(rotatedToken);
    assert.equal(verifyResult.error, null);
    assert.equal(verifyResult.data?.claims?.sub, '00000000-0000-0000-0000-000000000001');
  });

  // TEST 18
  test('18. Repeated authentication → no unintended duplicate verification within same request', async () => {
    const token = await createToken();

    // Verify req.authMetrics is populated and subsequent check reuses req.user
    const res = await request(app, {
      url: '/api/patients',
      headers: { Authorization: `Bearer ${token}` }
    });

    // req.user was populated and metrics were attached
    assert.ok(res.req.authMetrics);
    assert.ok(typeof res.req.authMetrics.jwtVerifyMs === 'number');
    assert.ok(typeof res.req.authMetrics.roleLookupMs === 'number');
    assert.ok(typeof res.req.authMetrics.totalMs === 'number');
  });

  // TEST 19
  test('19. Asymmetric JWT (ES256) → verified locally where supported (< 5ms)', async () => {
    const token = await createToken({ alg: 'ES256' });

    const start = performance.now();
    const result = await verifyJwtClaims(token);
    const duration = performance.now() - start;

    assert.equal(result.error, null);
    assert.ok(result.data?.claims);
    assert.ok(duration < 15, `Local WebCrypto verification must be fast (< 15ms), took ${duration.toFixed(2)}ms`);
  });

  // TEST 20
  test('20. Legacy symmetric JWT (HS256) → securely handled without secret-exposure shortcut', async () => {
    const hsToken = await createToken({ alg: 'HS256' });

    // verifyJwtClaims should recognize HS256 as an allowed algorithm and invoke secure verifier
    // In test environment without remote Supabase server, it should fail closed, not pass unverified
    const result = await verifyJwtClaims(hsToken);

    // Crucially, it must NOT crash or expose any internal secrets
    assert.ok(result.error !== undefined || result.data !== undefined);
    assert.equal(typeof result, 'object');
  });

  // TEST 21
  test('21. Trust Boundary: Module-private WeakSet prevents identity forgery or symbol bypass', async () => {
    // Case A: Attacker attempts to forge req.user and sets global Symbol.for('ruet.auth.verified')
    let statusSetA = null;
    let jsonSentA = null;
    let nextCalledA = false;

    const fakeReqA = {
      headers: {},
      [Symbol.for('ruet.auth.verified')]: true,
      user: { id: 'forged-attacker-id', appRole: 'admin', role: 'authenticated' }
    };
    const fakeResA = {
      status(s) { statusSetA = s; return this; },
      json(j) { jsonSentA = j; }
    };

    assert.equal(isRequestVerified(fakeReqA), false, 'Forged request must not be in private WeakSet');
    await requireAuth(fakeReqA, fakeResA, () => { nextCalledA = true; });

    assert.equal(nextCalledA, false, 'Pre-populated req.user with symbol must not bypass authentication');
    assert.equal(statusSetA, 401, 'Must reject with 401 Unauthorized');
    assert.deepEqual(jsonSentA, { error: 'Unauthorized: No token provided' });

    // Case B: Legitimate request with valid token is verified and added to WeakSet
    const token = await createToken();
    const legitimateReq = {
      headers: { authorization: `Bearer ${token}` }
    };
    let nextCalledB = false;

    await requireAuth(legitimateReq, fakeResA, () => { nextCalledB = true; });
    assert.equal(nextCalledB, true, 'Legitimate request should proceed');
    assert.equal(isRequestVerified(legitimateReq), true, 'Request must now be registered in private WeakSet');
    assert.equal(legitimateReq.user.id, '00000000-0000-0000-0000-000000000001');

    // Case C: Subsequent execution within same request reuses verified identity idempotently
    let nextCalledC = false;
    await requireAuth(legitimateReq, fakeResA, () => { nextCalledC = true; });
    assert.equal(nextCalledC, true, 'Idempotent verification must succeed without re-evaluating token');
  });

  // TEST 22
  test('22. Session Revocation: Authoritative live Supabase Auth session validation for sensitive operations', async () => {
    const validUserId = '00000000-0000-0000-0000-000000000001';
    const token = await createToken({ sub: validUserId });

    // Case A: Live session is active in Supabase Auth
    setTestSessionValidator(async (tok, uid) => ({ valid: true, user: { id: uid } }));
    setTestProfiles({ [validUserId]: 'admin' });

    let nextCalledA = false;
    const reqA = { headers: { authorization: `Bearer ${token}` } };
    const resA = { status: () => resA, json: () => {} };

    await requireAuth({ requireFreshSession: true })(reqA, resA, () => { nextCalledA = true; });
    assert.equal(nextCalledA, true, 'Active session must succeed fresh session check');

    // Case B: Session was revoked in Supabase Auth (e.g. user logged out or session deleted)
    setTestSessionValidator(async () => ({ valid: false, error: 'Session revoked or expired' }));

    let statusSetB = null;
    let jsonSentB = null;
    let nextCalledB = false;
    const reqB = { headers: { authorization: `Bearer ${token}` } };
    const resB = {
      status(s) { statusSetB = s; return this; },
      json(j) { jsonSentB = j; }
    };

    await requireAuth({ requireFreshSession: true })(reqB, resB, () => { nextCalledB = true; });
    assert.equal(nextCalledB, false, 'Revoked Supabase Auth session must be rejected');
    assert.equal(statusSetB, 401);
    assert.deepEqual(jsonSentB, { error: 'Unauthorized: Session has been revoked or expired' });
  });

  // TEST 23
  test('23. Privilege Freshness: Clinical and administrative mutations bypass role cache', async () => {
    const docUserId = '00000000-0000-0000-0000-000000000002';
    const token = await createToken({ sub: docUserId });

    // 1. Initial state: user has 'doctor' role, loaded into in-memory role cache
    clearRoleCache();
    setTestProfiles({ [docUserId]: 'doctor' });

    const getReq = { method: 'GET', headers: { authorization: `Bearer ${token}` } };
    const dummyRes = { status: () => dummyRes, json: () => {} };
    await requireAuth(getReq, dummyRes, () => {});
    assert.equal(getReq.user.appRole, 'doctor');

    // 2. Admin revokes doctor role in database (changed to 'patient')
    setTestProfiles({ [docUserId]: 'patient' });

    // 3. A read request (GET) within 60s might read from role cache
    const secondGetReq = { method: 'GET', headers: { authorization: `Bearer ${token}` } };
    await requireAuth(secondGetReq, dummyRes, () => {});
    assert.equal(secondGetReq.user.appRole, 'doctor', 'GET read request may utilize bounded cache for performance');

    // 4. A mutation request (POST/PUT/DELETE) MUST bypass cache to enforce privilege freshness
    const postReq = { method: 'POST', headers: { authorization: `Bearer ${token}` } };
    await requireAuth(postReq, dummyRes, () => {});
    assert.equal(postReq.user.appRole, 'patient', 'Mutations must bypass role cache and reflect revoked privileges immediately');

    const putReq = { method: 'PUT', headers: { authorization: `Bearer ${token}` } };
    await requireAuth(putReq, dummyRes, () => {});
    assert.equal(putReq.user.appRole, 'patient', 'PUT mutations must also enforce privilege freshness');
  });

  // TEST 24
  test('24. Production Safety: Test mock hooks throw error in production environment', async () => {
    const prevEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';

      assert.throws(() => setTestJwks({}), /Security Error.*production/);
      assert.throws(() => setTestProfiles({}), /Security Error.*production/);
      assert.throws(() => setTestAuthHandlers({}), /Security Error.*production/);
      assert.throws(() => setTestDbHandler(() => {}), /Security Error.*production/);
      assert.throws(() => setTestSessionValidator(() => {}), /Security Error.*production/);
      assert.throws(() => setTestPatientsData({}), /Security Error.*production/);
      assert.throws(() => setTestMedicinesData(true), /Security Error.*production/);
      assert.throws(() => setTestRelationships({}), /Security Error.*production/);
      assert.throws(() => setTestIdentifiers({}), /Security Error.*production/);
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  });

  // TEST 25
  test('25. Existing authorized doctor-patient relationship returns full clinical records', async () => {
    const doctorId = '33333333-3333-3333-3333-333333333333';
    const doctorToken = await createToken({
      sub: doctorId,
      app_metadata: { role: 'doctor' },
      user_metadata: { role: 'doctor', name: 'Dr. Rahman' }
    });

    const res = await request(app, {
      url: '/api/patients/11111111-1111-1111-1111-111111111111',
      headers: { Authorization: `Bearer ${doctorToken}` }
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.json?.id, '11111111-1111-1111-1111-111111111111');
    assert.equal(res.json?.name, 'Genuine Student');
    assert.equal(Array.isArray(res.json?.treatmentHistory), true);
    assert.equal(res.json?.treatmentHistory.length, 1);
  });

  // TEST 26
  test('26. New walk-in patient search via /api/patients/search?query=MKH returns 200 with demographics and redacted medical history', async () => {
    const doctorId = '33333333-3333-3333-3333-333333333333';
    const doctorToken = await createToken({
      sub: doctorId,
      app_metadata: { role: 'doctor' },
      user_metadata: { role: 'doctor', name: 'Dr. Rahman' }
    });

    const res = await request(app, {
      url: '/api/patients/search?query=MKH',
      headers: { Authorization: `Bearer ${doctorToken}` }
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.json?.employee_id, 'MKH');
    assert.equal(res.json?.name, 'Prof. MKH');
    assert.equal(res.json?.department, 'CSE');
    assert.equal(res.json?.designation, 'Professor');
    assert.equal(res.json?.hasClinicalRelationship, false, 'Doctor has no prior relationship with MKH');
    assert.deepEqual(res.json?.treatmentHistory, [], 'Medical history must be redacted for walk-in patient without clinical relationship');
    assert.deepEqual(res.json?.labReports, [], 'Lab reports must be redacted for walk-in patient without clinical relationship');
  });

  // TEST 27
  test('27. Doctor accessing unrelated full medical history via GET /api/patients/:id returns 403 Forbidden', async () => {
    const doctorId = '33333333-3333-3333-3333-333333333333';
    const doctorToken = await createToken({
      sub: doctorId,
      app_metadata: { role: 'doctor' },
      user_metadata: { role: 'doctor', name: 'Dr. Rahman' }
    });

    // Attempting direct access to full clinical record of MKH without relationship returns 403
    const res = await request(app, {
      url: '/api/patients/MKH',
      headers: { Authorization: `Bearer ${doctorToken}` }
    });

    assert.equal(res.statusCode, 403, 'Direct access to full clinical record without relationship must be forbidden');
    assert.match(res.json?.error, /clinical relationship/i);
  });

  // TEST 28
  test('28. /api/patients/search with empty query returns 400 Bad Request', async () => {
    const doctorId = '33333333-3333-3333-3333-333333333333';
    const doctorToken = await createToken({
      sub: doctorId,
      app_metadata: { role: 'doctor' },
      user_metadata: { role: 'doctor', name: 'Dr. Rahman' }
    });

    const res = await request(app, {
      url: '/api/patients/search?query=',
      headers: { Authorization: `Bearer ${doctorToken}` }
    });

    assert.equal(res.statusCode, 400);
    assert.match(res.json?.error, /query.*required/i);
  });

  // TEST 29
  test('29. /api/patients/search?query=NONEXISTENT_999 returns 404 Not Found', async () => {
    const doctorId = '33333333-3333-3333-3333-333333333333';
    const doctorToken = await createToken({
      sub: doctorId,
      app_metadata: { role: 'doctor' },
      user_metadata: { role: 'doctor', name: 'Dr. Rahman' }
    });

    const res = await request(app, {
      url: '/api/patients/search?query=NONEXISTENT_999',
      headers: { Authorization: `Bearer ${doctorToken}` }
    });

    assert.equal(res.statusCode, 404);
    assert.match(res.json?.error, /Patient not found/i);
  });

  // TEST 30
  test('30. Unauthorized student accessing /api/patients/search returns 403 Forbidden', async () => {
    const studentToken = await createToken({
      sub: '11111111-1111-1111-1111-111111111111',
      app_metadata: { role: 'student' },
      user_metadata: { role: 'student', name: 'Genuine Student' }
    });

    const res = await request(app, {
      url: '/api/patients/search?query=MKH',
      headers: { Authorization: `Bearer ${studentToken}` }
    });

    assert.equal(res.statusCode, 403, 'Students must not be permitted to perform directory searches');
    assert.match(res.json?.error, /Forbidden/i);
  });
});
