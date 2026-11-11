import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import app from '../src/app.js';

// In-memory HTTP dispatcher for Express (runs isolated, fast, without opening TCP sockets)
function request(app, options = {}) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    Object.defineProperty(socket, 'remoteAddress', { value: '127.0.0.1' });
    
    const req = new http.IncomingMessage(socket);
    req.method = options.method || 'GET';
    req.url = options.url || '/';
    req.headers = Object.assign({ host: 'localhost' }, options.headers || {});
    
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
      } catch (e) {
        // Not JSON body
      }

      resolve({
        statusCode: res.statusCode,
        headers: res.getHeaders(),
        body,
        json
      });
    };

    app.handle(req, res);
  });
}

describe('RUET MediSys - Step 1: Health & Cold Start Optimization Tests', () => {

  test('1. GET /health returns HTTP 200', async () => {
    const res = await request(app, { url: '/health' });
    assert.equal(res.statusCode, 200, 'Expected status code 200');
  });

  test('2. GET /health response JSON contains expected fields', async () => {
    const res = await request(app, { url: '/health' });
    assert.deepEqual(res.json, {
      status: 'ok',
      service: 'ruet-medical-backend'
    });
  });

  test('3. GET /health works without a JWT (no Authorization header)', async () => {
    const res = await request(app, {
      url: '/health',
      headers: {} // No authorization header
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json.status, 'ok');
  });

  test('4. GET /health sets Cache-Control to prevent response caching', async () => {
    const res = await request(app, { url: '/health' });
    const cacheControl = res.headers['cache-control'] || '';
    assert.ok(cacheControl.includes('no-cache'), 'Cache-Control must contain no-cache');
    assert.ok(cacheControl.includes('no-store'), 'Cache-Control must contain no-store');
  });

  test('5. GET /api/health also responds with HTTP 200 and expected payload', async () => {
    const res = await request(app, { url: '/api/health' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json, {
      status: 'ok',
      service: 'ruet-medical-backend'
    });
  });

  test('6. Existing Root route GET / continues working', async () => {
    const res = await request(app, { url: '/' });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /RUET Medical Backend is running securely/i);
  });

  test('7. Existing security middleware (Helmet) remains operational', async () => {
    const res = await request(app, { url: '/health' });
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  });

  test('8. Existing security middleware (requireAuth) protects /api/patients', async () => {
    const res = await request(app, { url: '/api/patients' });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json?.error, 'Unauthorized: No token provided');
  });

  test('9. Existing security middleware (requireAuth) protects /api/appointments', async () => {
    const res = await request(app, { url: '/api/appointments' });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json?.error, 'Unauthorized: No token provided');
  });

  test('10. Security: No environment variables or credentials are leaked in /health', async () => {
    const res = await request(app, { url: '/health' });
    const bodyStr = JSON.stringify(res.json);
    assert.equal(bodyStr.includes(process.env.SUPABASE_URL || 'supabase'), false);
    assert.equal(bodyStr.includes(process.env.SUPABASE_SECRET_KEY || 'secret'), false);
    assert.deepEqual(Object.keys(res.json).sort(), ['service', 'status']);
  });
});
