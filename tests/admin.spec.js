const { test, expect } = require('@playwright/test');

async function setupAdminMocks(page) {
  // Mock login token request for admin
  await page.route('**/auth/v1/token?grant_type=password', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'mock-admin-token',
        token_type: 'bearer',
        expires_in: 3600,
        refresh_token: 'mock-admin-refresh-token',
        user: {
          id: 'admin-0000-0000-0000-000000000000',
          aud: 'authenticated',
          role: 'authenticated',
          email: 'admin@gmail.com',
          email_confirmed_at: '2026-06-13T20:00:00Z',
          user_metadata: {
            first_name: 'Admin',
            last_name: 'User',
            role: 'admin'
          }
        }
      })
    });
  });

  // Mock GET users using a unified route handler to avoid query-string glob mismatch issues
  await page.route(/\/rest\/v1\/users/, async (route) => {
    const url = route.request().url();
    
    if (url.includes('id=eq.admin') || url.includes('admin%40gmail.com')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          id: 'admin-0000-0000-0000-000000000000',
          role: 'admin',
          first_name: 'Admin',
          last_name: 'User',
          email: 'admin@gmail.com',
          created_at: '2026-06-13T20:00:00Z',
          is_active: true
        }])
      });
    } else if (url.includes('role=eq.parent')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'parent-1111-1111-1111-111111111111',
            role: 'parent',
            first_name: 'Jennifer',
            last_name: 'Chen',
            email: 'jennifer@example.com',
            created_at: '2026-06-13T20:00:00Z',
            is_active: true
          }
        ])
      });
    } else if (url.includes('role=eq.practitioner')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'ot-2222-2222-2222-222222222222',
            role: 'practitioner',
            first_name: 'Sarah',
            last_name: 'Williams',
            specialty: 'Occupational Therapist',
            location: 'London, UK',
            avatar_url: null,
            bio: 'Specializing in motor skills integration.',
            is_featured: true,
            connection_code: 'OT-SARAH',
            email: 'sarah@example.com',
            is_active: true
          },
          {
            id: 'ot-3333-3333-3333-333333333333',
            role: 'practitioner',
            first_name: 'John',
            last_name: 'Doe',
            specialty: 'Sensory Specialist',
            location: 'Paris, FR',
            avatar_url: null,
            bio: 'Specializing in sensory processing development.',
            is_featured: false,
            connection_code: 'OT-JOHN',
            email: 'john@example.com',
            is_active: false
          }
        ])
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]'
      });
    }
  });

  // Mock GET admin audit logs
  await page.route('**/rest/v1/admin_audit_logs*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'log-1',
          created_at: '2026-06-21T18:00:00Z',
          action: 'edit',
          target_user_id: 'ot-2222-2222-2222-222222222222',
          details: 'Edited specialist details',
          admin: { first_name: 'Admin', last_name: 'User' }
        }
      ])
    });
  });

  // Mock PUT specialist update
  await page.route('**/rest/v1/users?id=eq.ot-2222-2222-2222-222222222222', async (route) => {
    const reqBody = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...reqBody, id: 'ot-2222-2222-2222-222222222222' })
    });
  });

  // Mock POST audit logs insert
  await page.route('**/rest/v1/admin_audit_logs', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'new-log' })
    });
  });

  // Mock password reset email endpoint
  await page.route('**/auth/v1/recover*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}'
    });
  });

  // Fallback mocks
  const emptyEndpoints = [
    '**/rest/v1/children*',
    '**/rest/v1/sessions*',
    '**/rest/v1/practitioner_children*',
    '**/rest/v1/learn_content*'
  ];

  for (const endpoint of emptyEndpoints) {
    await page.route(endpoint, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]'
      });
    });
  }
}

