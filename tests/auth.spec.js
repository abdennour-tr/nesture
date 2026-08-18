const { test, expect } = require('@playwright/test');

test.describe('Authentication & Roles E2E Validation', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    // Wait for auth initialization spinner to disappear
    await page.locator('text=Authentification en cours').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  });

  test('Should render role selectors (Parent, Specialist, Learner) on Login page', async ({ page }) => {
    // Assert all three selector tabs are visible
    await expect(page.locator('button:has-text("Parent")')).toBeVisible();
    await expect(page.locator('button:has-text("Specialist")')).toBeVisible();
    await expect(page.locator('button:has-text("Learner")')).toBeVisible();
  });

  test('Should show correct header matching selected role on Login page', async ({ page }) => {
    // Parent should be active by default
    await expect(page.locator('h2:has-text("Parent Sign In")')).toBeVisible();

    // Click Specialist
    await page.click('button:has-text("Specialist")');
    await expect(page.locator('h2:has-text("Specialist Sign In")')).toBeVisible();

    // Click Learner
    await page.click('button:has-text("Learner")');
    await expect(page.locator('h2:has-text("Learner Playroom")')).toBeVisible();
  });

  test('Should display specific dynamic disclaimers per role', async ({ page }) => {
    // Parent disclaimer check
    await expect(page.locator('text=Parent Disclaimer:')).toBeVisible();

    // Click Specialist tab
    await page.click('button:has-text("Specialist")');
    await expect(page.locator('text=Specialist Disclaimer:')).toBeVisible();

    // Click Learner tab
    await page.click('button:has-text("Learner")');
    await expect(page.locator('text=Welcome Learner!')).toBeVisible();
  });

  test('Should allow submit for invalid email format but fail with security-hardened error', async ({ page }) => {
    // Click on input to remove read-only attribute
    const emailInput = page.locator('input[type="email"]');
    await emailInput.focus();
    await emailInput.fill('invalidemail@@example');
    await emailInput.blur();

    const passwordInput = page.locator('input[type="password"]');
    await passwordInput.focus();
    await passwordInput.fill('password123');
    await passwordInput.blur();

    // Verify submit button is enabled because format is only checked on submit
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled();

    // Submit and assert the unified error is displayed
    await submitBtn.click();
    await expect(page.locator('text=Incorrect email or password.')).toBeVisible();
  });

  test('Should block sign-up client-side for mismatched passwords', async ({ page }) => {
    await page.goto('/signup');
    await page.locator('text=Authentification en cours').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});

    await page.locator('input[placeholder="Jennifer"]').focus();
    await page.locator('input[placeholder="Jennifer"]').fill('John');
    await page.locator('input[placeholder="Jennifer"]').blur();

    await page.locator('input[placeholder="Chen"]').focus();
    await page.locator('input[placeholder="Chen"]').fill('Doe');
    await page.locator('input[placeholder="Chen"]').blur();

    await page.locator('input[type="email"]').focus();
    await page.locator('input[type="email"]').fill('john.doe@example.com');
    await page.locator('input[type="email"]').blur();

    await page.locator('input[placeholder="Min. 8 characters"]').focus();
    await page.locator('input[placeholder="Min. 8 characters"]').fill('securepass123');
    await page.locator('input[placeholder="Min. 8 characters"]').blur();

    await page.locator('input[placeholder="••••••••"]').focus();
    await page.locator('input[placeholder="••••••••"]').fill('differentpass123');
    await page.locator('input[placeholder="••••••••"]').blur();

    // Verify validation error is visible and continue button is disabled
    await expect(page.locator('text=Passwords do not match.')).toBeVisible();
    await expect(page.locator('button:has-text("Continue")')).toBeDisabled();
  });

  test('Should show blocker toast if learner email is submitted on the parent/specialist form', async ({ page }) => {
    const emailInput = page.locator('input[placeholder="Email address"]');
    await emailInput.focus();
    await emailInput.fill('akhil@example.com');
    await emailInput.blur();

    const passwordInput = page.locator('input[placeholder="Password"]');
    await passwordInput.focus();
    await passwordInput.fill('1234');
    await passwordInput.blur();

    // Verify submit button is enabled because password is 4 chars but it's a learner email
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled();

    // Click submit and check for blocker toast error
    await submitBtn.click();
    await expect(page.locator('text=This is a Learner account. Please select the')).toBeVisible();
  });

  test('Should allow learner login with nickname and 4-character password', async ({ page }) => {
    // Switch to Learner tab
    await page.click('button:has-text("Learner")');

    const nicknameInput = page.locator('input[placeholder="Learner Nickname"]');
    await nicknameInput.focus();
    await nicknameInput.fill('akhil');
    await nicknameInput.blur();

    const passwordInput = page.locator('input[placeholder="Password"]');
    await passwordInput.focus();
    await passwordInput.fill('1234');
    await passwordInput.blur();

    // Verify there are no validation errors visible
    await expect(page.locator('text=Password must be at least 4 characters')).not.toBeVisible();
    await expect(page.locator('text=Password must be at least 8 characters')).not.toBeVisible();

    const submitBtn = page.locator('button:has-text("Let\'s Play")');
    await expect(submitBtn).toBeEnabled();
  });
});

