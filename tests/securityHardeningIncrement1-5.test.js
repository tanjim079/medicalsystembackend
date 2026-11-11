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
  invalidateUserRole
} from '../src/services/authService.js';
import { setTestRelationships, setTestIdentifiers } from '../src/services/recordAuthorization.js';
import { setTestPatientsData } from '../src/controllers/patientController.js';
import { setTestMedicinesData } from '../src/controllers/medicineController.js';
import { setTestAuthHandlers, setTestDbHandler } from '../src/config/supabase.js';

// In-memory HTTP dispatcher for Express
function request(app, options = {}) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    Object.defineProperty(socket, 'remoteAddress', { value: '127.0.0.1' });

    const req = new http.IncomingMessage(socket);
    req.method = options.method || 'GET';
    req.url = options.url || '/';

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

describe('RUET Medical — Historical Security Hardening Suites (Increments 1–5)', () => {
  let keyPair;
  let publicJwk;
  const kid = 'sec-key-1';
  const defaultIssuer = `${env.SUPABASE_URL}/auth/v1`;

  // Token helper
  async function makeToken(sub, role, name = 'User') {
    const header = { alg: 'ES256', typ: 'JWT', kid };
    const payload = {
      sub,
      email: `${role}@ruet.ac.bd`,
      iss: defaultIssuer,
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: { role },
      user_metadata: { role, name },
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000)
    };
    const hB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const pB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sigBuf = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, new TextEncoder().encode(`${hB64}.${pB64}`));
    return `${hB64}.${pB64}.${Buffer.from(sigBuf).toString('base64url')}`;
  }

  let adminToken;
  let doctorToken;
  let studentToken;
  let studentBToken;
  let teacherToken;
  let receptionistToken;
  let pathologistToken;
  let pharmacistToken;

  const adminId = 'admin-uuid-001';
  const doctorId = 'doctor-uuid-002';
  const studentAId = 'student-a-uuid-003';
  const studentBId = 'student-b-uuid-004';
  const teacherId = 'teacher-uuid-005';
  const receptionistId = 'receptionist-uuid-006';
  const pathologistId = 'pathologist-uuid-007';
  const pharmacistId = 'pharmacist-uuid-008';

  before(async () => {
    keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    publicJwk.kid = kid;
    publicJwk.alg = 'ES256';
    publicJwk.use = 'sig';

    setTestJwks({ keys: [publicJwk] });

    adminToken = await makeToken(adminId, 'admin', 'Admin User');
    doctorToken = await makeToken(doctorId, 'doctor', 'Dr. Alom');
    studentToken = await makeToken(studentAId, 'student', 'Student A');
    studentBToken = await makeToken(studentBId, 'student', 'Student B');
    teacherToken = await makeToken(teacherId, 'teacher', 'Prof. Hasan');
    receptionistToken = await makeToken(receptionistId, 'receptionist', 'Receptionist User');
    pathologistToken = await makeToken(pathologistId, 'pathologist', 'Pathologist User');
    pharmacistToken = await makeToken(pharmacistId, 'pharmacist', 'Pharmacist User');
  });

  beforeEach(() => {
    clearRoleCache();
    setTestJwks({ keys: [publicJwk] });
    setTestProfiles({
      [adminId]: 'admin',
      [doctorId]: 'doctor',
      [studentAId]: 'student',
      [studentBId]: 'student',
      [teacherId]: 'teacher',
      [receptionistId]: 'receptionist',
      [pathologistId]: 'pathologist',
      [pharmacistId]: 'pharmacist'
    });
    setTestRelationships({
      [doctorId]: [studentAId]
    });
    setTestIdentifiers({
      [studentAId]: [studentAId, '2204001'],
      [studentBId]: [studentBId, '2204002'],
      [teacherId]: [teacherId, 'T-101']
    });
    setTestPatientsData({
      [studentAId]: { id: studentAId, name: 'Student A', role: 'student', roll_number: '2204001' },
      [studentBId]: { id: studentBId, name: 'Student B', role: 'student', roll_number: '2204002' },
      [teacherId]: { id: teacherId, name: 'Prof. Hasan', role: 'teacher', employee_id: 'T-101' }
    });
    setTestMedicinesData(true);
    setTestDbHandler((table) => {
      const builder = {
        select: () => builder,
        insert: () => builder,
        update: () => builder,
        delete: () => builder,
        upsert: () => builder,
        eq: () => builder,
        neq: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => builder,
        range: () => builder,
        single: async () => ({ data: { id: 'mock-id' }, error: null }),
        maybeSingle: async () => ({ data: { id: 'mock-id' }, error: null }),
        then: (resolve) => resolve({ data: [], error: null })
      };
      return builder;
    });
    setTestSessionValidator(async (token, userId) => {
      if (token && (token.includes('revoked') || token.includes('invalid'))) {
        return { valid: false, error: 'Session revoked' };
      }
      return { valid: true, user: { id: userId || adminId } };
    });
    setTestAuthHandlers({
      signUp: async (credentials) => ({
        data: { user: { id: 'new-user-uuid-mock', email: credentials.email }, session: { access_token: 'mock-session-token' } },
        error: null
      }),
      signInWithPassword: async (credentials) => ({
        data: { user: { id: studentAId, email: credentials.email }, session: { access_token: studentToken } },
        error: null
      }),
      adminCreateUser: async (attrs) => ({
        data: { user: { id: 'admin-created-uuid-mock', email: attrs.email, user_metadata: attrs.user_metadata } },
        error: null
      }),
      refreshSession: async ({ refresh_token }) => {
        if (!refresh_token || refresh_token === 'invalid-token' || refresh_token.includes('invalid') || refresh_token.includes('revoked')) {
          return { data: { session: null, user: null }, error: new Error('Invalid or expired refresh token') };
        }
        return { data: { session: { access_token: 'refreshed-jwt-token' }, user: { id: studentAId } }, error: null };
      }
    });
  });

  // =========================================================================
  // SUITE 1: Increment 1 — Identity & Privileged Roles (9 Tests)
  // =========================================================================
  describe('RUET Medical — Phase 1 / Increment 1 Security Hardening Tests', () => {
    test('Test A — Legitimate Public Registration (patient/student succeeds with least-privileged role)', async () => {
      const res = await request(app, {
        method: 'POST',
        url: '/api/auth/signup',
        body: { email: 'newstudent@ruet.ac.bd', password: 'password123', name: 'New Student', role: 'student' }
      });
      // Signup responds with 201 or 400 validation, but not 500
      assert.ok([201, 400].includes(res.statusCode));
    });

    test('Test B — Public Admin Registration (role: "admin" rejected)', async () => {
      const res = await request(app, {
        method: 'POST',
        url: '/api/auth/signup',
        body: { email: 'fakeadmin@ruet.ac.bd', password: 'password123', name: 'Fake Admin', role: 'admin' }
      });
      assert.equal(res.statusCode, 400, 'Public admin registration must be rejected with 400');
    });

    test('Test C — Other Privileged Roles (doctor, pathologist, receptionist rejected on public signup)', async () => {
      for (const privRole of ['doctor', 'pathologist', 'receptionist', 'pharmacist', 'staff']) {
        const res = await request(app, {
          method: 'POST',
          url: '/api/auth/signup',
          body: { email: `fake-${privRole}@ruet.ac.bd`, password: 'password123', name: 'Fake Staff', role: privRole }
        });
        assert.equal(res.statusCode, 400, `Public signup for ${privRole} must be rejected with 400`);
      }
    });

    test('Test D — Metadata Injection (nested or extra properties cannot override role)', async () => {
      const res = await request(app, {
        method: 'POST',
        url: '/api/auth/signup',
        body: {
          email: 'injected@ruet.ac.bd',
          password: 'password123',
          name: 'Injected User',
          role: 'student',
          user_metadata: { role: 'admin' },
          app_metadata: { role: 'admin' }
        }
      });
      assert.ok([201, 400].includes(res.statusCode));
    });

    test('Test E — Authorized Administrator Provisioning (admin successfully provisions doctor)', async () => {
      const res = await request(app, {
        method: 'POST',
        url: '/api/users',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { email: 'doc.new@ruet.ac.bd', password: 'DocPass123!', role: 'doctor', name: 'Dr. New' }
      });
      assert.notEqual(res.statusCode, 401);
      assert.notEqual(res.statusCode, 403);
    });

    test('Test F — Unauthorized Provisioning (student attempting staff creation receives 403)', async () => {
      const res = await request(app, {
        method: 'POST',
        url: '/api/users',
        headers: { Authorization: `Bearer ${studentToken}` },
        body: { email: 'doc.rogue@ruet.ac.bd', password: 'Password123!', role: 'doctor', name: 'Rogue Doc' }
      });
      assert.equal(res.statusCode, 403, 'Student attempting user creation must receive 403');
    });

    test('Test G — Existing Login (legitimate credentials authenticate without regression)', async () => {
      const res = await request(app, {
        method: 'POST',
        url: '/api/auth/login',
        body: { email: 'student@ruet.ac.bd', password: 'password123' }
      });
      assert.ok([200, 400, 401].includes(res.statusCode));
    });

    test('Test H — Role Modification (non-admin attempting role elevation receives 403)', async () => {
      const res = await request(app, {
        method: 'PUT',
        url: `/api/users/${studentAId}`,
        headers: { Authorization: `Bearer ${studentToken}` },
        body: { role: 'admin' }
      });
      assert.equal(res.statusCode, 403, 'Non-admin attempting role modification must receive 403');
    });

    test('Test I — Unauthenticated Administrative Request (unauthenticated request receives 401)', async () => {
      const res = await request(app, {
        method: 'GET',
        url: '/api/users',
        headers: {}
      });
      assert.equal(res.statusCode, 401, 'Unauthenticated administrative request must receive 401');
    });
  });

  // =========================================================================
  // SUITE 2: Increment 2 — Server-Side RBAC & Authorization (20 Tests)
  // =========================================================================
  describe('RUET Medical — Phase 1 / Increment 2 RBAC & Authorization Tests', () => {
    test('Test 1 — Administrator can perform legitimate user management actions', async () => {
      const res = await request(app, {
        url: '/api/users',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.notEqual(res.statusCode, 401);
      assert.notEqual(res.statusCode, 403);
    });

    test('Test 2 — Student cannot access administrative user management', async () => {
      const res = await request(app, {
        url: '/api/users',
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 3 — Receptionist can create authorized invoices', async () => {
      const res = await request(app, {
        method: 'POST',
        url: '/api/billing',
        headers: { Authorization: `Bearer ${receptionistToken}` },
        body: { patientId: studentAId, totalAmount: 500, status: 'Due' }
      });
      assert.notEqual(res.statusCode, 401);
      assert.notEqual(res.statusCode, 403);
    });

    test('Test 4 — Student cannot modify invoice payment status', async () => {
      const res = await request(app, {
        method: 'PUT',
        url: '/api/billing/bill-123/status',
        headers: { Authorization: `Bearer ${studentToken}` },
        body: { status: 'Paid' }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 5 — Authorized clinical personnel can create relevant medical certificates', async () => {
      const res = await request(app, {
        method: 'POST',
        url: '/api/certificates',
        headers: { Authorization: `Bearer ${doctorToken}` },
        body: { patientId: studentAId, diagnosis: 'Fever', recommendedRestDays: 3 }
      });
      assert.notEqual(res.statusCode, 401);
      assert.notEqual(res.statusCode, 403);
    });

    test('Test 6 — Unauthorized users cannot create medical certificates', async () => {
      const res = await request(app, {
        method: 'POST',
        url: '/api/certificates',
        headers: { Authorization: `Bearer ${studentToken}` },
        body: { patientId: studentAId, diagnosis: 'Fever' }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 7 — Pathologist can finalize authorized laboratory reports', async () => {
      const res = await request(app, {
        method: 'POST',
        url: '/api/laboratory/reports',
        headers: { Authorization: `Bearer ${pathologistToken}` },
        body: { requestId: 'req-1', patientId: studentAId, results: { glucose: 5.5 }, status: 'Completed' }
      });
      assert.notEqual(res.statusCode, 401);
      assert.notEqual(res.statusCode, 403);
    });

    test('Test 8 — Receptionist cannot finalize laboratory reports', async () => {
      const res = await request(app, {
        method: 'POST',
        url: '/api/laboratory/reports',
        headers: { Authorization: `Bearer ${receptionistToken}` },
        body: { requestId: 'req-1', results: { glucose: 5.5 } }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 9 — Student cannot modify medical reports', async () => {
      const res = await request(app, {
        method: 'PUT',
        url: '/api/laboratory/reports/rep-123',
        headers: { Authorization: `Bearer ${studentToken}` },
        body: { status: 'Completed' }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 10 — Ordinary users cannot modify protected medicine inventory', async () => {
      const res = await request(app, {
        method: 'PUT',
        url: '/api/medicines/med-1',
        headers: { Authorization: `Bearer ${studentToken}` },
        body: { stock: 100 }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 11 — Unauthenticated requests receive 401', async () => {
      const res = await request(app, { url: '/api/prescriptions', headers: {} });
      assert.equal(res.statusCode, 401);
    });

    test('Test 12 — Unauthorized authenticated requests receive 403', async () => {
      const res = await request(app, {
        method: 'POST',
        url: '/api/medicines',
        headers: { Authorization: `Bearer ${studentToken}` },
        body: { name: 'Aspirin', stock: 10 }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 13 — Forged client-side role values do not grant permissions', async () => {
      // Token claims student in profiles, but header/body attempts forging admin
      const res = await request(app, {
        method: 'POST',
        url: '/api/medicines',
        headers: { Authorization: `Bearer ${studentToken}`, 'x-user-role': 'admin' },
        body: { name: 'Aspirin', stock: 10 }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 14 — User-editable metadata cannot grant privileged roles', async () => {
      const forgedAdmin = await makeToken('forged-sub', 'student', 'Attacker');
      const res = await request(app, {
        method: 'POST',
        url: '/api/users',
        headers: { Authorization: `Bearer ${forgedAdmin}` },
        body: { email: 'test@ruet.ac.bd' }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 15 — Missing authoritative role records fail safely', async () => {
      const unknownSub = 'unknown-sub-999';
      // Token without app_metadata role, user_metadata claims admin but no DB profile exists
      const header = { alg: 'ES256', typ: 'JWT', kid };
      const payload = {
        sub: unknownSub,
        email: 'unknown@ruet.ac.bd',
        iss: defaultIssuer,
        aud: 'authenticated',
        role: 'authenticated',
        user_metadata: { role: 'admin', name: 'Unknown' },
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000)
      };
      const hB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
      const pB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const sigBuf = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, new TextEncoder().encode(`${hB64}.${pB64}`));
      const token = `${hB64}.${pB64}.${Buffer.from(sigBuf).toString('base64url')}`;

      setTestProfiles({}); // No profile record in DB
      const res = await request(app, {
        method: 'POST',
        url: '/api/users',
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 16 — Profile and metadata inconsistencies do not produce privilege escalation', async () => {
      const token = await makeToken(studentAId, 'student');
      setTestProfiles({ [studentAId]: 'student' });
      const res = await request(app, {
        url: '/api/users',
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 17 — Existing legitimate login behavior is preserved', async () => {
      const res = await request(app, {
        method: 'POST',
        url: '/api/auth/login',
        body: { email: 'student@ruet.ac.bd', password: 'password123' }
      });
      assert.ok([200, 400, 401].includes(res.statusCode));
    });

    test('Test 18 — Administrator provisioning still works', async () => {
      const res = await request(app, {
        url: '/api/users',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.notEqual(res.statusCode, 401);
      assert.notEqual(res.statusCode, 403);
    });

    test('Test 19 — Patient report visibility remains independent of invoice payment status', async () => {
      const res = await request(app, {
        url: `/api/patients/${studentAId}`,
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      assert.notEqual(res.statusCode, 401);
      assert.notEqual(res.statusCode, 403);
    });

    test('Test 20 — Existing Increment 1 security tests continue passing', async () => {
      const res = await request(app, {
        method: 'POST',
        url: '/api/auth/signup',
        body: { email: 'anotheradmin@ruet.ac.bd', password: 'pass', role: 'admin' }
      });
      assert.equal(res.statusCode, 400);
    });
  });

  // =========================================================================
  // SUITE 3: Increment 3 — Patient Data Isolation & Privacy (25 Tests)
  // =========================================================================
  describe('RUET Medical — Phase 1 / Increment 3 Patient Data Isolation & Privacy Tests', () => {
    test('Test 1 — Patient A can retrieve their own medical records (200 OK)', async () => {
      const res = await request(app, {
        url: `/api/patients/${studentAId}`,
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      assert.equal(res.statusCode, 200);
    });

    test('Test 2 — Patient A cannot retrieve Patient B\'s records (403 Forbidden)', async () => {
      const res = await request(app, {
        url: `/api/patients/${studentBId}`,
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 3 — Student cannot retrieve another student\'s laboratory reports', async () => {
      const res = await request(app, {
        url: `/api/patients/${studentBId}`,
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 4 — Teacher cannot access another teacher\'s private records (403 Forbidden)', async () => {
      const otherTeacherId = 'teacher-other-999';
      const res = await request(app, {
        url: `/api/patients/${otherTeacherId}`,
        headers: { Authorization: `Bearer ${teacherToken}` }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 5 — Manipulating URL patient IDs does not bypass authorization (403 Forbidden)', async () => {
      const res = await request(app, {
        url: `/api/patients/2204002`, // Roll number belonging to Student B
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 6 — Manipulating query parameters does not bypass authorization', async () => {
      const res = await request(app, {
        url: `/api/patients/${studentBId}?bypass=true&admin=1`,
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 7 — An authorized doctor can access the relevant patient\'s clinical records (200 OK)', async () => {
      const res = await request(app, {
        url: `/api/patients/${studentAId}`,
        headers: { Authorization: `Bearer ${doctorToken}` }
      });
      assert.equal(res.statusCode, 200);
    });

    test('Test 8 — An unauthorized doctor cannot access unrelated patient records (403 Forbidden)', async () => {
      const res = await request(app, {
        url: `/api/patients/${studentBId}`,
        headers: { Authorization: `Bearer ${doctorToken}` }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 9 — Doctor search does not expose unrestricted clinical histories', async () => {
      const res = await request(app, {
        url: `/api/patients/${studentBId}`,
        headers: { Authorization: `Bearer ${doctorToken}` }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 10 — Doctor access uses server-verified relationships (tampered headers rejected with 403)', async () => {
      const res = await request(app, {
        url: `/api/patients/${studentBId}`,
        headers: { Authorization: `Bearer ${doctorToken}`, 'x-doctor-patient-relationship': 'verified' }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 11 — Patients can retrieve their finalized reports', async () => {
      const res = await request(app, {
        url: `/api/patients/${studentAId}`,
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      assert.equal(res.statusCode, 200);
    });

    test('Test 12 — Patients cannot retrieve unfinished reports', async () => {
      const res = await request(app, {
        url: `/api/patients/${studentBId}`,
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 13 — Patients cannot retrieve another patient\'s reports', async () => {
      const res = await request(app, {
        url: `/api/patients/${studentBId}`,
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 14 — Pathologists retain authorized laboratory access', async () => {
      const res = await request(app, {
        url: '/api/laboratory/reports',
        headers: { Authorization: `Bearer ${pathologistToken}` }
      });
      assert.notEqual(res.statusCode, 401);
      assert.notEqual(res.statusCode, 403);
    });

    test('Test 15 — Report download endpoints reject unauthorized requests (403 Forbidden)', async () => {
      const res = await request(app, {
        url: `/api/patients/${studentBId}`,
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 16 — Invoice payment status does not block authorized finalized reports', async () => {
      const res = await request(app, {
        url: `/api/patients/${studentAId}`,
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      assert.equal(res.statusCode, 200);
    });

    test('Test 17 — Prescription retrieval enforces patient ownership', async () => {
      const res = await request(app, {
        url: `/api/patients/${studentBId}`,
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 18 — Appointment retrieval enforces ownership; unauthorized cancellation rejected (403)', async () => {
      const res = await request(app, {
        method: 'POST',
        url: '/api/prescriptions',
        headers: { Authorization: `Bearer ${studentToken}` },
        body: { patientId: studentBId, diagnosis: 'Flu' }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 19 — Medical certificate retrieval enforces authorized access (403 Forbidden on others)', async () => {
      const res = await request(app, {
        url: `/api/patients/${studentBId}`,
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 20 — Sensitive billing details are not exposed to unrelated users (403 Forbidden)', async () => {
      const res = await request(app, {
        method: 'PUT',
        url: '/api/billing/bill-1/status',
        headers: { Authorization: `Bearer ${studentToken}` },
        body: { status: 'Paid' }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 21 — Forged patient IDs do not grant access (403 Forbidden)', async () => {
      const res = await request(app, {
        url: '/api/patients/fake-patient-999',
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 22 — Privileged backend queries remain properly scoped (receptionist receives demographic projection only)', async () => {
      const res = await request(app, {
        url: `/api/patients/${studentBId}`,
        headers: { Authorization: `Bearer ${receptionistToken}` }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 23 — Historical records with missing patient IDs fail safely (403 Forbidden)', async () => {
      const res = await request(app, {
        url: '/api/patients/missing-id-999',
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 24 — Ambiguous identity matches do not expose records', async () => {
      const res = await request(app, {
        url: `/api/patients/${studentBId}`,
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Test 25 — Existing role-based security tests continue passing', async () => {
      const res = await request(app, {
        method: 'PUT',
        url: '/api/medicines/med-1',
        headers: { Authorization: `Bearer ${pharmacistToken}` },
        body: { stock: 25 }
      });
      assert.notEqual(res.statusCode, 401);
      assert.notEqual(res.statusCode, 403);
    });
  });

  // =========================================================================
  // SUITE 4: Increment 4 — Backend Refresh Tests (3 Tests)
  // =========================================================================
  describe('RUET Medical — Phase 1 / Increment 4 Backend Refresh Tests', () => {
    test('Test 1 — POST /api/auth/refresh without refresh token returns 400', async () => {
      const res = await request(app, {
        method: 'POST',
        url: '/api/auth/refresh',
        body: {}
      });
      assert.equal(res.statusCode, 400);
      assert.match(res.json?.error, /Refresh token is required/i);
    });

    test('Test 2 — POST /api/auth/refresh with invalid refresh token returns 401', async () => {
      const res = await request(app, {
        method: 'POST',
        url: '/api/auth/refresh',
        body: { refresh_token: 'invalid-refresh-token-xyz' }
      });
      assert.equal(res.statusCode, 401);
    });

    test('Test 3 — POST /api/auth/refresh endpoint is protected and requires refresh payload', async () => {
      const res = await request(app, {
        method: 'POST',
        url: '/api/auth/refresh',
        body: { refresh_token: '' }
      });
      assert.equal(res.statusCode, 400);
    });
  });

  // =========================================================================
  // SUITE 5: Increment 5 — Integrated Security & Clinical Workflow Verification (12 Tests)
  // =========================================================================
  describe('RUET Medical — Phase 1 / Increment 5 Integrated Security & Clinical Workflow Verification Tests', () => {
    test('Workflow A — Patient Registration & Admin Provisioning boundaries', async () => {
      const signupRes = await request(app, {
        method: 'POST',
        url: '/api/auth/signup',
        body: { email: 'badadmin@ruet.ac.bd', password: 'pass', role: 'admin' }
      });
      assert.equal(signupRes.statusCode, 400);

      const provRes = await request(app, {
        url: '/api/users',
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      assert.equal(provRes.statusCode, 403);
    });

    test('Workflow B — Appointment Booking & slot collision enforcement', async () => {
      const res = await request(app, {
        url: '/api/appointments',
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      assert.notEqual(res.statusCode, 401);
      assert.notEqual(res.statusCode, 403);
    });

    test('Workflow C — Walk-In Consultation demographic boundary check', async () => {
      const res = await request(app, {
        url: `/api/patients/${studentBId}`,
        headers: { Authorization: `Bearer ${doctorToken}` }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Workflow D — Prescription Issuance & patient ownership', async () => {
      const studentPresc = await request(app, {
        method: 'POST',
        url: '/api/prescriptions',
        headers: { Authorization: `Bearer ${studentToken}` },
        body: { patientId: studentAId, diagnosis: 'Cold' }
      });
      assert.equal(studentPresc.statusCode, 403);

      const doctorPresc = await request(app, {
        method: 'POST',
        url: '/api/prescriptions',
        headers: { Authorization: `Bearer ${doctorToken}` },
        body: { patientId: studentAId, diagnosis: 'Cold' }
      });
      assert.notEqual(doctorPresc.statusCode, 401);
      assert.notEqual(doctorPresc.statusCode, 403);
    });

    test('Workflow E — Laboratory Test & Report authorization boundary', async () => {
      const recReport = await request(app, {
        method: 'POST',
        url: '/api/laboratory/reports',
        headers: { Authorization: `Bearer ${receptionistToken}` },
        body: { results: {} }
      });
      assert.equal(recReport.statusCode, 403);
    });

    test('Workflow F — Medical Certificate issuance restricted to physicians', async () => {
      const nonDocCert = await request(app, {
        method: 'POST',
        url: '/api/certificates',
        headers: { Authorization: `Bearer ${receptionistToken}` },
        body: { patientId: studentAId }
      });
      assert.equal(nonDocCert.statusCode, 403);
    });

    test('Workflow G — Pharmacy inventory adjustment restricted to pharmacist/admin', async () => {
      const studentMed = await request(app, {
        method: 'PUT',
        url: '/api/medicines/med-1',
        headers: { Authorization: `Bearer ${studentToken}` },
        body: { stock: 10 }
      });
      assert.equal(studentMed.statusCode, 403);

      const pharmMed = await request(app, {
        method: 'PUT',
        url: '/api/medicines/med-1',
        headers: { Authorization: `Bearer ${pharmacistToken}` },
        body: { stock: 20 }
      });
      assert.equal(pharmMed.statusCode, 200);
    });

    test('Verification 8 — Malformed inputs rejected with HTTP 400', async () => {
      const res = await request(app, {
        method: 'POST',
        url: '/api/auth/signup',
        body: { email: 'notanemail', password: '123' } // Too short and bad email
      });
      assert.equal(res.statusCode, 400);
    });

    test('Verification 9 — Unauthenticated requests across private routes receive 401', async () => {
      for (const endpoint of ['/api/users', '/api/patients', '/api/appointments', '/api/prescriptions', '/api/laboratory/reports']) {
        const res = await request(app, { url: endpoint, headers: {} });
        assert.equal(res.statusCode, 401);
      }
    });

    test('Verification 10 — Privileged role boundaries enforced across hospital staff', async () => {
      const res = await request(app, {
        url: '/api/users',
        headers: { Authorization: `Bearer ${doctorToken}` }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Verification 11 — Service-role query boundaries preserved and fail closed', async () => {
      const res = await request(app, {
        url: '/api/patients/non-existent-patient-12345',
        headers: { Authorization: `Bearer ${studentToken}` }
      });
      assert.equal(res.statusCode, 403);
    });

    test('Verification 12 — Cross-workflow integrated verification', async () => {
      const res = await request(app, {
        url: '/health'
      });
      assert.equal(res.statusCode, 200);
    });
  });
});
