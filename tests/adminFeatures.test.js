import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { setTestJwks, setTestProfiles, setTestSessionValidator, clearRoleCache } from '../src/services/authService.js';
import { setTestMedicinesData } from '../src/controllers/medicineController.js';
import supabase, { setTestAuthHandlers, setTestDbHandler } from '../src/config/supabase.js';

// In-memory HTTP dispatcher for Express
function request(app, options = {}, clientIp = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    Object.defineProperty(socket, 'remoteAddress', { value: clientIp });

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


const ADMIN_ID = 'e6666666-6666-6666-6666-666666666666';
const STUDENT_ID = 'a1111111-1111-1111-1111-111111111111';
const DOCTOR_ID = 'd4444444-4444-4444-4444-444444444444';
const TARGET_ID = 'f7777777-7777-7777-7777-777777777777';

// Chainable query-builder mock: records calls, resolves to the configured result.
function makeBuilder(table, results, calls) {
  const entry = { table, ops: [] };
  calls.push(entry);
  const builder = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') {
        const r = typeof results[table] === 'function' ? results[table](entry) : (results[table] || { data: [], error: null });
        return (resolve) => resolve(r);
      }
      if (prop === 'maybeSingle' || prop === 'single') {
        return async () => {
          const r = typeof results[table] === 'function' ? results[table](entry) : (results[table] || { data: null, error: null });
          const data = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
          return { ...r, data };
        };
      }
      return (...args) => { entry.ops.push([prop, ...args]); return builder; };
    }
  });
  return builder;
}

let ipCounter = 10;
const nextIp = () => `10.20.0.${ipCounter++}`;

