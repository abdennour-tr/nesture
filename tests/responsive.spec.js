const { test, expect } = require('@playwright/test');

// Helper function to check if page has horizontal scrollbar
async function checkHorizontalScroll(page) {
  return await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });
}

test.describe('Responsive Layout & Overflow Tests', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (err) => {
      console.error('SAFARI PAGE ERROR:', err.message, err.stack);
    });
    page.on('console', (msg) => {
      console.log('SAFARI CONSOLE:', msg.text());
    });
  });

  // Test login page on multiple viewports to verify no overflow
  test('Login Page has no horizontal scroll and renders inputs properly', async ({ page }) => {
    await page.goto('/login');
    await page.locator('text=Authentification en cours').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
    
    // Check elements are visible
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
    
    // Verify no horizontal overflow
    const hasScroll = await checkHorizontalScroll(page);
    expect(hasScroll).toBe(false);
  });
 
  // Test signup page responsive rendering
  test('SignUp Page renders without horizontal overflow', async ({ page }) => {
    await page.goto('/signup');
    await page.locator('text=Authentification en cours').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
    await expect(page.locator('input[type="email"]')).toBeVisible();
    
    const hasScroll = await checkHorizontalScroll(page);
    expect(hasScroll).toBe(false);
  });
 
  // Test Admin Dashboard sidebar toggling on mobile/tablet viewports
  test('Admin Dashboard sidebar toggles on tablet/mobile views', async ({ page }) => {
    await page.goto('/admin');
    await page.locator('text=Authentification en cours').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
 
    // Fill credentials
    await page.fill('input[type="email"]', 'admin@gmail.com');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');

    // Admin dashboard should load
    await expect(page.locator('text=Export Sessions CSV')).toBeVisible();

    const viewportSize = page.viewportSize();

    if (viewportSize && viewportSize.width <= 1024) {
      // Under 1024px: sidebar should be hidden by default
      const sidebar = page.locator('aside.admin-sidebar');
      await expect(sidebar).not.toHaveClass(/open/);

      // Mobile toggle button should be visible
      const toggleBtn = page.locator('button.admin-mobile-toggle');
      await expect(toggleBtn).toBeVisible();

      // Click to toggle open
      await toggleBtn.click();
      await expect(sidebar).toHaveClass(/open/);

      // Click overlay or close to hide
      await page.click('button.admin-mobile-toggle'); // or click toggle again to close
      await expect(sidebar).not.toHaveClass(/open/);
    } else {
      // Desktop: sidebar should be visible
      const sidebar = page.locator('aside.admin-sidebar');
      await expect(sidebar).toBeVisible();
      
      const toggleBtn = page.locator('button.admin-mobile-toggle');
      await expect(toggleBtn).not.toBeVisible();
    }

    // Verify no horizontal scroll on dashboard
    const hasScroll = await checkHorizontalScroll(page);
    expect(hasScroll).toBe(false);
  });
});
