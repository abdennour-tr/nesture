const { test, expect } = require('@playwright/test');

async function setupSupabaseMocks(page) {
  const router = page.context();

  // Mock login token request
  await router.route('**/auth/v1/token?grant_type=password', async (route) => {
    const postData = JSON.parse(route.request().postData() || '{}');
    const email = postData.email || 'jennifer@example.com';
    const isOT = email.includes('ot') || email.includes('alex') || email.includes('practitioner');
    const isLearner = email.includes('learner') || email.includes('lily');
    
    let userId = 'b0000000-0000-0000-0000-000000000001';
    let role = 'parent';
    let firstName = 'Jennifer';
    let lastName = 'Chen';
    
    if (isOT) {
      userId = 'b0000000-0000-0000-0000-000000000002';
      role = 'practitioner';
      firstName = 'Alex';
      lastName = 'Practitioner';
    } else if (isLearner) {
      userId = 'b0000000-0000-0000-0000-000000000003';
      role = 'learner';
      firstName = 'Lily';
      lastName = 'Chen';
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: isLearner ? 'mock-access-token-learner' : 'mock-access-token',
        token_type: 'bearer',
        expires_in: 3600,
        refresh_token: 'mock-refresh-token',
        user: {
          id: userId,
          aud: 'authenticated',
          role: 'authenticated',
          email: email,
          email_confirmed_at: '2026-06-13T20:00:00Z',
          user_metadata: {
            first_name: firstName,
            last_name: lastName,
            role: role
          }
        }
      })
    });
  });

  // Mock GET/POST/PUT users
  await router.route('**/rest/v1/users**', async (route) => {
    const url = route.request().url();
    const isOT = url.includes('practitioner') || url.includes('b0000000-0000-0000-0000-000000000002') || url.includes('ot');
    const isLearner = url.includes('learner') || url.includes('b0000000-0000-0000-0000-000000000003') || url.includes('lily');
    
    let userId = 'b0000000-0000-0000-0000-000000000001';
    let role = 'parent';
    let firstName = 'Jennifer';
    let lastName = 'Chen';

    if (isOT) {
      userId = 'b0000000-0000-0000-0000-000000000002';
      role = 'practitioner';
      firstName = 'Alex';
      lastName = 'Practitioner';
    } else if (isLearner) {
      userId = 'b0000000-0000-0000-0000-000000000003';
      role = 'learner';
      firstName = 'Lily';
      lastName = 'Chen';
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: userId,
        role: role,
        first_name: firstName,
        last_name: lastName,
        created_at: '2026-06-13T20:00:00Z',
        beta_participant: true
      })
    });
  });

  // Mock GET/POST/PUT children
  await router.route('**/rest/v1/children**', async (route) => {
    const url = route.request().url();
    const headers = route.request().headers();
    const isSingle = (headers['accept'] && headers['accept'].includes('vnd.pgrst.object')) || url.match(/[?&]id=eq\./);
    const child = {
      id: '00000000-0000-0000-0000-000000000011',
      parent_id: 'b0000000-0000-0000-0000-000000000001',
      first_name: 'Lily',
      last_name: 'Chen',
      name: 'Lily Chen',
      age: 8,
      diagnosis: 'ASD',
      completeness_percentage: 28,
      avatar_color: '#F472B6'
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(isSingle ? child : [child])
    });
  });

  // Mock GET/POST/PUT practitioner_children
  await router.route('**/rest/v1/practitioner_children**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          practitioner_id: 'b0000000-0000-0000-0000-000000000002',
          child_id: '00000000-0000-0000-0000-000000000011'
        }
      ])
    });
  });

  // Mock GET/POST exercises
  await router.route('**/rest/v1/exercises**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'ex1',
          name: 'Starfish Stretch',
          target_reflex: 'Moro',
          description: 'Actively stretch arms and legs like a starfish',
          duration_minutes: 5,
          video_url: 'https://example.com/starfish',
          difficulty_level: 'Easy'
        }
      ])
    });
  });

  // Mock GET learn-content
  await router.route('**/rest/v1/learn_content**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([])
    });
  });

  // Mock GET atlas-profiles
  await router.route('**/rest/v1/atlas_profiles**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        child_id: '00000000-0000-0000-0000-000000000011',
        motor_reflexes: []
      })
    });
  });

  // Mock GET/POST/PATCH/PUT sessions
  await router.route('**/rest/v1/sessions**', async (route) => {
    const method = route.request().method();
    if (method === 'PATCH' || method === 'PUT') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([])
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'content-range': '0-0/0'
        },
        body: JSON.stringify([])
      });
    }
  });
  // Mock reflex_scores
  await router.route('**/rest/v1/reflex_scores**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([])
    });
  });

  // Mock connection_requests
  await router.route('**/rest/v1/connection_requests**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([])
    });
  });

  // Mock documents
  await router.route('**/rest/v1/documents**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([])
    });
  });
}

