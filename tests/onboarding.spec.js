const { test, expect } = require('@playwright/test');

async function setupSupabaseMocks(page) {
  const router = page.context();

  // Mock login token request
  await router.route('**/auth/v1/token?grant_type=password', async (route) => {
    const postData = JSON.parse(route.request().postData() || '{}');
    const isOT = postData.email?.includes('alex') || postData.email?.includes('ot');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'mock-access-token',
        token_type: 'bearer',
        expires_in: 3600,
        refresh_token: 'mock-refresh-token',
        user: {
          id: isOT ? 'b0000000-0000-0000-0000-000000000002' : 'b0000000-0000-0000-0000-000000000001',
          aud: 'authenticated',
          role: 'authenticated',
          email: postData.email || 'jennifer@example.com',
          email_confirmed_at: '2026-06-13T20:00:00Z',
          user_metadata: {
            first_name: isOT ? 'Alex' : 'Jennifer',
            last_name: isOT ? 'Practitioner' : 'Chen',
            role: isOT ? 'practitioner' : 'parent'
          }
        }
      })
    });
  });

  // Mock signUp request
  await router.route('**/auth/v1/signup', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'b0000000-0000-0000-0000-000000000009',
          aud: 'authenticated',
          role: 'authenticated',
          email: 'lily@learner.nestureai.com',
          email_confirmed_at: '2026-06-13T20:00:00Z'
        }
      })
    });
  });

  // Mock GET/POST/PUT users
  await router.route('**/rest/v1/users**', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
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
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
  });

  // Mock GET/POST/PUT children
  await router.route('**/rest/v1/children**', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
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
    } else {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '00000000-0000-0000-0000-000000000011',
          parent_id: 'b0000000-0000-0000-0000-000000000001',
          first_name: 'Lily',
          last_name: 'Chen',
          name: 'Lily Chen'
        })
      });
    }
  });

  // Mock GET/POST/PUT/DELETE learners
  await router.route('**/rest/v1/learners**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}'
    });
  });

  // Mock GET/POST/PUT atlas_profiles
  await router.route('**/rest/v1/atlas_profiles**', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '00000000-0000-0000-0000-000000000012',
          child_id: '00000000-0000-0000-0000-000000000011',
          completeness_percentage: 28,
          strengths: [],
          challenges: [],
          communication_profile: {},
          sensory_profile: {},
          functional_wellness: [],
          motor_reflexes: []
        })
      });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
  });

  // In-memory messages for E2E tests isolation verification
  let mockAskAiMessages = [];

  await router.route('**/rest/v1/ask_ai_messages**', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      const url = route.request().url();
      let filtered = [...mockAskAiMessages];
      if (url.includes('user_id=eq.')) {
        const userId = url.split('user_id=eq.')[1].split('&')[0];
        filtered = filtered.filter(m => m.user_id === userId);
      }
      if (url.includes('child_id=eq.')) {
        const childId = url.split('child_id=eq.')[1].split('&')[0];
        filtered = filtered.filter(m => m.child_id === childId);
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(filtered)
      });
    } else if (method === 'POST') {
      const body = JSON.parse(route.request().postData() || '{}');
      const newMsg = {
        id: 'msg-' + Date.now() + '-' + Math.random(),
        user_id: body.user_id || 'b0000000-0000-0000-0000-000000000001',
        user_role: body.user_role || 'parent',
        child_id: body.child_id || '00000000-0000-0000-0000-000000000011',
        sender: body.sender || 'user',
        text: body.text || '',
        created_at: new Date().toISOString()
      };
      mockAskAiMessages.push(newMsg);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(newMsg)
      });
    } else if (method === 'DELETE') {
      mockAskAiMessages = [];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{}'
      });
    }
  });

  // Mock Groq Completions API
  await router.route('**/openai/v1/chat/completions', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: 'AI Response Mocked: Lily has great expressive language skills.'
            }
          }
        ]
      })
    });
  });

  // Mock fallback endpoints returning empty lists
  const emptyEndpoints = [
    '**/rest/v1/sessions**',
    '**/rest/v1/reflex_scores**',
    '**/rest/v1/exercises**',
    '**/rest/v1/prescriptions**',
    '**/rest/v1/practitioner_children**',
    '**/rest/v1/consent**',
    '**/rest/v1/learn_content**'
  ];

  for (const endpoint of emptyEndpoints) {
    await router.route(endpoint, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '[]'
      });
    });
  }

  // Mock Supabase Edge Function process-document
  await router.route('**/functions/v1/process-document', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: 'Document is valid.',
        agent1: { decision: 'APPROVED' }
      })
    });
  });

  // Mock Supabase Storage upload
  await router.route('**/storage/v1/object/patient-documents/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        path: 'temp_validation/mock-path.pdf',
        id: 'mock-id',
        fullPath: 'patient-documents/temp_validation/mock-path.pdf'
      })
    });
  });
}

