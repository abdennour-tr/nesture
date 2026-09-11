const { test, expect } = require('@playwright/test');
const { injectAxe, checkA11y } = require('axe-playwright');

const profile = { id: 'b0000000-0000-0000-0000-000000000003', learner_id: 'c0000000-0000-0000-0000-000000000003', role: 'learner', first_name: 'Akhil', is_active: true };
const user = { id: profile.id, aud: 'authenticated', role: 'authenticated', email: 'akhil@learner.nestureai.com', email_confirmed_at: '2026-01-01T00:00:00Z', user_metadata: { first_name: 'Akhil', role: 'learner' } };
const names = ['LetterQuest', 'Pinch the Coin', 'Follow the Ladybug', 'Pop the Bubble', 'LetterQuest', 'LetterQuest'];
const sessions = names.map((name, index) => ({ id: `session-${index}`, learner_id: profile.learner_id, game_name: name, start_time: `2026-09-0${9-index}T10:00:00Z`, end_time: `2026-09-0${9-index}T10:03:00Z`, duration_seconds: 180 + index * 20, accuracy_score: [.92, .84, .78, .88, .75, .7][index], difficulty: 'easy', notes: { performanceScore: [91, 83, 76, 87, 73, 69][index] }, is_archived: false }));

async function setup(page, { empty = false, error = false, delay = 0, missingAccuracy = false } = {}) {
  let fail = error;
  await page.route('**/auth/v1/**', route => {
    if (route.request().url().includes('/token')) return route.fulfill({ json: { access_token: 'mock-player-token', refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 3600, user } });
    return route.fulfill({ json: user });
  });
  await page.route('**/rest/v1/**', async route => {
    const url = route.request().url();
    if (url.includes('/users')) return route.fulfill({ json: profile });
    if (url.includes('/sessions')) {
      if (route.request().method() !== 'GET') return route.fulfill({ json: [] });
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (fail) return route.fulfill({ status: 500, json: { message: 'Unavailable' } });
      const rows = empty ? [] : missingAccuracy ? [{ ...sessions[0], accuracy_score: null }] : sessions;
      return route.fulfill({ json: rows, headers: { 'content-range': `0-${rows.length - 1}/${rows.length}` } });
    }
    if (url.includes('/prescriptions')) return route.fulfill({ json: empty ? [] : [{ id: 'assignment-1', status: 'active', exercise: { id: 'activity-1', name: 'Gentle hand practice', target_reflex: 'Palmar Grasp', duration_minutes: 3, video_url: '/test-exercise.mp4' }, specialist: { first_name: 'Sarah', is_active: true }, notes: 'Take your time and follow along.' }] });
    return route.fulfill({ json: [] });
  });
  await page.route('**/test-exercise.mp4', route => route.fulfill({ status: 200, contentType: 'video/mp4', body: '' }));
  await page.goto('/login');
  await page.getByRole('button', { name: /Player|Learner/i }).first().click();
  await page.getByPlaceholder('Learner Nickname').focus();
  await page.getByPlaceholder('Learner Nickname').fill('akhil');
  await page.locator('input[type="password"]').focus();
  await page.locator('input[type="password"]').fill('password123');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole('heading', { name: 'Welcome back, Akhil!' })).toBeVisible();
  return { recover: () => { fail = false; } };
}

async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test('player dashboard responsive layout, themes, navigation and accessibility', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await setup(page);
  await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible();
  await expect(page.locator('.pd-game-card')).toHaveCount(4);
  await page.getByRole('button', { name: 'View all 7 games' }).click();
  await expect(page.locator('.pd-game-card')).toHaveCount(7);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.locator('.pd-stat').first()).toContainText('6');
  await expect(page.locator('.pd-hero-progress')).toContainText('4 / 7');
  await noOverflow(page);
  await injectAxe(page);
  await checkA11y(page, '.pd-root', { detailedReport: true });
  await page.screenshot({ path: `test-results/player-${testInfo.project.name}-dark.png`, fullPage: true });
  await page.screenshot({ path: `test-results/player-${testInfo.project.name}-dark-viewport.png` });
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('.pd-root')).toHaveAttribute('data-theme', 'light');
  await checkA11y(page, '.pd-root', { detailedReport: true });
  await page.screenshot({ path: `test-results/player-${testInfo.project.name}-light.png`, fullPage: true });
  await page.screenshot({ path: `test-results/player-${testInfo.project.name}-light-viewport.png` });
  await page.getByRole('button', { name: 'My progress', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Accuracy over time' })).toBeVisible();
  await expect(page.getByText('+17 percentage points', { exact: false })).toBeVisible();
  await page.getByRole('combobox').selectOption('finger-piano');
  await expect(page.getByRole('heading', { name: 'Your progress starts with play' })).toBeVisible();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.locator('.pd-activity-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(page.locator('.pd-activity-row')).toHaveCount(5);
  await page.getByRole('button', { name: 'My exercises', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'Gentle hand practice' })).toBeVisible();
  await page.getByRole('button', { name: 'Watch video' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await checkA11y(page, '.pd-root', { detailedReport: true });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Watch video' })).toBeFocused();
  await page.getByRole('button', { name: 'My games', exact: true }).click();
  await page.getByRole('link', { name: 'Play Pinch the Coin', exact: true }).click();
  await expect(page).toHaveURL(/\/play\/pinch-coin-difficulty/);
  expect(errors).toEqual([]);
});

test('empty history has no invented scores and every game keeps its route', async ({ page }) => {
  await setup(page, { empty: true });
  await expect(page.getByRole('heading', { name: 'Your first adventure is waiting' })).toBeVisible();
  await expect(page.locator('.pd-stat').nth(2)).toContainText('—');
  await expect(page.locator('.pd-game-progress strong').first()).toHaveText('—');
  await expect(page.getByText('Your activity focus will appear after your first completed game.')).toBeVisible();
  await page.getByRole('button', { name: 'My games', exact: true }).click();
  const routes = ['/play/difficulty', '/play/pinch-coin-difficulty', '/play/ladybug-difficulty', '/play/bubble-difficulty', '/play/trace-type-difficulty', '/play/finger-piano-difficulty', '/play/finger-copy-difficulty'];
  expect(await page.locator('.pd-play').evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual(routes);
  await noOverflow(page);
});

test('failed history can retry without blocking play', async ({ page }) => {
  const mock = await setup(page, { error: true });
  await expect(page.getByRole('alert')).toContainText('Your progress could not be loaded');
  await expect(page.getByRole('link', { name: 'Play LetterQuest', exact: true })).toBeVisible();
  mock.recover();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible();
  await expect(page.getByRole('alert')).not.toBeVisible();
});

test('missing saved accuracy is not displayed as a zero result', async ({ page }) => {
  await setup(page, { missingAccuracy: true });
  await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible();
  await expect(page.locator('.pd-stat').nth(2)).toContainText('—');
  await expect(page.locator('.pd-game-progress strong').first()).toHaveText('—');
  await expect(page.locator('.pd-activity-metric').nth(1)).toHaveText('Accuracy—');
});