test.describe('Admin Dashboard Specialist & Impersonation Management Spec', () => {

  test.beforeEach(async ({ page }) => {
    await setupAdminMocks(page);
  });

  test('Admin logs in and views specialists, details, and search/filter', async ({ page }) => {
    // 1. Sign in as Admin
    await page.goto('/admin');
    await page.locator('input[placeholder="admin@gmail.com"]').fill('admin@gmail.com');
    await page.locator('input[placeholder="••••••••"]').fill('admin123');
    await page.click('button[type="submit"]');

    // Should see the main admin header and navigate to Specialists
    await expect(page.locator('h1:has-text("Export Sessions CSV")')).toBeVisible();
    await page.click('button:has-text("Specialists")');
    await expect(page.locator('h1:has-text("Manage Specialists")')).toBeVisible();

    // 2. Search & Filter specialists
    // Default lists both specialists (Sarah Williams and John Doe)
    await expect(page.locator('text=Sarah Williams')).toBeVisible();
    await expect(page.locator('text=John Doe')).toBeVisible();

    // Search by name
    await page.locator('input[placeholder="Search by name, specialty, location, email..."]').fill('Sarah');
    await expect(page.locator('text=John Doe')).toBeHidden();
    await expect(page.locator('text=Sarah Williams')).toBeVisible();

    // Reset search, filter by Deactivated status
    await page.locator('input[placeholder="Search by name, specialty, location, email..."]').fill('');
    const statusSelect = page.locator('select').first();
    await statusSelect.selectOption('deactivated');
    await expect(page.locator('text=Sarah Williams')).toBeHidden();
    await expect(page.locator('text=John Doe')).toBeVisible();

    // Reset status filter
    await statusSelect.selectOption('all');
    await expect(page.locator('text=Sarah Williams')).toBeVisible();

    // 3. View details modal
    await page.locator('.admin-spec-card', { hasText: 'Sarah Williams' }).locator('button:has-text("Details")').click();
    await expect(page.locator('text=Practitioner Details')).toBeVisible();
    await expect(page.locator('.admin-confirm-box').locator('text=OT-SARAH')).toBeVisible();
    await expect(page.locator('.admin-confirm-box').locator('text=Specializing in motor skills integration.')).toBeVisible();
    await page.click('button:has-text("Close")');
    await expect(page.locator('text=Practitioner Details')).toBeHidden();
  });

  test('Admin resets password, edits specialist, and views audit logs', async ({ page }) => {
    // Sign in and go to Specialists
    await page.goto('/admin');
    await page.locator('input[placeholder="admin@gmail.com"]').fill('admin@gmail.com');
    await page.locator('input[placeholder="••••••••"]').fill('admin123');
    await page.click('button[type="submit"]');
    
    // Wait for dashboard to load
    await expect(page.locator('h1:has-text("Export Sessions CSV")')).toBeVisible();

    await page.click('button:has-text("Specialists")');
    await expect(page.locator('h1:has-text("Manage Specialists")')).toBeVisible();

    // 1. Password reset flow
    await page.locator('.admin-spec-card', { hasText: 'Sarah Williams' }).locator('button:has-text("Reset")').click();
    await expect(page.locator('text=Reset Password')).toBeVisible();
    await page.click('button:has-text("Confirm")');
    // Confirm dialog is closed

    // 2. Edit specialist flow
    await page.locator('.admin-spec-card', { hasText: 'Sarah Williams' }).locator('button:has-text("Edit")').click();
    await expect(page.locator('text=Edit Practitioner Profile')).toBeVisible();
    await page.locator('input[value="Sarah"]').fill('Sarah Modified');
    await page.locator('input[value="London, UK"]').fill('London, UK Modified');
    await page.click('button:has-text("Save Changes")');
    // Modal should close

    // 3. View Audit Logs flow
    await page.click('button:has-text("View Audit Logs")');
    await expect(page.locator('text=Administrative Audit Logs')).toBeVisible();
    await expect(page.locator('text=Edited specialist details')).toBeVisible();
  });

  test('Admin impersonates parent and specialist dashboards with exit banner flow', async ({ page }) => {
    // Sign in
    await page.goto('/admin');
    await page.locator('input[placeholder="admin@gmail.com"]').fill('admin@gmail.com');
    await page.locator('input[placeholder="••••••••"]').fill('admin123');
    await page.click('button[type="submit"]');

    // Wait for dashboard to load
    await expect(page.locator('h1:has-text("Export Sessions CSV")')).toBeVisible();

    // 1. Impersonate Parent from Sessions tab
    await page.locator('tr', { hasText: 'Jennifer Chen' }).locator('button:has-text("Impersonate")').click();
    
    // Redirects to parent dashboard, and exit banner is visible at top
    await expect(page.locator('text=Impersonation Mode: You are viewing the dashboard of Jennifer Chen')).toBeVisible();
    await expect(page.locator('text=Original Admin: admin@gmail.com')).toBeVisible();

    // Exit impersonation
    await page.click('button:has-text("Exit Impersonation")');
    await expect(page.locator('h1:has-text("Export Sessions CSV")')).toBeVisible(); // Back to admin dashboard

    // 2. Impersonate Specialist from Specialists tab
    await page.click('button:has-text("Specialists")');
    await expect(page.locator('h1:has-text("Manage Specialists")')).toBeVisible();
    await page.locator('.admin-spec-card', { hasText: 'Sarah Williams' }).locator('button:has-text("Impersonate")').click();

    // Redirects to specialist dashboard, exit banner is visible
    await expect(page.locator('text=Impersonation Mode: You are viewing the dashboard of Sarah Williams')).toBeVisible();

    // Exit impersonation
    await page.click('button:has-text("Exit Impersonation")');
    await expect(page.locator('h1:has-text("Export Sessions CSV")')).toBeVisible(); // Back to admin dashboard
  });

  test('Admin cannot impersonate a deactivated specialist', async ({ page }) => {
    // Sign in
    await page.goto('/admin');
    await page.locator('input[placeholder="admin@gmail.com"]').fill('admin@gmail.com');
    await page.locator('input[placeholder="••••••••"]').fill('admin123');
    await page.click('button[type="submit"]');
    
    // Wait for dashboard to load
    await expect(page.locator('h1:has-text("Export Sessions CSV")')).toBeVisible();

    await page.click('button:has-text("Specialists")');
    await expect(page.locator('h1:has-text("Manage Specialists")')).toBeVisible();

    // John Doe is deactivated in mock data. Let's verify the Impersonate button is disabled
    const johnImpersonateBtn = page.locator('.admin-spec-card', { hasText: 'John Doe' }).locator('button:has-text("Impersonate")');
    await expect(johnImpersonateBtn).toBeDisabled();
  });
});
