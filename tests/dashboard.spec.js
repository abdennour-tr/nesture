const { test, expect } = require('@playwright/test');

async function setupSupabaseMocks(page) {
  // Mock login token request
  await page.route('**/auth/v1/token?grant_type=password', async (route) => {
    const reqBody = JSON.parse(route.request().postData() || '{}');
    const role = reqBody.email?.includes('ot') ? 'practitioner' : 'parent';
    
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'mock-access-token',
        token_type: 'bearer',
        expires_in: 3600,
        refresh_token: 'mock-refresh-token',
        user: {
          id: role === 'parent' ? 'b0000000-0000-0000-0000-000000000001' : 'b0000000-0000-0000-0000-000000000002',
          aud: 'authenticated',
          role: 'authenticated',
          email: reqBody.email || 'jennifer@example.com',
          email_confirmed_at: '2026-06-13T20:00:00Z',
          user_metadata: {
            first_name: role === 'parent' ? 'Jennifer' : 'Alex',
            last_name: role === 'parent' ? 'Chen' : 'Practitioner',
            role: role
          }
        }
      })
    });
  });

  // Mock GET users
  await page.route('**/rest/v1/users**', async (route) => {
    const url = route.request().url();
    const isOT = url.includes('practitioner') || url.includes('ot') || url.includes('b0000000-0000-0000-0000-000000000002');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: isOT ? 'b0000000-0000-0000-0000-000000000002' : 'b0000000-0000-0000-0000-000000000001',
        role: isOT ? 'practitioner' : 'parent',
        first_name: isOT ? 'Alex' : 'Jennifer',
        last_name: isOT ? 'Practitioner' : 'Chen',
        created_at: '2026-06-13T20:00:00Z',
        beta_participant: true
      })
    });
  });

  // Mock GET children
  await page.route('**/rest/v1/children**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: '00000000-0000-0000-0000-000000000011',
          parent_id: 'b0000000-0000-0000-0000-000000000001',
          first_name: 'Lily',
          last_name: 'Chen',
          name: 'Lily Chen',
          age: 8,
          diagnosis: 'ASD',
          completeness_percentage: 28,
          avatar_color: '#F472B6'
        }
      ])
    });
  });

  // Mock GET atlas_profiles
  await page.route('**/rest/v1/atlas_profiles**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: '00000000-0000-0000-0000-000000000012',
        child_id: '00000000-0000-0000-0000-000000000011',
        completeness_percentage: 28,
        strengths: [{ value: 'Expressive language' }, { value: 'Visual memory' }],
        challenges: [],
        communication_profile: { verbal_skills: 'verbal' },
        sensory_profile: {},
        functional_wellness: [],
        motor_reflexes: []
      })
    });
  });

  // Mock GET connections/active
  await page.route('**/rest/v1/connections**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]'
    });
  });

  // Mock GET sessions
  await page.route('**/rest/v1/sessions**', async (route) => {
    const urlObj = new URL(route.request().url());
    const difficultyParam = urlObj.searchParams.get('difficulty');
    const isArchivedParam = urlObj.searchParams.get('is_archived');

    let sessions = [
      {
        id: 's1',
        child_id: '00000000-0000-0000-0000-000000000011',
        start_time: '2026-06-12T10:00:00Z',
        duration_seconds: 360,
        accuracy_score: 0.85,
        lpi_score: 72,
        difficulty: 'medium',
        perfect_grabs: 12,
        is_archived: false
      },
      {
        id: 's2',
        child_id: '00000000-0000-0000-0000-000000000011',
        start_time: '2026-06-10T14:30:00Z',
        duration_seconds: 420,
        accuracy_score: 0.95,
        lpi_score: 80,
        difficulty: 'hard',
        perfect_grabs: 18,
        is_archived: false
      },
      {
        id: 's3',
        child_id: '00000000-0000-0000-0000-000000000011',
        start_time: '2026-06-01T09:00:00Z',
        duration_seconds: 300,
        accuracy_score: 0.60,
        lpi_score: 55,
        difficulty: 'easy',
        perfect_grabs: 5,
        is_archived: false
      }
    ];

    if (difficultyParam) {
      const val = difficultyParam.replace('eq.', '');
      sessions = sessions.filter(s => s.difficulty === val);
    }
    if (isArchivedParam) {
      const val = isArchivedParam.replace('eq.', '') === 'true';
      sessions = sessions.filter(s => s.is_archived === val);
    }

    const totalCount = sessions.length;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'content-range': `0-${Math.max(0, totalCount - 1)}/${totalCount}`
      },
      body: JSON.stringify(sessions)
    });
  });

  // Mock fallback endpoints
  const emptyEndpoints = [
    '**/rest/v1/reflex_scores**',
    '**/rest/v1/exercises**',
    '**/rest/v1/prescriptions**',
    '**/rest/v1/practitioner_children**',
    '**/rest/v1/consent**',
    '**/rest/v1/learn_content**',
    '**/connections/active/**'
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

test.describe('Dashboards Premium UI Refactoring Spec', () => {

  test.beforeEach(async ({ page }) => {
    await setupSupabaseMocks(page);
  });

  test('Parent Dashboard Completeness & Quick Shortcuts Navigation', async ({ page }) => {
    // 1. Sign in as Parent
    await page.goto('/login');
    await page.locator('text=Authentification en cours').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
    await page.locator('input[type="email"]').focus();
    await page.locator('input[type="email"]').fill('jennifer@example.com');
    await page.locator('input[type="password"]').focus();
    await page.locator('input[type="password"]').fill('password123');
    await page.click('button[type="submit"]');
    await expect(page.locator('h1:has-text("Parent Dashboard")')).toBeVisible();

    // 2. Profile completeness display checks
    // Completeness calculations should show Profile Incomplete alert (e.g. "Profile Incomplete (...) missing")
    const completenessAlert = page.locator('text=Profile Incomplete');
    await expect(completenessAlert).toBeVisible();

    // 3. Direct cards widgets should be visible
    const cardConnect = page.locator('h4:has-text("NestureConnect")');
    const cardLearn = page.locator('h4:has-text("NestureLearn")');
    await expect(cardConnect).toBeVisible();
    await expect(cardLearn).toBeVisible();

    // 4. Click direct shortcut Connect
    await page.click('button:has-text("Find Specialists")');
    // Active tab switches to connect
    const activeSidebarConnectTab = page.locator('button.sidebar-nav-item.active:has-text("NestureConnect")');
    await expect(activeSidebarConnectTab).toBeVisible();

    // 5. Navigate back to Atlas
    await page.click('button.sidebar-nav-item:has-text("Atlas Profile")');
    
    // 6. Click direct shortcut Learn
    await page.click('button:has-text("Start Learning")');
    // Active tab switches to learn
    const activeSidebarLearnTab = page.locator('button.sidebar-nav-item.active:has-text("NestureLearn")');
    await expect(activeSidebarLearnTab).toBeVisible();
  });

  test('Parent Dashboard Smart Notifications Filters & Toggles', async ({ page }) => {
    // Sign in as Parent
    await page.goto('/login');
    await page.locator('text=Authentification en cours').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
    await page.locator('input[type="email"]').focus();
    await page.locator('input[type="email"]').fill('jennifer@example.com');
    await page.locator('input[type="password"]').focus();
    await page.locator('input[type="password"]').fill('password123');
    await page.click('button[type="submit"]');

    // Click notifications bell button
    const bellBtn = page.locator('button[aria-label="Toggle notifications menu"]');
    await expect(bellBtn).toBeVisible();
    await bellBtn.click();

    // Check dropdown menu is open and tabs are visible
    await expect(page.locator('h3:has-text("Smart Notifications")')).toBeVisible();
    const tabAll = page.locator('button').filter({ hasText: /^All$/ });
    const tabUnread = page.locator('button').filter({ hasText: /^Unread/ });
    const tabRead = page.locator('button').filter({ hasText: /^Read$/ });
    await expect(tabAll).toBeVisible();
    await expect(tabUnread).toBeVisible();
    await expect(tabRead).toBeVisible();

    // Click "Mark all read" if present, or toggle manually
    const markAllBtn = page.locator('button:has-text("Mark all read")');
    if (await markAllBtn.isVisible()) {
      await markAllBtn.click();
      // Unread count should go to 0 or unread tab should be empty
      await tabUnread.click();
      await expect(page.locator('text=No unread notifications')).toBeVisible();
    }
  });

  test('Parent Dashboard History Dynamic Filtering & Page Size Select', async ({ page }) => {
    // Sign in as Parent
    await page.goto('/login');
    await page.locator('text=Authentification en cours').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
    await page.locator('input[type="email"]').focus();
    await page.locator('input[type="email"]').fill('jennifer@example.com');
    await page.locator('input[type="password"]').focus();
    await page.locator('input[type="password"]').fill('password123');
    await page.click('button[type="submit"]');

    // Go to "Sessions & Progress" tab
    await page.click('button.sidebar-nav-item:has-text("Sessions & Progress")');

    // Find and check the filters panel is visible
    await expect(page.locator('text=Full Session History')).toBeVisible();
    const dateRangeSelect = page.locator('select').nth(1); // First is itemsPerPage, second is dateRange
    await expect(dateRangeSelect).toBeVisible();

    // Filter by difficulty = Hard
    const diffSelect = page.locator('select').nth(4);
    await diffSelect.selectOption('hard');
    
    // Check that table rows count has changed
    const rowHard = page.locator('table.data-table tbody tr');
    await expect(rowHard).toHaveCount(1); // Only s2 is hard

    // Set page size selector to 10
    const itemsPerPageSelect = page.locator('select').nth(0);
    await itemsPerPageSelect.selectOption('10');
  });

  test('Specialist Dashboard clinical labels & connection modal cleanup', async ({ page }) => {
    // 1. Sign in as practitioner/OT
    await page.goto('/login');
    await page.locator('text=Authentification en cours').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
    await page.click('button:has-text("Specialist")');
    await page.locator('input[type="email"]').focus();
    await page.locator('input[type="email"]').fill('ot@example.com');
    await page.locator('input[type="password"]').focus();
    await page.locator('input[type="password"]').fill('password123');
    await page.click('button[type="submit"]');

    // Verify Specialist header is Workspace, not OT Dashboard
    await expect(page.locator('h1:has-text("Specialist Workspace")')).toBeVisible();

    // Verify "Connect Learner" button exists (family renamed!)
    const connectBtn = page.locator('button:has-text("Connect Learner")');
    await expect(connectBtn).toBeVisible();
    await connectBtn.click();

    // Check modal title is Connect a Learner, not Connect a Family
    await expect(page.locator('h2:has-text("Connect a Learner")')).toBeVisible();

    // Check tabs in modal use Learner, not Child
    await expect(page.locator('button:has-text("Find a Learner")')).toBeVisible();
  });
});
