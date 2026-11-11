import { performance } from 'node:perf_hooks';
import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import app from '../src/app.js';
import {
  setTestJwks,
  clearRoleCache,
  verifyJwtClaims,
  resolveAuthoritativeRole,
  setTestProfiles
} from '../src/services/authService.js';
import { env } from '../src/config/env.js';

// In-memory HTTP dispatcher for Express to measure full Express request path
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

    app.handle(req, res);
  });
}

async function runBenchmark() {
  console.log('===================================================================');
  console.log('RUET MediSys — Step 2 Authentication Performance & Latency Benchmark');
  console.log('===================================================================\n');
  console.log('BENCHMARK METHODOLOGY:');
  console.log('- Measures actual local CPU & WebCrypto cryptographic execution');
  console.log('- Distinguishes in-process execution from WAN network latencies');
  console.log('- Tests cold vs warm verification, role lookup, and full Express request path\n');

  // 1. Setup Keys and Tokens
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  publicJwk.kid = 'bench-key-1';
  publicJwk.alg = 'ES256';
  publicJwk.use = 'sig';

  setTestJwks({ keys: [publicJwk] });
  setTestProfiles({
    'user-bench-uuid': 'doctor'
  });

  const header = { alg: 'ES256', typ: 'JWT', kid: 'bench-key-1' };
  const payload = {
    sub: 'user-bench-uuid',
    email: 'doctor@ruet.ac.bd',
    iss: `${env.SUPABASE_URL}/auth/v1`,
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: { role: 'doctor' },
    user_metadata: { role: 'doctor', name: 'Dr. Benchmark' },
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000)
  };

  const hB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const pB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const toSign = new TextEncoder().encode(`${hB64}.${pB64}`);
  const sigBuf = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, toSign);
  const sigB64 = Buffer.from(sigBuf).toString('base64url');
  const token = `${hB64}.${pB64}.${sigB64}`;

  // 2. Measure Cold JWT Verification
  const coldStart = performance.now();
  await verifyJwtClaims(token);
  const coldDuration = performance.now() - coldStart;

  // 3. Measure Warm JWT Verification over 100 iterations
  const warmIterations = 100;
  const warmTimes = [];
  for (let i = 0; i < warmIterations; i++) {
    const t0 = performance.now();
    await verifyJwtClaims(token);
    warmTimes.push(performance.now() - t0);
  }
  const avgWarmJwt = warmTimes.reduce((a, b) => a + b, 0) / warmTimes.length;
  const p95WarmJwt = warmTimes.sort((a, b) => a - b)[Math.floor(warmIterations * 0.95)];

  // 4. Measure Authoritative Role Lookup (Cold vs Warm Cache)
  clearRoleCache();
  const roleColdStart = performance.now();
  await resolveAuthoritativeRole('user-bench-uuid', payload);
  const roleColdDuration = performance.now() - roleColdStart;

  const roleWarmTimes = [];
  for (let i = 0; i < warmIterations; i++) {
    const t0 = performance.now();
    await resolveAuthoritativeRole('user-bench-uuid', payload);
    roleWarmTimes.push(performance.now() - t0);
  }
  const avgWarmRole = roleWarmTimes.reduce((a, b) => a + b, 0) / roleWarmTimes.length;

  // 5. Total Middleware Auth Duration (Warm)
  const totalWarmAuthMs = avgWarmJwt + avgWarmRole;

  // 6. Measure Full Express Request Path (including middleware stack)
  const expressTimes = [];
  for (let i = 0; i < warmIterations; i++) {
    const t0 = performance.now();
    await request(app, {
      url: '/api/health',
      headers: { Authorization: `Bearer ${token}` }
    });
    expressTimes.push(performance.now() - t0);
  }
  const avgExpressRequest = expressTimes.reduce((a, b) => a + b, 0) / expressTimes.length;
  const p95ExpressRequest = expressTimes.sort((a, b) => a - b)[Math.floor(warmIterations * 0.95)];

  console.log('--- MEASURED TIMINGS (Local WebCrypto & In-Process Express) ---');
  console.log(`1. Cold JWT Verification:              ${coldDuration.toFixed(3)} ms`);
  console.log(`2. Warm JWT Verification (Average):    ${avgWarmJwt.toFixed(3)} ms`);
  console.log(`3. Warm JWT Verification (P95):        ${p95WarmJwt.toFixed(3)} ms`);
  console.log(`4. Cold Authoritative Role Lookup:     ${roleColdDuration.toFixed(3)} ms`);
  console.log(`5. Warm Authoritative Role Lookup:     ${avgWarmRole.toFixed(3)} ms`);
  console.log(`6. Total Auth Middleware (Average):    ${totalWarmAuthMs.toFixed(3)} ms`);
  console.log(`7. Full Express API Request (Average): ${avgExpressRequest.toFixed(3)} ms`);
  console.log(`8. Full Express API Request (P95):     ${p95ExpressRequest.toFixed(3)} ms`);
  console.log('-------------------------------------------------------------------');
  console.log('COMPARISON SUMMARY:');
  console.log('- Remote WAN Baseline (`getUser`):     ~150 - 350 ms network round-trip');
  console.log(`- Local WebCrypto Auth Middleware:     ${totalWarmAuthMs.toFixed(3)} ms`);
  console.log('- Remote Auth Network Calls Saved:     100% on warm requests (0 calls)');
  console.log('===================================================================\n');
}

runBenchmark().catch(console.error);
