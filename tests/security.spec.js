const { test, expect } = require('@playwright/test');

test.describe('Security Input Validation E2E Tests', () => {

  test('LoginPage: Should allow submit for invalid nickname but fail with security-hardened error', async ({ page }) => {
    await page.goto('/login');
    await page.locator('text=Authentification en cours').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
    // Switch to Learner role
    await page.click('button:has-text("Learner")');
 
    // Fill invalid nickname (special chars)
    const nicknameInput = page.locator('input[placeholder="Learner Nickname"]');
    await nicknameInput.focus();
    await nicknameInput.fill('invalid#nickname');
    await nicknameInput.blur();
 
    // Fill password
    const passwordInput = page.locator('input[placeholder="Password"]');
    await passwordInput.focus();
    await passwordInput.fill('1234');
    await passwordInput.blur();

    // Verify submit button is enabled because format is only checked on submit
    const submitBtn = page.locator('button:has-text("Let\'s Play")');
    await expect(submitBtn).toBeEnabled();

    // Submit and check for generic error text
    await submitBtn.click();
    await expect(page.locator('text=Incorrect email or password.')).toBeVisible();
  });
 
  test('SignUpPage: Should show validation error for invalid names', async ({ page }) => {
    await page.goto('/signup');
    await page.locator('text=Authentification en cours').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});

    const firstNameInput = page.locator('input[placeholder="Jennifer"]');
    await firstNameInput.focus();
    await firstNameInput.fill('Jen123'); // has numbers
    await firstNameInput.blur();

    await expect(page.locator('text=First name contains invalid characters')).toBeVisible();
  });
});
