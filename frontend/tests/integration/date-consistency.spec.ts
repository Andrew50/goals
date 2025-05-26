import { test, expect } from '@playwright/test';
import { generateTestToken } from '../helpers/auth';

const API_URL = 'http://localhost:5057';

// Helper to create a goal via the backend API
async function createGoal(request, token: string, name: string, ts: number) {
  const res = await request.post(`${API_URL}/goals/create`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    data: {
      name,
      goal_type: 'task',
      start_timestamp: ts,
      end_timestamp: ts + 3600000,
      scheduled_timestamp: ts,
      duration: 60
    }
  });
  expect(res.ok()).toBeTruthy();
  return await res.json();
}

test('date displays consistently across views', async ({ page, request }) => {
  const token = generateTestToken(1);
  const name = `Consistency ${Date.now()}`;
  const date = new Date();
  date.setHours(14, 0, 0, 0);
  const ts = date.getTime();

  const goal = await createGoal(request, token, name, ts);

  await page.goto('/calendar');
  await page.waitForSelector('.calendar-container');
  await expect(page.locator('.fc-event', { hasText: name })).toBeVisible();

  // Calendar should display local time 14:00
  const calTime = await page.locator(`.fc-event:has-text("${name}") .fc-time`).textContent();
  expect(calTime).toContain('14:00');

  // Day view
  await page.goto('/day');
  await page.waitForSelector('.day-container');
  await expect(page.locator('.task-card', { hasText: name })).toBeVisible();

  const dayTime = await page.locator('.task-card', { hasText: name }).locator('.task-time').textContent();
  expect(dayTime).toContain('14:00');

  // List view
  await page.goto('/list');
  await page.waitForSelector('.list-container');
  await expect(page.locator('.goals-table td', { hasText: name })).toBeVisible();

  // Fetch from API to verify stored timestamp
  const listRes = await request.get(`${API_URL}/list`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const listData = await listRes.json();
  const found = listData.find(g => g.id === goal.id);
  expect(found.scheduled_timestamp).toBe(ts);
});