describe('Admin module — stats, user management, catalog & inventory', () => {
  let keyPair;
  const kid = 'admin-test-key';
  const issuer = `${env.SUPABASE_URL}/auth/v1`;
  let adminToken, studentToken, doctorToken;
  let calls;
  let results;
  const adminApiCalls = [];

  async function makeToken(sub, role) {
    const header = { alg: 'ES256', typ: 'JWT', kid };
    const payload = {
      sub, email: `${role}@ruet.ac.bd`, iss: issuer, aud: 'authenticated', role: 'authenticated',
      app_metadata: { role }, user_metadata: { role, name: role },
      exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000)
    };
    const h = Buffer.from(JSON.stringify(header)).toString('base64url');
    const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, Buffer.from(`${h}.${p}`));
    return `${h}.${p}.${Buffer.from(sig).toString('base64url')}`;
  }

  const call = (method, url, token, body) => request(app, {
    method, url, body, headers: token ? { authorization: `Bearer ${token}` } : {}
  }, nextIp());

  before(async () => {
    keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    Object.assign(jwk, { kid, alg: 'ES256', use: 'sig' });
    setTestJwks({ keys: [jwk] });
    setTestProfiles({ [ADMIN_ID]: 'admin', [STUDENT_ID]: 'student', [DOCTOR_ID]: 'doctor' });
    setTestSessionValidator(async () => ({ valid: true }));
    adminToken = await makeToken(ADMIN_ID, 'admin');
    studentToken = await makeToken(STUDENT_ID, 'student');
    doctorToken = await makeToken(DOCTOR_ID, 'doctor');

    setTestAuthHandlers({
      adminCreateUser: async (attrs) => {
        adminApiCalls.push(['createUser', attrs]);
        return { data: { user: { id: TARGET_ID, created_at: new Date().toISOString() } }, error: null };
      }
    });
    supabase.auth.admin.updateUserById = async (id, attrs) => { adminApiCalls.push(['updateUserById', id, attrs]); return { data: {}, error: null }; };
    supabase.auth.admin.deleteUser = async (id) => { adminApiCalls.push(['deleteUser', id]); return { data: {}, error: null }; };
    supabase.auth.admin.listUsers = async () => ({
      data: { users: [{ id: TARGET_ID, user_metadata: { role: 'student' }, banned_until: '2999-01-01T00:00:00Z', email_confirmed_at: '2026-01-01' }] },
      error: null
    });
  });

  beforeEach(() => {
    clearRoleCache();
    setTestMedicinesData(null);
    calls = [];
    results = {};
    adminApiCalls.length = 0;
    setTestDbHandler((table) => makeBuilder(table, results, calls));
  });

  test('GET /api/admin/stats is forbidden for non-admins', async () => {
    const res = await call('GET', '/api/admin/stats', studentToken);
    assert.equal(res.statusCode, 403);
    const res2 = await call('GET', '/api/admin/stats');
    assert.equal(res2.statusCode, 401);
  });

  test('GET /api/admin/stats aggregates users, appointments, billing and inventory', async () => {
    const today = new Date().toISOString().slice(0, 10);
    results = {
      profiles: { data: [{ id: '1', role: 'admin' }, { id: '2', role: 'patient' }, { id: '3', role: 'patient' }, { id: '4', role: 'doctor' }], error: null },
      appointments: { data: [
        { id: 'a1', date: today, status: 'pending', doctorId: 'd1', doctorName: 'Dr. A' },
        { id: 'a2', date: today, status: 'accepted', doctorId: 'd1', doctorName: 'Dr. A' },
        { id: 'a3', date: '2020-01-01', status: 'rejected', doctorId: 'd2', doctorName: 'Dr. B' }
      ], error: null },
      prescriptions: { data: null, count: 12, error: null },
      certificates: { data: null, count: 3, error: null },
      lab_requests: { data: [{ id: 'l1', status: 'Pending' }, { id: 'l2', status: 'Completed' }], error: null },
      lab_reports: { data: null, count: 7, error: null },
      bills: { data: [
        { id: 'b1', totalAmount: 100, status: 'Paid', date: new Date().toISOString() },
        { id: 'b2', totalAmount: 50.5, status: 'Due', date: new Date().toISOString() }
      ], error: null },
      medicines: { data: [{ id: 'm1', name: 'Napa', stock: 0 }, { id: 'm2', name: 'Seclo', stock: 5 }, { id: 'm3', name: 'Ace', stock: 200 }], error: null },
      medical_tests: { data: null, count: 30, error: null }
    };
    const res = await call('GET', '/api/admin/stats', adminToken);
    assert.equal(res.statusCode, 200);
    const s = res.json;
    assert.equal(s.users.total, 4);
    assert.equal(s.users.byRole.patient, 2);
    assert.equal(s.appointments.total, 3);
    assert.equal(s.appointments.today, 2);
    assert.equal(s.appointments.byStatus.pending, 1);
    assert.equal(s.appointments.trend.length, 14);
    assert.equal(s.appointments.topDoctors[0].doctorName, 'Dr. A');
    assert.equal(s.clinical.prescriptions, 12);
    assert.equal(s.laboratory.pending, 1);
    assert.equal(s.laboratory.reports, 7);
    assert.equal(s.billing.revenueCollected, 100);
    assert.equal(s.billing.revenueDue, 50.5);
    assert.equal(s.inventory.lowStockCount, 2);
    assert.equal(s.inventory.outOfStockCount, 1);
    assert.deepEqual(s.warnings, []);
  });

  test('GET /api/admin/stats degrades gracefully when a source fails', async () => {
    results = { bills: { data: null, error: { message: 'relation does not exist' } } };
    const res = await call('GET', '/api/admin/stats', adminToken);
    assert.equal(res.statusCode, 200);
    assert.ok(res.json.warnings.includes('bills'));
    assert.equal(res.json.billing.totalBills, null);
  });

  test('GET /api/admin/activity merges and sorts recent events', async () => {
    results = {
      appointments: { data: [{ id: 'a1', patientName: 'P', doctorName: 'D', status: 'pending', date: '2026-11-01', createdAt: '2026-11-01T10:00:00Z' }], error: null },
      prescriptions: { data: [{ id: 'r1', patientName: 'P', doctorName: 'D', diagnosis: 'Flu', createdAt: '2026-11-03T10:00:00Z' }], error: null },
      bills: { data: [], error: null },
      profiles: { data: [{ id: 'u1', name: 'New', role: 'patient', created_at: '2026-11-02T10:00:00Z' }], error: null }
    };
    const res = await call('GET', '/api/admin/activity?limit=10', adminToken);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json.events.map((e) => e.type), ['prescription', 'user', 'appointment']);
  });

  test('GET /api/users merges auth status and account type', async () => {
    results = { profiles: { data: [{ id: TARGET_ID, name: 'S', email: 's@x.com', role: 'patient', patients: [{ roll_number: '2204001' }] }], error: null } };
    const res = await call('GET', '/api/users', adminToken);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json[0].accountType, 'student');
    assert.equal(res.json[0].status, 'disabled');
    assert.equal(res.json[0].patients.roll_number, '2204001');
  });

  test('GET /api/users?role=student filters by the valid enum value patient', async () => {
    results = { profiles: { data: [], error: null } };
    const res = await call('GET', '/api/users?role=student', adminToken);
    assert.equal(res.statusCode, 200);
    const eq = calls.find((c) => c.table === 'profiles').ops.find((o) => o[0] === 'eq');
    assert.deepEqual(eq, ['eq', 'role', 'patient']);
    const bad = await call('GET', '/api/users?role=superuser', adminToken);
    assert.equal(bad.statusCode, 400);
  });

  test('POST /api/users validates input', async () => {
    const res = await call('POST', '/api/users', adminToken, { name: 'X', email: 'nope', password: '123', role: 'wizard' });
    assert.equal(res.statusCode, 400);
    const fields = res.json.details.map((d) => d.field);
    assert.ok(fields.includes('email'));
    assert.ok(fields.includes('password'));
    assert.ok(fields.includes('role'));
    assert.equal(adminApiCalls.length, 0);
  });

  test('POST /api/users stores student accounts with the patient profile role', async () => {
    results = { profiles: { data: null, error: null }, patients: { data: null, error: null } };
    const res = await call('POST', '/api/users', adminToken, {
      name: 'New Student', email: 'New@Student.ruet.ac.bd', password: 'password123', role: 'student',
      patientData: { universityId: '2204099', age: '21', department: 'CSE' }
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json.role, 'patient');
    assert.equal(res.json.accountType, 'student');
    const create = adminApiCalls.find((c) => c[0] === 'createUser')[1];
    assert.equal(create.email, 'new@student.ruet.ac.bd');
    assert.equal(create.user_metadata.role, 'student');
    const profileUpsert = calls.find((c) => c.table === 'profiles').ops.find((o) => o[0] === 'upsert');
    assert.equal(profileUpsert[1].role, 'patient');
    const patientUpsert = calls.find((c) => c.table === 'patients').ops.find((o) => o[0] === 'upsert');
    assert.equal(patientUpsert[1].roll_number, '2204099');
    assert.equal(patientUpsert[1].age, 21);
  });

  const doctorBody = (extra = {}) => ({ name: 'Dr. Nusrat Jahan', email: 'Nusrat@RUET.ac.bd', password: 'password123', role: 'doctor', ...extra });
  const directoryOps = () => calls.filter((c) => c.table === 'staff_directory').flatMap((c) => c.ops.map((o) => o[0]));

  test('POST /api/users publishes new doctors to the public directory', async () => {
    results = {
      profiles: { data: null, error: null },
      staff_directory: (entry) => entry.ops.some((o) => o[0] === 'insert')
        ? { data: [{ id: 42, ...entry.ops.find((o) => o[0] === 'insert')[1][0] }], error: null }
        : { data: null, error: null }
    };
    const res = await call('POST', '/api/users', adminToken, doctorBody({
      directoryListing: { designation: 'Senior Medical Officer', contact: '01711000000' }
    }));
    assert.equal(res.statusCode, 201);
    const insert = calls.filter((c) => c.table === 'staff_directory').flatMap((c) => c.ops).find((o) => o[0] === 'insert');
    assert.deepEqual(insert[1][0], {
      name: 'Dr. Nusrat Jahan', category: 'doctor', designation: 'Senior Medical Officer',
      contact: '01711000000', email: 'nusrat@ruet.ac.bd'
    });
    assert.equal(res.json.directoryEntry.id, 42);
    assert.equal(res.json.warning, undefined);
  });

  test('Doctor directory listing defaults the designation and is published without explicit options', async () => {
    results = { profiles: { data: null, error: null }, staff_directory: { data: [], error: null } };
    const res = await call('POST', '/api/users', adminToken, doctorBody());
    assert.equal(res.statusCode, 201);
    const insert = calls.filter((c) => c.table === 'staff_directory').flatMap((c) => c.ops).find((o) => o[0] === 'insert');
    assert.equal(insert[1][0].designation, 'Medical Officer');
  });

  test('Existing directory entries (matched by email) are updated, not duplicated', async () => {
    results = {
      profiles: { data: null, error: null },
      staff_directory: (entry) => entry.ops.some((o) => o[0] === 'update')
        ? { data: [{ id: 7, name: 'Dr. Nusrat Jahan' }], error: null }
        : { data: { id: 7 }, error: null }
    };
    const res = await call('POST', '/api/users', adminToken, doctorBody());
    assert.equal(res.statusCode, 201);
    assert.ok(directoryOps().includes('update'));
    assert.ok(!directoryOps().includes('insert'));
    const eqs = calls.filter((c) => c.table === 'staff_directory').flatMap((c) => c.ops).filter((o) => o[0] === 'eq');
    assert.ok(eqs.some((o) => o[1] === 'email' && o[2] === 'nusrat@ruet.ac.bd'));
  });

  test('Admins can opt out of publishing a doctor; other roles are never published', async () => {
    results = { profiles: { data: null, error: null }, patients: { data: null, error: null } };
    const optOut = await call('POST', '/api/users', adminToken, doctorBody({ directoryListing: { publish: false } }));
    assert.equal(optOut.statusCode, 201);
    const receptionist = await call('POST', '/api/users', adminToken, {
      name: 'Front Desk', email: 'desk@ruet.ac.bd', password: 'password123', role: 'receptionist',
      directoryListing: { publish: true, designation: 'Receptionist' }
    });
    assert.equal(receptionist.statusCode, 201);
    assert.deepEqual(directoryOps(), []);
  });

  test('A directory failure does not block doctor creation and is reported as a warning', async () => {
    results = {
      profiles: { data: null, error: null },
      staff_directory: { data: null, error: { message: 'permission denied for table staff_directory' } }
    };
    const res = await call('POST', '/api/users', adminToken, doctorBody());
    assert.equal(res.statusCode, 201);
    assert.match(res.json.warning, /not added to the public directory/);
    assert.ok(!adminApiCalls.some((c) => c[0] === 'deleteUser'));
  });

  test('POST /api/users rolls back the auth account if the profile cannot be saved', async () => {
    results = { profiles: { data: null, error: { message: 'invalid input value for enum' } } };
    const res = await call('POST', '/api/users', adminToken, { name: 'Doc', email: 'doc@x.com', password: 'password123', role: 'doctor' });
    assert.equal(res.statusCode, 400);
    assert.ok(adminApiCalls.some((c) => c[0] === 'deleteUser' && c[1] === TARGET_ID));
  });

  test('Admins cannot delete, disable or demote themselves', async () => {
    const del = await call('DELETE', `/api/users/${ADMIN_ID}`, adminToken);
    assert.equal(del.statusCode, 400);
    const dis = await call('PATCH', `/api/users/${ADMIN_ID}/status`, adminToken, { active: false });
    assert.equal(dis.statusCode, 400);
    const demote = await call('PUT', `/api/users/${ADMIN_ID}`, adminToken, { role: 'doctor' });
    assert.equal(demote.statusCode, 400);
    assert.equal(adminApiCalls.length, 0);
  });

  test('PATCH /api/users/:id/status bans and unbans accounts', async () => {
    const bad = await call('PATCH', `/api/users/${TARGET_ID}/status`, adminToken, { active: 'no' });
    assert.equal(bad.statusCode, 400);
    const off = await call('PATCH', `/api/users/${TARGET_ID}/status`, adminToken, { active: false });
    assert.equal(off.statusCode, 200);
    assert.equal(off.json.status, 'disabled');
    const on = await call('PATCH', `/api/users/${TARGET_ID}/status`, adminToken, { active: true });
    assert.equal(on.json.status, 'active');
    assert.deepEqual(adminApiCalls.map((c) => c[2].ban_duration), ['876000h', 'none']);
  });

  test('PUT /api/users/:id/password enforces password length', async () => {
    const bad = await call('PUT', `/api/users/${TARGET_ID}/password`, adminToken, { password: 'short' });
    assert.equal(bad.statusCode, 400);
    const ok = await call('PUT', `/api/users/${TARGET_ID}/password`, adminToken, { password: 'a-much-longer-password' });
    assert.equal(ok.statusCode, 200);
  });

  test('User management endpoints are forbidden for doctors', async () => {
    const res = await call('PATCH', `/api/users/${TARGET_ID}/status`, doctorToken, { active: false });
    assert.equal(res.statusCode, 403);
  });

  test('PATCH /api/medicines/:id/adjust restocks and refuses negative stock', async () => {
    results = { medicines: (entry) => {
      const isUpdate = entry.ops.some((o) => o[0] === 'update');
      return isUpdate
        ? { data: { id: 'm1', name: 'Napa', stock: 15 }, error: null }
        : { data: { id: 'm1', name: 'Napa', stock: 5 }, error: null };
    } };
    const up = await call('PATCH', '/api/medicines/m1/adjust', adminToken, { delta: 10 });
    assert.equal(up.statusCode, 200);
    assert.equal(up.json.stock, 15);
    const down = await call('PATCH', '/api/medicines/m1/adjust', adminToken, { delta: -6 });
    assert.equal(down.statusCode, 400);
    const forbidden = await call('PATCH', '/api/medicines/m1/adjust', studentToken, { delta: 1 });
    assert.equal(forbidden.statusCode, 403);
  });

  test('DELETE /api/medicines/:id is admin-only and 404s on missing rows', async () => {
    const forbidden = await call('DELETE', '/api/medicines/m1', doctorToken);
    assert.equal(forbidden.statusCode, 403);
    results = { medicines: { data: [], error: null } };
    const missing = await call('DELETE', '/api/medicines/m1', adminToken);
    assert.equal(missing.statusCode, 404);
    results = { medicines: { data: [{ id: 'm1' }], error: null } };
    const ok = await call('DELETE', '/api/medicines/m1', adminToken);
    assert.equal(ok.statusCode, 200);
  });

  test('Only admins may rename medicines', async () => {
    const res = await call('PUT', '/api/medicines/m1', doctorToken, { name: 'Renamed' });
    assert.equal(res.statusCode, 403);
  });

  test('Medical test catalog CRUD validates input and enforces roles', async () => {
    const bad = await call('POST', '/api/tests', adminToken, { name: 'X', category: 'Magic', studentPrice: -1 });
    assert.equal(bad.statusCode, 400);
    results = { medical_tests: { data: [{ id: 'T-050', name: 'CBC', category: 'Pathology', studentPrice: 50, employeePrice: 100 }], error: null } };
    const ok = await call('POST', '/api/tests', adminToken, { name: 'CBC', category: 'Pathology', studentPrice: 50, employeePrice: 100 });
    assert.equal(ok.statusCode, 201);
    const upd = await call('PUT', '/api/tests/T-050', adminToken, { studentPrice: 60 });
    assert.equal(upd.statusCode, 200);
    const del = await call('DELETE', '/api/tests/T-050', studentToken);
    assert.equal(del.statusCode, 403);
  });

  test('Directory management is admin-only and validated', async () => {
    const forbidden = await call('POST', '/api/directory', doctorToken, { name: 'Dr. X', category: 'doctor', designation: 'MO' });
    assert.equal(forbidden.statusCode, 403);
    const bad = await call('POST', '/api/directory', adminToken, { name: 'Dr. X', category: 'nurse', designation: 'MO' });
    assert.equal(bad.statusCode, 400);
    results = { staff_directory: { data: [{ id: 9, name: 'Dr. X', category: 'doctor', designation: 'MO' }], error: null } };
    const ok = await call('POST', '/api/directory', adminToken, { name: 'Dr. X', category: 'doctor', designation: 'MO', email: '' });
    assert.equal(ok.statusCode, 201);
    const upd = await call('PUT', '/api/directory/9', adminToken, { designation: 'Chief MO' });
    assert.equal(upd.statusCode, 200);
    const updOp = calls.filter((c) => c.table === 'staff_directory').pop().ops.find((o) => o[0] === 'update');
    assert.deepEqual(updOp[1], { designation: 'Chief MO' });
  });

  test('Billing records are restricted to admins and receptionists', async () => {
    const res = await call('GET', '/api/billing', studentToken);
    assert.equal(res.statusCode, 403);
    results = { bills: { data: [], error: null } };
    const ok = await call('GET', '/api/billing', adminToken);
    assert.equal(ok.statusCode, 200);
    const badStatus = await call('PUT', '/api/billing/b1/status', adminToken, { status: 'Refunded' });
    assert.equal(badStatus.statusCode, 400);
  });
});
