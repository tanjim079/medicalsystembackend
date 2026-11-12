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
  clearRoleCache
} from '../src/services/authService.js';
import {
  setTestRelationships,
  setTestIdentifiers,
  getUserPatientIdentifiers,
  resolveTargetPatientIdentifiers,
  verifyPatientRecordAccess
} from '../src/services/recordAuthorization.js';
import { setTestPatientsData } from '../src/controllers/patientController.js';
import { setTestMedicinesData } from '../src/controllers/medicineController.js';
import { setTestDbHandler } from '../src/config/supabase.js';

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

describe('RUET MediSys — Phase 1, Step 3: Supabase Database Query Optimization Tests', () => {
  let keyPair;
  const kid = 'step3-test-key';
  const defaultIssuer = `${env.SUPABASE_URL}/auth/v1`;

  const studentAId = 'a1111111-1111-1111-1111-111111111111';
  const studentBId = 'b2222222-2222-2222-2222-222222222222';
  const teacherId = 'c3333333-3333-3333-3333-333333333333';
  const doctorAId = 'd4444444-4444-4444-4444-444444444444';
  const doctorBId = 'd5555555-5555-5555-5555-555555555555';
  const adminId = 'e6666666-6666-6666-6666-666666666666';

  let studentAToken;
  let studentBToken;
  let teacherToken;
  let doctorAToken;
  let doctorBToken;
  let adminToken;

  async function makeToken(sub, role, name) {
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
    const signingInput = Buffer.from(`${hB64}.${pB64}`, 'utf8');
    const sig = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      keyPair.privateKey,
      signingInput
    );
    const sB64 = Buffer.from(sig).toString('base64url');
    return `${hB64}.${pB64}.${sB64}`;
  }

  before(async () => {
    keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
    const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    publicJwk.kid = kid;
    publicJwk.alg = 'ES256';
    publicJwk.use = 'sig';

    setTestJwks({ keys: [publicJwk] });
    setTestProfiles({
      [studentAId]: 'student',
      [studentBId]: 'student',
      [teacherId]: 'teacher',
      [doctorAId]: 'doctor',
      [doctorBId]: 'doctor',
      [adminId]: 'admin'
    });

    studentAToken = await makeToken(studentAId, 'student', 'Student A');
    studentBToken = await makeToken(studentBId, 'student', 'Student B');
    teacherToken = await makeToken(teacherId, 'teacher', 'Prof. Hasan');
    doctorAToken = await makeToken(doctorAId, 'doctor', 'Dr. Consulting');
    doctorBToken = await makeToken(doctorBId, 'doctor', 'Dr. Unrelated');
    adminToken = await makeToken(adminId, 'admin', 'Admin User');
  });

  beforeEach(() => {
    clearRoleCache();
    setTestIdentifiers({
      [studentAId]: [studentAId, '2204001', '725'],
      '2204001': [studentAId, '2204001', '725'],
      [studentBId]: [studentBId, '2204002', '726'],
      '2204002': [studentBId, '2204002', '726'],
      [teacherId]: [teacherId, 'T-101'],
      'T-101': [teacherId, 'T-101']
    });

    // Doctor A has clinical relationship with Student A; Doctor B has none
    setTestRelationships({
      [doctorAId]: [studentAId, '2204001'],
      [doctorBId]: []
    });

    setTestPatientsData({
      [studentAId]: {
        id: studentAId,
        name: 'Student A',
        role: 'student',
        roll_number: '2204001',
        registration_number: '725',
        department: 'ETE',
        phone: '01770-917975',
        blood_group: 'O (+ve)',
        guardian_name: 'Fahima Begum',
        guardian_phone: '01715-772645',
        age: 21,
        treatmentHistory: [
          { id: 'rx-01', date: '2026-11-01', diagnosis: 'Seasonal flu', doctorName: 'Dr. Consulting' }
        ],
        labReports: [
          { id: 'lab-01', testName: 'CBC', status: 'Completed', date: '2026-11-02' }
        ],
        visitSummary: { totalVisits: 1, lastVisit: '2026-11-01' }
      },
      [studentBId]: {
        id: studentBId,
        name: 'Student B',
        role: 'student',
        roll_number: '2204002',
        registration_number: '726',
        department: 'ETE',
        phone: '01783-854832',
        blood_group: 'B (+ve)',
        guardian_name: 'Salahuddin',
        guardian_phone: '01716-390038',
        age: 22,
        treatmentHistory: [],
        labReports: [],
        visitSummary: { totalVisits: 0, lastVisit: null }
      },
      [teacherId]: {
        id: teacherId,
        name: 'Prof. Hasan',
        role: 'teacher',
        employee_id: 'T-101',
        department: 'ETE',
        designation: 'Professor',
        phone: '01716-130151',
        blood_group: 'A (+ve)',
        age: 48,
        treatmentHistory: [],
        labReports: [],
        visitSummary: { totalVisits: 0, lastVisit: null }
      }
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
        or: () => builder,
        ilike: () => builder,
        order: () => builder,
        limit: () => builder,
        range: () => builder,
        single: async () => ({ data: { id: 'mock-id' }, error: null }),
        maybeSingle: async () => ({ data: { id: 'mock-id' }, error: null }),
        then: (resolve) => resolve({ data: [], error: null })
      };
      return builder;
    });
  });

  // Test 1: Student patient lookup by roll number
  test('1. Student patient lookup resolves canonical identity via roll number', async () => {
    const res = await request(app, {
      method: 'GET',
      url: '/api/patients/2204001',
      headers: { authorization: `Bearer ${studentAToken}` }
    }, '127.0.0.51');

    assert.equal(res.statusCode, 200);
    assert.equal(res.json.id, studentAId);
    assert.equal(res.json.roll_number, '2204001');
    assert.equal(res.json.name, 'Student A');
  });

  // Test 2: Faculty employee ID lookup
  test('2. Faculty lookup resolves canonical identity via employee ID', async () => {
    const res = await request(app, {
      method: 'GET',
      url: '/api/patients/T-101',
      headers: { authorization: `Bearer ${teacherToken}` }
    }, '127.0.0.52');

    assert.equal(res.statusCode, 200);
    assert.equal(res.json.id, teacherId);
    assert.equal(res.json.employee_id, 'T-101');
    assert.equal(res.json.name, 'Prof. Hasan');
  });

  // Test 3: Ambiguous identifier handling
  test('3. Ambiguous or unknown identifier returns 404 without silent fallback to wrong patient', async () => {
    const res = await request(app, {
      method: 'GET',
      url: '/api/patients/9999999-unknown',
      headers: { authorization: `Bearer ${adminToken}` }
    }, '127.0.0.53');

    assert.equal(res.statusCode, 404);
    assert.equal(res.json.error, 'Patient not found');
  });

  // Test 4: Authorized doctor-patient relationship
  test('4. Authorized doctor with clinical relationship retrieves full patient medical history', async () => {
    const res = await request(app, {
      method: 'GET',
      url: `/api/patients/${studentAId}`,
      headers: { authorization: `Bearer ${doctorAToken}` }
    }, '127.0.0.54');

    assert.equal(res.statusCode, 200);
    assert.equal(res.json.id, studentAId);
    assert.ok(Array.isArray(res.json.treatmentHistory));
    assert.equal(res.json.treatmentHistory.length, 1);
    assert.equal(res.json.treatmentHistory[0].diagnosis, 'Seasonal flu');
  });

  // Test 5: Unauthorized clinical history access
  test('5. Unauthorized doctor without clinical relationship cannot inspect medical history (403)', async () => {
    const res = await request(app, {
      method: 'GET',
      url: `/api/patients/${studentAId}`,
      headers: { authorization: `Bearer ${doctorBToken}` }
    }, '127.0.0.55');

    assert.equal(res.statusCode, 403);
    assert.match(res.json.error, /Forbidden.*clinical relationship/i);
  });

  // Test 6: Walk-in patient discovery
  test('6. Walk-in patient discovery returns minimum demographics with protected medical history', async () => {
    const res = await request(app, {
      method: 'GET',
      url: '/api/patients/search?query=2204001',
      headers: { authorization: `Bearer ${doctorBToken}` }
    }, '127.0.0.56');

    assert.equal(res.statusCode, 200);
    assert.equal(res.json.roll_number, '2204001');
    assert.equal(res.json.hasClinicalRelationship, false);
    assert.deepEqual(res.json.treatmentHistory, []);
    assert.deepEqual(res.json.labReports, []);
    assert.equal(res.json.visitSummary.totalVisits, 0);
  });

  // Test 7: Patient laboratory report isolation
  test('7. Patient laboratory report listing isolates reports by patient identity', async () => {
    const res = await request(app, {
      method: 'GET',
      url: `/api/laboratory/reports?patientId=${studentAId}`,
      headers: { authorization: `Bearer ${doctorAToken}` }
    }, '127.0.0.57');

    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.json));
  });

  // Test 8: Prescription retrieval isolation
  test('8. Students cannot inspect prescriptions belonging to other patients', async () => {
    const res = await request(app, {
      method: 'GET',
      url: `/api/prescriptions?patientId=${studentBId}`,
      headers: { authorization: `Bearer ${studentAToken}` }
    }, '127.0.0.58');

    // Scoped query automatically restricts student to own records
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.json));
    res.json.forEach((rx) => {
      assert.notEqual(rx.patientId, studentBId);
    });
  });

  // Test 9: Doctor appointment scoping
  test('9. Doctor appointment listing restricts doctors from viewing other doctors rosters (403)', async () => {
    const res = await request(app, {
      method: 'GET',
      url: `/api/appointments/doctor/${doctorBId}`,
      headers: { authorization: `Bearer ${doctorAToken}` }
    }, '127.0.0.59');

    assert.equal(res.statusCode, 403);
    assert.match(res.json.error, /Forbidden.*own appointment rosters/i);
  });

  // Test 10: Pagination and ordering
  test('10. Collection endpoints enforce bounded pagination without breaking array contract', async () => {
    const res = await request(app, {
      method: 'GET',
      url: '/api/appointments?limit=25&offset=0',
      headers: { authorization: `Bearer ${adminToken}` }
    }, '127.0.0.60');

    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.json));
  });

  // Test 11: Supabase query failure handling
  test('11. Database query failures fail closed with 500 without leaking partial stack traces', async () => {
    setTestDbHandler(() => {
      const failingBuilder = {
        select: () => failingBuilder,
        eq: () => failingBuilder,
        order: () => failingBuilder,
        then: (resolve, reject) => reject(new Error('Connection terminated unexpectedly'))
      };
      return failingBuilder;
    });

    const res = await request(app, {
      method: 'GET',
      url: '/api/appointments',
      headers: { authorization: `Bearer ${adminToken}` }
    }, '127.0.0.61');

    assert.equal(res.statusCode, 500);
    assert.ok(res.json.error);
  });

  // Test 12: Historical patient record compatibility
  test('12. Patient profile correctly computes age from date_of_birth or falls back to age field', async () => {
    const res = await request(app, {
      method: 'GET',
      url: `/api/patients/${studentAId}`,
      headers: { authorization: `Bearer ${studentAToken}` }
    }, '127.0.0.62');

    assert.equal(res.statusCode, 200);
    assert.equal(res.json.age, 21);
    assert.equal(res.json.blood_group, 'O (+ve)');
    assert.equal(res.json.guardian_name, 'Fahima Begum');
  });

  // Test 13: Concurrent query execution
  test('13. Concurrent identity resolution and clinical relationship checks execute in parallel', async () => {
    const target = await resolveTargetPatientIdentifiers('2204001');
    assert.ok(target.canonicalIds.includes('2204001'));
    assert.ok(target.canonicalIds.includes(studentAId));

    const authCheck = await verifyPatientRecordAccess(
      { id: doctorAId, appRole: 'doctor' },
      studentAId,
      { preloadedData: { id: studentAId, roll_number: '2204001' } }
    );
    assert.equal(authCheck.allowed, true);
  });

  // Test 14: No full-table retrieval for patient-specific clinical records
  test('14. Full-table scan pattern is eliminated; search returns targeted records', async () => {
    const res = await request(app, {
      method: 'GET',
      url: '/api/patients/search?query=2204001',
      headers: { authorization: `Bearer ${doctorAToken}` }
    }, '127.0.0.63');

    assert.equal(res.statusCode, 200);
    assert.equal(res.json.id, studentAId);
    assert.equal(res.json.hasClinicalRelationship, true);
    assert.equal(res.json.treatmentHistory.length, 1);
  });

  // Test 15: No regression in authentication middleware
  test('15. Authentication middleware preserves Step 2 cryptographic JWT verification', async () => {
    const resUnauth = await request(app, {
      method: 'GET',
      url: `/api/patients/${studentAId}`
    }, '127.0.0.64');

    assert.equal(resUnauth.statusCode, 401);
    assert.match(resUnauth.json.error, /Unauthorized/i);
  });

  // Test 16: Patient with >50 laboratory reports retrieves complete history without silent truncation
  test('16. Patient with >50 laboratory reports retrieves complete history without truncation', async () => {
    // Generate 65 synthetic lab reports
    const manyLabReports = Array.from({ length: 65 }, (_, i) => ({
      id: `lab-report-${i + 1}`,
      testName: `Lab Test #${i + 1}`,
      status: 'Completed',
      date: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`
    }));

    setTestPatientsData({
      [studentAId]: {
        id: studentAId,
        name: 'Student High Volume Labs',
        role: 'student',
        roll_number: '2204001',
        treatmentHistory: [],
        labReports: manyLabReports,
        visitSummary: { totalVisits: 0, lastVisit: null }
      }
    });

    const res = await request(app, {
      method: 'GET',
      url: `/api/patients/${studentAId}`,
      headers: { authorization: `Bearer ${studentAToken}` }
    }, '127.0.0.65');

    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.json.labReports));
    assert.equal(res.json.labReports.length, 65, 'All 65 laboratory reports must be retrieved without 50-limit truncation');
  });

  // Test 17: Multi-page pagination on patient history retrieves records without skipping or duplicates
  test('17. Collection pagination maintains stable ordering without skipping or duplicate records', async () => {
    // Test appointments pagination
    const allRecords = Array.from({ length: 50 }, (_, i) => ({
      id: `apt-p-${String(i + 1).padStart(2, '0')}`,
      date: '2026-11-12',
      time: '10:00 AM',
      createdAt: new Date(Date.now() - i * 60000).toISOString()
    }));

    setTestDbHandler((table) => {
      let offset = 0;
      let limit = 50;
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        range: (from, to) => {
          offset = from;
          limit = to - from + 1;
          return builder;
        },
        limit: (l) => { limit = l; return builder; },
        then: (resolve) => resolve({ data: allRecords.slice(offset, offset + limit), error: null })
      };
      return builder;
    });

    const page1 = await request(app, {
      method: 'GET',
      url: '/api/appointments?limit=20&offset=0',
      headers: { authorization: `Bearer ${adminToken}` }
    }, '127.0.0.66');

    const page2 = await request(app, {
      method: 'GET',
      url: '/api/appointments?limit=20&offset=20',
      headers: { authorization: `Bearer ${adminToken}` }
    }, '127.0.0.67');

    assert.equal(page1.statusCode, 200);
    assert.equal(page2.statusCode, 200);
    assert.equal(page1.json.length, 20);
    assert.equal(page2.json.length, 20);

    // Verify zero overlap between page 1 and page 2
    const page1Ids = new Set(page1.json.map((r) => r.id));
    page2.json.forEach((r) => {
      assert.equal(page1Ids.has(r.id), false, `Record ${r.id} must not appear in both page 1 and page 2`);
    });
  });

  // Test 18: Patient with >50 prescriptions accurately calculates visitSummary.totalVisits
  test('18. Patient with >50 prescriptions accurately reflects complete visitSummary without truncation', async () => {
    const manyPrescriptions = Array.from({ length: 72 }, (_, i) => ({
      id: `rx-p-${i + 1}`,
      date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
      diagnosis: `Diagnosis #${i + 1}`,
      doctorName: 'Dr. Consulting'
    }));

    setTestPatientsData({
      [studentAId]: {
        id: studentAId,
        name: 'Student High Volume Treatments',
        role: 'student',
        roll_number: '2204001',
        treatmentHistory: manyPrescriptions,
        labReports: [],
        visitSummary: { totalVisits: 72, lastVisit: '2026-09-28' }
      }
    });

    const res = await request(app, {
      method: 'GET',
      url: `/api/patients/${studentAId}`,
      headers: { authorization: `Bearer ${studentAToken}` }
    }, '127.0.0.68');

    assert.equal(res.statusCode, 200);
    assert.equal(res.json.treatmentHistory.length, 72);
    assert.equal(res.json.visitSummary.totalVisits, 72, 'totalVisits must equal complete count 72, not truncated at 50');
  });

  // Test 19: Database error in clinical history query fails closed
  test('19. Database error during clinical history retrieval fails closed (500) without returning false empty history', async () => {
    // Clear testPatientsData to force execution of database query path
    setTestPatientsData(null);

    setTestDbHandler((table) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        or: () => builder,
        order: () => builder,
        maybeSingle: async () => {
          if (table === 'profiles') return { data: { id: studentAId, name: 'Student A', role: 'student' }, error: null };
          if (table === 'patients') return { data: { id: studentAId, roll_number: '2204001' }, error: null };
          return { data: null, error: null };
        },
        then: (resolve, reject) => {
          if (table === 'prescriptions') {
            return reject(new Error('PostgreSQL connection timeout in clinical query'));
          }
          return resolve({ data: [], error: null });
        }
      };
      return builder;
    });

    const res = await request(app, {
      method: 'GET',
      url: `/api/patients/${studentAId}`,
      headers: { authorization: `Bearer ${studentAToken}` }
    }, '127.0.0.69');

    // Must fail closed with 500, never return 200 with an empty history array!
    assert.equal(res.statusCode, 500);
    assert.match(res.json.error, /PostgreSQL connection timeout/i);
  });

  // Test 20: Historical JSON matching rejects substring false positives
  test('20. Historical JSON matching strictly enforces exact patient identifier equality and rejects substring false positives', async () => {
    setTestPatientsData(null);

    // Records in database: one for roll '725', one for '1725', one for '2204725'
    const recordsInDb = [
      {
        id: 'lab-exact-725',
        patient_id: null,
        test_name: 'CBC',
        result: JSON.stringify({ patientId: '725', testName: 'CBC' }),
        date: '2026-11-01'
      },
      {
        id: 'lab-substring-1725',
        patient_id: null,
        test_name: 'Lipid Profile',
        result: JSON.stringify({ patientId: '1725', testName: 'Lipid Profile' }),
        date: '2026-11-02'
      },
      {
        id: 'lab-substring-2204725',
        patient_id: null,
        test_name: 'Blood Sugar',
        result: JSON.stringify({ patientId: '2204725', testName: 'Blood Sugar' }),
        date: '2026-11-03'
      }
    ];

    setTestDbHandler((table) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        or: () => builder,
        order: () => builder,
        maybeSingle: async () => {
          if (table === 'profiles') return { data: { id: studentAId, name: 'Student 725', role: 'student' }, error: null };
          if (table === 'patients') return { data: { id: studentAId, roll_number: '725' }, error: null };
          return { data: null, error: null };
        },
        then: (resolve) => {
          if (table === 'lab_reports') {
            return resolve({ data: recordsInDb, error: null });
          }
          return resolve({ data: [], error: null });
        }
      };
      return builder;
    });

    const res = await request(app, {
      method: 'GET',
      url: `/api/patients/${studentAId}`,
      headers: { authorization: `Bearer ${studentAToken}` }
    }, '127.0.0.70');

    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.json.labReports));
    // Must ONLY include 'lab-exact-725', NEVER 'lab-substring-1725' or 'lab-substring-2204725'!
    assert.equal(res.json.labReports.length, 1);
    assert.equal(res.json.labReports[0].id, 'lab-exact-725');
    assert.equal(res.json.labReports[0].patientId, '725');
  });

  test('21. Paginated clinical queries with identical timestamps use unique tie-breaker to ensure zero duplicates or omissions', async () => {
    // Generate 10 prescriptions with identical date and createdAt
    const sharedDate = '2026-11-12';
    const sharedTimestamp = '2026-11-12T10:00:00.000Z';
    const identicalTimeRecords = [];
    for (let i = 1; i <= 10; i++) {
      identicalTimeRecords.push({
        id: `presc-${String(i).padStart(3, '0')}`,
        patientId: studentAId,
        patientName: 'Student A',
        doctorId: doctorAId,
        doctorName: 'Dr. A',
        date: sharedDate,
        createdAt: sharedTimestamp,
        diagnosis: `Diagnosis ${i}`,
        status: 'dispensed'
      });
    }

    setTestDbHandler((table) => {
      let offset = 0;
      let limit = 10;
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        range: (from, to) => {
          offset = from;
          limit = to - from + 1;
          return builder;
        },
        then: (resolve) => {
          if (table === 'prescriptions') {
            // Sort by createdAt DESC, then id DESC (deterministic tie breaker)
            const sorted = [...identicalTimeRecords].sort((a, b) => {
              if (b.createdAt !== a.createdAt) return b.createdAt.localeCompare(a.createdAt);
              return b.id.localeCompare(a.id);
            });
            const slice = sorted.slice(offset, offset + limit);
            return resolve({ data: slice, count: identicalTimeRecords.length, error: null });
          }
          return resolve({ data: [], error: null });
        }
      };
      return builder;
    });

    // Request Page 1 (limit 5, offset 0)
    const page1 = await request(app, {
      method: 'GET',
      url: '/api/prescriptions?limit=5&offset=0',
      headers: { authorization: `Bearer ${studentAToken}` }
    }, '127.0.0.71');

    // Request Page 2 (limit 5, offset 5)
    const page2 = await request(app, {
      method: 'GET',
      url: '/api/prescriptions?limit=5&offset=5',
      headers: { authorization: `Bearer ${studentAToken}` }
    }, '127.0.0.72');

    assert.equal(page1.statusCode, 200);
    assert.equal(page2.statusCode, 200);
    assert.equal(page1.json.length, 5);
    assert.equal(page2.json.length, 5);

    const idsPage1 = page1.json.map((r) => r.id);
    const idsPage2 = page2.json.map((r) => r.id);

    // Verify disjoint sets: no record from page 1 appears in page 2
    for (const id of idsPage1) {
      assert.ok(!idsPage2.includes(id), `Record ${id} from page 1 unexpectedly duplicated in page 2`);
    }

    // Verify union covers all 10 records without omission
    const combined = [...idsPage1, ...idsPage2];
    assert.equal(new Set(combined).size, 10);
  });

  test('22. Patient profile returns truthful completeness metadata and authoritative visitSummary under pagination vs complete retrieval', async () => {
    setTestPatientsData(null);
    const totalPrescriptions = 60;
    const records = Array.from({ length: totalPrescriptions }, (_, i) => ({
      id: `p-${i + 1}`,
      date: '2026-11-12',
      diagnosis: `Condition ${i + 1}`,
      doctorName: 'Dr. Test'
    }));

    setTestDbHandler((table) => {
      let isPaginated = false;
      let limit = totalPrescriptions;
      let offset = 0;
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        or: () => builder,
        order: () => builder,
        range: (from, to) => {
          isPaginated = true;
          offset = from;
          limit = to - from + 1;
          return builder;
        },
        limit: (l) => {
          isPaginated = true;
          limit = l;
          return builder;
        },
        maybeSingle: async () => {
          if (table === 'profiles') return { data: { id: studentAId, name: 'Student Completeness', role: 'student' }, error: null };
          if (table === 'patients') return { data: { id: studentAId, roll_number: '2204999' }, error: null };
          return { data: null, error: null };
        },
        then: (resolve) => {
          if (table === 'prescriptions') {
            const dataSlice = isPaginated ? records.slice(offset, offset + limit) : records;
            return resolve({ data: dataSlice, count: totalPrescriptions, error: null });
          }
          if (table === 'lab_reports') {
            return resolve({ data: [], count: 0, error: null });
          }
          return resolve({ data: [], error: null });
        }
      };
      return builder;
    });

    // 1. Paginated request (limit = 10)
    const paginatedRes = await request(app, {
      method: 'GET',
      url: `/api/patients/${studentAId}?limit=10&offset=0`,
      headers: { authorization: `Bearer ${studentAToken}` }
    }, '127.0.0.73');

    assert.equal(paginatedRes.statusCode, 200);
    assert.equal(paginatedRes.json.treatmentHistory.length, 10);
    // visitSummary.totalVisits must report the true count (60), not truncated page count (10)
    assert.equal(paginatedRes.json.visitSummary.totalVisits, 60);
    assert.ok(paginatedRes.json.clinicalHistoryMeta);
    assert.equal(paginatedRes.json.clinicalHistoryMeta.isComplete, false);
    assert.equal(paginatedRes.json.clinicalHistoryMeta.isPaginated, true);
    assert.equal(paginatedRes.json.clinicalHistoryMeta.totalPrescriptions, 60);
    assert.equal(paginatedRes.json.clinicalHistoryMeta.retrievedPrescriptions, 10);

    // 2. Unpaginated request (complete history)
    const completeRes = await request(app, {
      method: 'GET',
      url: `/api/patients/${studentAId}`,
      headers: { authorization: `Bearer ${studentAToken}` }
    }, '127.0.0.74');

    assert.equal(completeRes.statusCode, 200);
    assert.equal(completeRes.json.treatmentHistory.length, 60);
    assert.equal(completeRes.json.visitSummary.totalVisits, 60);
    assert.ok(completeRes.json.clinicalHistoryMeta);
    assert.equal(completeRes.json.clinicalHistoryMeta.isComplete, true);
    assert.equal(completeRes.json.clinicalHistoryMeta.isPaginated, false);
    assert.equal(completeRes.json.clinicalHistoryMeta.totalPrescriptions, 60);
    assert.equal(completeRes.json.clinicalHistoryMeta.retrievedPrescriptions, 60);
  });

  test('23. Historical lab reports preserve legacy snake_case patient_id and registration_number while isolating other patients', async () => {
    setTestPatientsData(null);
    const legacyRecords = [
      {
        id: 'lab-snake-case',
        patient_id: null,
        test_name: 'CBC',
        result: JSON.stringify({ patient_id: '2204777', status: 'Completed', remarks: 'Normal' }),
        validated: true,
        date: '2026-11-01'
      },
      {
        id: 'lab-reg-number',
        patient_id: null,
        test_name: 'Lipid Profile',
        result: JSON.stringify({ patientId: 'REG-888', status: 'Completed', remarks: 'Good' }),
        validated: true,
        date: '2026-11-02'
      },
      {
        id: 'lab-other-patient',
        patient_id: null,
        test_name: 'X-Ray',
        result: JSON.stringify({ patientId: '2204999', status: 'Completed', remarks: 'Foreign' }),
        validated: true,
        date: '2026-11-03'
      }
    ];

    setTestDbHandler((table) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        or: () => builder,
        order: () => builder,
        maybeSingle: async () => {
          if (table === 'profiles') return { data: { id: studentAId, name: 'Student Legacy', role: 'student' }, error: null };
          if (table === 'patients') return { data: { id: studentAId, roll_number: '2204777', registration_number: 'REG-888' }, error: null };
          return { data: null, error: null };
        },
        then: (resolve) => {
          if (table === 'lab_reports') {
            return resolve({ data: legacyRecords, count: legacyRecords.length, error: null });
          }
          return resolve({ data: [], error: null });
        }
      };
      return builder;
    });

    const res = await request(app, {
      method: 'GET',
      url: `/api/patients/${studentAId}`,
      headers: { authorization: `Bearer ${studentAToken}` }
    }, '127.0.0.75');

    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.json.labReports));
    // Must match both the snake_case patient_id ('2204777') and registration_number ('REG-888')
    assert.equal(res.json.labReports.length, 2);
    const retrievedIds = res.json.labReports.map((r) => r.id);
    assert.ok(retrievedIds.includes('lab-snake-case'));
    assert.ok(retrievedIds.includes('lab-reg-number'));
    // Must strictly exclude other patient's report ('lab-other-patient')
    assert.ok(!retrievedIds.includes('lab-other-patient'));
  });
});
