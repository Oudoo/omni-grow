// Exercise operator provisioning, company branding and employee onboarding
// through the production UI against the actual local engine.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { chromium, expect as baseExpect } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 15000 });
const fixture = JSON.parse(await readFile('.local/business-test-state.json', 'utf8'));
const suffix = randomBytes(4).toString('hex');
const name = `OG business test ${fixture.run} Browser ${suffix}`;
const ownerEmail = `${fixture.run}-browser-owner-${suffix}@example.test`;
const employeeEmail = `${fixture.run}-browser-employee-${suffix}@example.test`;
const logo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8X8AAAAASUVORK5CYII=', 'base64');
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true, args: ['--no-sandbox'] });
const checks = [], errors = [];
async function page(state) {
  const context = await browser.newContext({ storageState: state });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  return page;
}
async function check(name, task) { await task(); checks.push(name); console.log(`PASS ${name}`); }
async function acceptAndSignIn(page, link, email) {
  await page.goto(link);
  await expect(page.getByRole('heading', { name: `Join ${name}`, exact: true })).toBeVisible();
  await page.getByLabel('Create your password').fill(fixture.password);
  await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'You’re part of the team.', exact: true })).toBeVisible();
  assert(!new URL(page.url()).hash, 'Accepted invitation must be removed from browser history.');
  await page.getByRole('link', { name: 'Continue to sign in' }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(fixture.password);
  const signIn = async () => {
    const [response] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST'),
      page.getByRole('button', { name: 'Sign in to your workspace' }).click()
    ]);
    return response;
  };
  const response = await signIn();
  if (response.status() === 429) {
    console.log('Honoring the native sign-in throttle before browser onboarding continues.');
    let remaining = Math.min(600, (Number(response.headers()['retry-after']) || 300) + 1) * 1000;
    while (remaining > 0) { const duration = Math.min(30000, remaining); await new Promise(resolve => setTimeout(resolve, duration)); remaining -= duration; }
    assert.equal((await signIn()).status(), 200);
  } else assert.equal(response.status(), 200);
  await expect(page.getByRole('heading', { name: 'Your team', exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('link', { name: 'Shared inbox', exact: true })).toHaveCount(0);
}
try {
  const operator = await page(fixture.users.operator.state), owner = await page(), employee = await page();
  let ownerLink;
  await check('operator creates a standalone business and changes its seat allowance in the browser', async () => {
    await operator.goto('http://localhost:3000/operator');
    await operator.getByRole('button', { name: 'Create business', exact: true }).click();
    await operator.getByLabel('Business name', { exact: true }).fill(name);
    await operator.getByLabel('Administrator name', { exact: true }).fill('Browser owner');
    await operator.getByLabel('Administrator email', { exact: true }).fill(ownerEmail);
    await operator.getByRole('combobox', { name: /^Package/ }).selectOption('team');
    await operator.getByLabel('Employee seats', { exact: true }).fill('3');
    await operator.getByRole('button', { name: 'Create business and invitation', exact: true }).click();
    ownerLink = await operator.getByLabel('Private invitation link').inputValue();
    await operator.getByRole('button', { name: 'Done', exact: true }).click();
    const card = operator.locator('.operator-card').filter({ hasText: name });
    await expect(card).toContainText('Team communications');
    await card.getByRole('button', { name: 'Manage package', exact: true }).click();
    await operator.getByLabel('Employee seats', { exact: true }).fill('4');
    await operator.getByRole('button', { name: 'Save package', exact: true }).click();
    await expect(card).toContainText('1 / 4 seats');
  });
  await check('invited administrator chooses a password, signs in and saves a real company logo', async () => {
    await acceptAndSignIn(owner, ownerLink, ownerEmail);
    await owner.getByRole('link', { name: 'Business settings', exact: true }).click();
    await owner.getByLabel('About your business').fill('Browser-verified company profile');
    await owner.getByLabel('Website', { exact: true }).fill('https://growcdx.com');
    await owner.getByLabel('Brand color').fill('#245c47');
    await owner.getByLabel('Company logo').setInputFiles({ name: 'company.png', mimeType: 'image/png', buffer: logo });
    await owner.getByRole('button', { name: 'Save company profile' }).click();
    await expect(owner.getByRole('status')).toContainText('Company profile saved.');
    await owner.reload();
    await expect(owner.getByLabel('About your business')).toHaveValue('Browser-verified company profile');
    await expect(owner.getByLabel('Brand color')).toHaveValue('#245c47');
    const actual = await owner.context().request.get('http://localhost:3000/api/business/logo');
    assert.equal(actual.status(), 200); assert.deepEqual(await actual.body(), logo);
    await expect(owner.locator('.company-identity img')).toBeVisible();
  });
  await check('administrator invites an employee who joins with separate credentials and limited permissions', async () => {
    await owner.getByRole('button', { name: 'Employees', exact: true }).click();
    await owner.getByRole('button', { name: 'Invite employee', exact: true }).click();
    await owner.getByLabel('Full name').fill('Browser employee');
    await owner.getByLabel('Work email').fill(employeeEmail);
    await owner.getByRole('button', { name: 'Create invitation', exact: true }).click();
    const link = await owner.getByLabel('Private invitation link').inputValue();
    await owner.getByRole('button', { name: 'Done', exact: true }).click();
    await acceptAndSignIn(employee, link, employeeEmail);
    await employee.getByRole('link', { name: 'Business settings', exact: true }).click();
    await expect(employee.getByLabel('Business name', { exact: true })).toBeDisabled();
    await employee.getByRole('button', { name: 'Employees', exact: true }).click();
    await expect(employee.getByRole('button', { name: 'Invite employee', exact: true })).toHaveCount(0);
    await expect(employee.getByText(employeeEmail, { exact: true })).toBeVisible();
    await owner.reload();
    await owner.getByRole('button', { name: 'Employees', exact: true }).click();
    await expect(owner.getByText(employeeEmail, { exact: true })).toBeVisible();
    await expect(owner.getByText('Pending invitations', { exact: true })).toHaveCount(0);
  });
  assert.deepEqual(errors, [], 'Onboarding must not produce browser runtime errors.');
  console.log(`Passed ${checks.length} real browser onboarding checks.`);
} finally {
  await writeFile('.local/business-onboarding-results.json', JSON.stringify({ passed: checks.length, checks, browserErrors: errors }, null, 2));
  await browser.close();
}