test.describe('Onboarding Wizard & Settings E2E Validation', () => {

  test.beforeEach(async ({ page }) => {
    // Setup Supabase network mocks before navigating
    await setupSupabaseMocks(page);
 
    // Log in as a Parent before each test
    await page.goto('/login');
    await page.locator('text=Authentification en cours').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
    await page.locator('input[type="email"]').focus();
    await page.locator('input[type="email"]').fill('jennifer@example.com');
    await page.locator('input[type="password"]').focus();
    await page.locator('input[type="password"]').fill('password123');
    await page.click('button[type="submit"]');
 
    // Confirm that parent dashboard is rendered
    await expect(page.locator('h1:has-text("Parent Dashboard")')).toBeVisible();
  });

  test('Should validate DOB field correctly in onboarding modal (Step 1)', async ({ page }) => {
    // Open onboarding modal
    await page.click('button:has-text("Add Child")');
    await expect(page.locator('h2:has-text("Child Details")')).toBeVisible();

    const nameInput = page.locator('input[placeholder="e.g. Lily Chen"]');
    await nameInput.fill('Lily Chen');

    // Select communication
    await page.locator('select').selectOption('verbal');

    // 1. Future DOB test
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const dobInput = page.locator('input[type="date"]');
    await dobInput.fill(tomorrowStr);
    await dobInput.blur();

    // Verify future date validation message
    await expect(page.locator('text=Date cannot be in the future.')).toBeVisible();
    await expect(page.locator('button:has-text("Continue →")')).toBeDisabled();

    // 2. Age > 80 DOB test (e.g. year 1940)
    await dobInput.fill('1940-01-01');
    await dobInput.blur();

    // Verify age > 80 validation message
    await expect(page.locator('text=Age must be between 0 and 80 years old.')).toBeVisible();
    await expect(page.locator('button:has-text("Continue →")')).toBeDisabled();
  });

  test('Should calculate age exactly, prefill verify inputs, and validate age limit in Step 3', async ({ page }) => {
    // Open onboarding modal
    await page.click('button:has-text("Add Child")');
    await expect(page.locator('h2:has-text("Child Details")')).toBeVisible();

    // Fill valid details
    await page.locator('input[placeholder="e.g. Lily Chen"]').fill('Lily Chen');
    await page.locator('input[type="date"]').fill('2020-03-10'); // Age is ~6 years old in 2026
    await page.locator('select').selectOption('verbal');

    // Click Continue to step 2 (upload)
    await page.click('button:has-text("Continue →")');
    await expect(page.locator('h2:has-text("Upload Reports")')).toBeVisible();

    // Upload a mock file so that Step 2 enables the 'Continue →' button
    await page.setInputFiles('input[type="file"]#onboardFileInput', {
      name: 'report.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('mock pdf content')
    });
    await expect(page.locator('text=file selected')).toBeVisible();

    // Click Analyze Documents button to mock the suitability check success
    await page.click('button:has-text("Analyze Documents →")');

    // Click Continue on step 2 to go to step 3 (verify)
    await page.click('button:has-text("Continue →")');
    await expect(page.locator('h2:has-text("Quick Verification")')).toBeVisible();

    // Verify that three numeric age inputs are prefilled
    const yearsInput = page.locator('input[type="number"]').nth(0);
    const monthsInput = page.locator('input[type="number"]').nth(1);
    const daysInput = page.locator('input[type="number"]').nth(2);

    await expect(yearsInput).toHaveValue('6');

    // Change Years to 81 to trigger validation error
    await yearsInput.fill('81');
    await expect(page.locator('text=Age must be between 0 and 80 years old.')).toBeVisible();
    await expect(page.locator('button:has-text("Continue →")')).toBeDisabled();

    // Set back to valid age
    await yearsInput.fill('6');
    await expect(page.locator('text=Age must be between 0 and 80 years old.')).not.toBeVisible();

    // Check verification questions
    await page.locator('select').nth(0).selectOption('Full sentences');
    await page.locator('select').nth(1).selectOption('Pre-literate (learning letters)');

    // Click Continue to step 4 (learner-login)
    await page.click('button:has-text("Continue →")');
    await expect(page.locator('h2:has-text("Learner Login")')).toBeVisible();

    // Verify learner nickname is automatically prefilled with child's lowercase first name
    const nicknameInput = page.locator('input[placeholder="e.g. lilybee"]');
    await expect(nicknameInput).toHaveValue('lily');

    // Verify "Skip & Build Profile" button is gone (only "Save & Build Profile" is present)
    await expect(page.locator('button:has-text("Skip & Build Profile")')).not.toBeVisible();

    // Verify that nickname cannot contain "@"
    await nicknameInput.fill('lily@chen');
    await nicknameInput.blur();
    await expect(page.locator('text=Nickname cannot contain "@" or be an email address.')).toBeVisible();
    await expect(page.locator('button:has-text("Save & Build Profile")')).toBeDisabled();
  });

  test('Should open settings tab and focus edit child form when Edit child tab is clicked', async ({ page }) => {
    // Click edit child profile button
    // Let's target the button with title "Edit Child Profile"
    await page.click('button[title="Edit Child Profile"]');

    // Verify child edit section is expanded and first name input is visible
    await expect(page.locator('label:has-text("First Name")').nth(1)).toBeVisible();
  });

  test('Should copy session state to localStorage and open Chat in a new tab without re-login', async ({ page, context }) => {
    // Click Ask AI button
    await page.click('button:has-text("Ask AI")');
    await expect(page.locator('h2:has-text("Ask about Lily")')).toBeVisible();

    // Click Open in new tab Link and wait for the new page event
    const [newPage] = await Promise.all([
      context.waitForEvent('page'),
      page.click('a[title="Open in new tab"]')
    ]);

    // Verify the new page displays the correct title (authenticating automatically)
    await expect(newPage.locator('h1:has-text("Ask about Lily")')).toBeVisible({ timeout: 15000 });
  });

  test('Should isolate Ask AI conversation history between parent and specialist', async ({ page }) => {
    // 1. We are already logged in as Parent Jennifer because of beforeEach
    // Open Ask AI drawer
    await page.click('button:has-text("Ask AI")');
    await expect(page.locator('h2:has-text("Ask about Lily")')).toBeVisible();

    // Verify chat greeting is visible
    await expect(page.locator('text=Hi! I\'m the Nesture')).toBeVisible();

    // Type a message as Parent and send it
    const chatInput = page.locator('input[placeholder="Ask anything about the child profile..."]');
    await chatInput.fill('What are Lily strengths?');
    await chatInput.press('Enter');

    // Wait for message to appear in chat log
    await expect(page.locator('text=What are Lily strengths?')).toBeVisible();
    // Wait for AI response in chat log
    await expect(page.locator('text=I do not have enough validated information.')).toBeVisible();

    // Click Close to close the Ask AI drawer
    await page.click('button[title="Close Chat"]');

    // Log out as Parent Jennifer
    await page.click('button:has-text("Sign Out")');
    await expect(page.locator('h2:has-text("Parent Sign In")')).toBeVisible();

    // Switch role to Specialist
    await page.click('button:has-text("Specialist")');
    // Log in as Specialist
    const specialistEmail = page.locator('input[type="email"]');
    await specialistEmail.focus();
    await specialistEmail.fill('alex.ot@example.com');
    const specialistPass = page.locator('input[type="password"]');
    await specialistPass.focus();
    await specialistPass.fill('password123');
    await page.click('button[type="submit"]');

    // Wait for landing on specialist dashboard
    await expect(page.locator('h1:has-text("Specialist Workspace")')).toBeVisible({ timeout: 15000 });

    // Open Learner details page for Lily
    await page.goto('/ot/learner/00000000-0000-0000-0000-000000000011');
    await expect(page.locator('h1:has-text("Lily Chen")')).toBeVisible();

    // Open Ask AI drawer as Specialist
    await page.click('button:has-text("Ask AI")');
    await expect(page.locator('h2:has-text("Ask about Lily")')).toBeVisible();

    // Verify that Specialist's chat history is EMPTY (no parent message visible)
    await expect(page.locator('text=What are Lily strengths?')).not.toBeVisible();
    await expect(page.locator('text=I do not have enough validated information.')).not.toBeVisible();

    // Verify only the fresh greeting is shown
    await expect(page.locator('text=Hi! I\'m the Nesture')).toBeVisible();
  });
});
