const BASE_URL = '/api';

async function request(method, path, body = null) {
  const headers = { 'Content-Type': 'application/json' };

  const opts = {
    method,
    headers,
    credentials: 'include' // Send HttpOnly session cookie with every request
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${path}`, opts);
  const json = await res.json().catch(() => ({ success: false, error: { code: res.status, message: res.statusText } }));

  if (!res.ok) {
    const err = new Error(json.error?.message || `Request failed: ${res.status}`);
    err.status = res.status;
    err.data = json;
    throw err;
  }
  return json;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  delete: (path) => request('DELETE', path)
};
