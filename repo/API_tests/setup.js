// API test helpers — uses Node's built-in http module for maximum compatibility
const http = require('http');
const https = require('https');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const BASE_URL = process.env.API_BASE_URL || 'https://localhost:3443';

function apiRequest(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const payload = body && method !== 'GET' ? JSON.stringify(body) : null;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    const opts = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers,
      rejectUnauthorized: false
    };

    const req = transport.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json;
        try { json = JSON.parse(data); } catch { json = { raw: data }; }
        resolve({ status: res.statusCode, data: json, ok: res.statusCode >= 200 && res.statusCode < 300 });
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function apiGet(path, token) { return apiRequest('GET', path, null, token); }
function apiPost(path, body, token) { return apiRequest('POST', path, body, token); }
function apiPatch(path, body, token) { return apiRequest('PATCH', path, body, token); }
function apiPut(path, body, token) { return apiRequest('PUT', path, body, token); }
function apiDelete(path, token) { return apiRequest('DELETE', path, null, token); }

async function login(username, password) {
  // Use BOOTSTRAP_INITIAL_DEVICE for admin (seeded trusted device), or TEST_DEVICE for others
  const fp = username === 'admin' ? 'BOOTSTRAP_INITIAL_DEVICE' : 'TEST_DEVICE_' + username;
  const res = await apiPost('/api/auth/login', {
    username,
    password,
    deviceFingerprint: fp
  });
  if (res.ok && res.data?.data?.token) return res.data.data.token;
  if (res.ok && res.data?.token) return res.data.token;
  return null;
}

// Cache tokens to avoid session limit issues across test suites
const tokenCache = {};
async function loginCached(username, password) {
  if (tokenCache[username]) {
    // Verify the cached token is still valid
    const check = await apiGet('/api/auth/me', tokenCache[username]);
    if (check.status === 200) return tokenCache[username];
    // Token expired/evicted — clear and re-login
    delete tokenCache[username];
  }
  const token = await login(username, password);
  if (token) tokenCache[username] = token;
  return token;
}

function clearTokenCache(username) {
  if (username) delete tokenCache[username];
  else Object.keys(tokenCache).forEach(k => delete tokenCache[k]);
}

module.exports = { apiGet, apiPost, apiPatch, apiPut, apiDelete, login, loginCached, clearTokenCache, BASE_URL };
