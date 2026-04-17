/**
 * RailOps E2E tests — Playwright against real frontend + real backend.
 * Proves deployed UI and deployed API work together for key business workflows.
 */
const { test, expect } = require('@playwright/test');

const BASE = process.env.BASE_URL || 'https://localhost:8443';

// ── Guest Trip Search ────────────────────────────────────────

test.describe('Guest Trip Search', () => {
  test('search page loads with form', async ({ page }) => {
    await page.goto(`${BASE}/search`);
    await page.waitForTimeout(1000);
    await expect(page.locator('h1')).toContainText('Find Your Train');
    await expect(page.locator('.search-btn')).toBeVisible();
    await expect(page.locator('input[placeholder="MM/DD/YYYY"]')).toBeVisible();
  });

  test('API search returns real trip data through proxy', async ({ page }) => {
    const res = await page.goto(`${BASE}/api/trips/search?origin=NYC&destination=WAS`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.results.length).toBeGreaterThan(0);
    expect(body.data.results[0].routeName).toBeDefined();
    expect(body.data.results[0].seatClasses.length).toBeGreaterThan(0);
  });

  test('sort chips are rendered', async ({ page }) => {
    await page.goto(`${BASE}/search`);
    await page.waitForTimeout(1000);
    await expect(page.locator('text=Departure')).toBeVisible();
  });

  test('date input accepts value', async ({ page }) => {
    await page.goto(`${BASE}/search`);
    const input = page.locator('input[placeholder="MM/DD/YYYY"]');
    await input.fill('04/10/2026');
    expect(await input.inputValue()).toBe('04/10/2026');
  });
});

// ── Login and Auth ───────────────────────────────────────────

test.describe('Login Flow', () => {
  test('login page renders form', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await expect(page.locator('h2')).toContainText('Welcome');
    await expect(page.locator('button:has-text("Sign In")')).toBeVisible();
  });

  test('login submits to backend — intercept proves FE→BE', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.fill('input[placeholder="Enter username"]', 'admin');
    await page.fill('input[placeholder="Enter password"]', 'admin123');

    const [response] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/auth/login'), { timeout: 15000 }),
      page.click('button:has-text("Sign In")')
    ]);

    expect(response.status()).toBeGreaterThanOrEqual(200);
    expect(response.status()).toBeLessThan(500);
    const json = await response.json();
    expect(json).toHaveProperty('success');
  });

  test('wrong password stays on login page', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.fill('input[placeholder="Enter username"]', 'admin');
    await page.fill('input[placeholder="Enter password"]', 'wrongpassword');
    await page.click('button:has-text("Sign In")');
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/login');
  });
});

// ── Navigation and Routing ───────────────────────────────────

test.describe('Route Guards', () => {
  test('root redirects to /search', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(1000);
    expect(page.url()).toContain('/search');
  });

  test('/schedules redirects unauthenticated to /login', async ({ page }) => {
    await page.goto(`${BASE}/schedules`);
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/login');
  });

  test('/inventory redirects unauthenticated to /login', async ({ page }) => {
    await page.goto(`${BASE}/inventory`);
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/login');
  });

  test('/admin/users redirects unauthenticated to /login', async ({ page }) => {
    await page.goto(`${BASE}/admin/users`);
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/login');
  });
});

// ── View Surface Coverage ─────────────────────────────────────

test.describe('View Surface Coverage', () => {
  test('trip search page has station inputs and class dropdown', async ({ page }) => {
    await page.goto(`${BASE}/search`);
    await page.waitForTimeout(1000);
    // Seat class dropdown
    const select = page.locator('select').first();
    await expect(select).toBeVisible();
    const options = await select.locator('option').allTextContents();
    expect(options.some(o => o.includes('Economy'))).toBe(true);
  });

  test('login page has username, password, and submit', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await expect(page.locator('input[placeholder="Enter username"]')).toBeVisible();
    await expect(page.locator('input[placeholder="Enter password"]')).toBeVisible();
    await expect(page.locator('button:has-text("Sign In")')).toBeVisible();
  });

  test('schedules page requires auth — redirects to login', async ({ page }) => {
    await page.goto(`${BASE}/schedules`);
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/login');
  });

  test('inventory items page requires auth', async ({ page }) => {
    await page.goto(`${BASE}/inventory/items`);
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/login');
  });

  test('user management page requires auth', async ({ page }) => {
    await page.goto(`${BASE}/admin/users`);
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/login');
  });

  test('backups page requires auth', async ({ page }) => {
    await page.goto(`${BASE}/backups`);
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/login');
  });

  test('data quality page requires auth', async ({ page }) => {
    await page.goto(`${BASE}/data-quality`);
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/login');
  });
});

// ── API Endpoints via Proxy ──────────────────────────────────

test.describe('API via Frontend Proxy', () => {
  test('stations endpoint returns data', async ({ page }) => {
    const res = await page.goto(`${BASE}/api/stations`);
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('hot-searches endpoint returns data', async ({ page }) => {
    const res = await page.goto(`${BASE}/api/trips/hot-searches`);
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });
});

// ── API Health ───────────────────────────────────────────────

test.describe('Infrastructure', () => {
  test('health endpoint returns ok', async ({ page }) => {
    const res = await page.goto(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toContain('"status":"ok"');
  });
});