test.describe('Specialist Exercise Assignment and Syncing Pipeline', () => {

  test.beforeEach(async ({ page }) => {
    await setupSupabaseMocks(page);
  });

  test('Specialist assigns exercise, parent and learner view assignments with status updates', async ({ page }) => {
    page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
    page.on('pageerror', err => console.error('BROWSER ERROR:', err.message));
    page.on('requestfailed', request => {
      console.log('REQUEST FAILED:', request.url(), request.failure()?.errorText);
    });
    page.on('response', response => {
      if (response.status() >= 400) {
        console.log('BAD RESPONSE:', response.status(), response.url());
      }
    });
    let capturedPrescribeBody = null;
    let capturedStatusBody = null;

    // Intercept prescriptions API calls
    await page.context().route('**/rest/v1/prescriptions**', async (route) => {
      const method = route.request().method();
      if (method === 'POST') {
        const parsed = JSON.parse(route.request().postData() || '{}');
        capturedPrescribeBody = Array.isArray(parsed) ? parsed[0] : parsed;
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'pres1' })
        });
      } else if (method === 'PATCH' || method === 'PUT') {
        const parsedStatus = JSON.parse(route.request().postData() || '{}');
        capturedStatusBody = Array.isArray(parsedStatus) ? parsedStatus[0] : parsedStatus;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'pres1', status: 'completed' })
        });
      } else if (method === 'GET') {
        if (!capturedPrescribeBody) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([])
          });
          return;
        }

        // Return prescriptions joined with exercise details
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 'pres1',
              learner_id: '00000000-0000-0000-0000-000000000011',
              exercise_id: 'ex1',
              specialist_id: 'b0000000-0000-0000-0000-000000000002',
              status: capturedStatusBody ? 'completed' : 'active',
              notes: 'Assigned by OT',
              prescribed_at: '2026-06-23T20:00:00Z',
              exercise: {
                id: 'ex1',
                name: 'Starfish Stretch',
                target_reflex: 'Moro',
                duration_minutes: 5,
                video_url: 'https://example.com/starfish'
              }
            }
          ])
        });
      }
    });

    // 1. OT Logs in to Specialist Dashboard and assigns exercise
    await page.goto('/login');
    await page.locator('text=Authentification en cours').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
    
    await page.click('button:has-text("Specialist")');
    await page.locator('input[type="email"]').focus();
    await page.locator('input[type="email"]').fill('ot@example.com');
    await page.locator('input[type="password"]').focus();
    await page.locator('input[type="password"]').fill('password123');
    await page.click('button[type="submit"]');

    // Verify Specialist Dashboard loaded
    await expect(page.locator('h1:has-text("Specialist Workspace")')).toBeVisible();

    // Click on learner "Lily Chen" to navigate to details
    await page.click('text=Lily Chen');

    // Click "Exercises" tab
    await page.click('button:has-text("Exercises")');
    await expect(page.locator('text=Exercise Assignment')).toBeVisible();

    // Assign "Starfish Stretch"
    await page.click('button:has-text("Assign")');
    
    // Assert check on captured payload
    await page.waitForTimeout(1500);
    expect(capturedPrescribeBody).not.toBeNull();
    expect(capturedPrescribeBody.learner_id).toBe('00000000-0000-0000-0000-000000000011');
    expect(capturedPrescribeBody.exercise_id).toBe('ex1');
    expect(capturedPrescribeBody.specialist_id).toBe('b0000000-0000-0000-0000-000000000002');

    // 2. Parent logs in and views Assigned Exercises in NestureLearn tab
    await page.click('button:has-text("Sign Out")');
    await page.goto('/login');
    await page.click('button:has-text("Parent")');
    await page.locator('input[type="email"]').focus();
    await page.locator('input[type="email"]').fill('jennifer@example.com');
    await page.locator('input[type="password"]').focus();
    await page.locator('input[type="password"]').fill('password123');
    await page.click('button[type="submit"]');

    // Verify parent dashboard is visible
    await expect(page.locator('h1:has-text("Parent Dashboard")')).toBeVisible();

    // Click "NestureLearn" tab in sidebar
    await page.click('button.sidebar-nav-item:has-text("NestureLearn")');

    // Verify the Assigned by Specialist section and card are visible
    await expect(page.locator('text=Assigned by Specialist').first()).toBeVisible();
    await expect(page.locator('text=Starfish Stretch')).toBeVisible();
    await expect(page.locator('text=💡 Assigned by OT')).toBeVisible();

    // 3. Learner logs in, views exercises, and marks as completed

    // Mock GET children lookup for learner
    await page.context().route('**/rest/v1/children?auth_user_id=**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          id: '00000000-0000-0000-0000-000000000011',
          first_name: 'Lily',
          last_name: 'Chen'
        }])
      });
    });

    await page.click('button:has-text("Sign Out")');
    await page.goto('/login');
    await page.click('button:has-text("Learner")');
    await page.locator('input[placeholder="Learner Nickname"]').focus();
    await page.locator('input[placeholder="Learner Nickname"]').fill('lily');
    await page.locator('input[placeholder="Password"]').focus();
    await page.locator('input[placeholder="Password"]').fill('1234');
    await page.click('button:has-text("Let\'s Play")');

    // Verify Learner Home playroom loaded
    await expect(page.locator('text=Hello, Lily!')).toBeVisible();

    // Go to "My Exercises" view
    await page.click('.sidebar-nav-item:has-text("My Exercises")');

    // Verify exercise is under Active Exercises with "Assigned by Specialist" badge
    await expect(page.locator('text=Active Exercises')).toBeVisible();
    await expect(page.locator('text=Assigned by Specialist')).toBeVisible();
    await expect(page.locator('text=Starfish Stretch')).toBeVisible();

    // Click "Done" (Mark as Completed)
    await page.click('button:has-text("Done")');

    // Verify that status update API call is triggered
    await page.waitForTimeout(1500);
    expect(capturedStatusBody).not.toBeNull();
    expect(capturedStatusBody.status).toBe('completed');
  });
});
