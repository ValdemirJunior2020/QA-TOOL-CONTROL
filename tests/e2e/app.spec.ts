import { expect, test } from '@playwright/test'

test('app shell loads without a page crash', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.locator('body')).toBeVisible()
  await expect(page.locator('#root')).toBeAttached()
  expect(errors.filter((message) => !message.includes('Firebase'))).toEqual([])
})

test('authentication entry point renders', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText(/QA Control Center/i).first()).toBeVisible()
  const signIn = page.getByRole('button', { name: /sign in|google/i })
  if (await signIn.count()) await expect(signIn.first()).toBeVisible()
})


test('authenticated navigation pages render when a safe session is already available', async ({ page }) => {
  await page.goto('/')
  const dashboard = page.getByRole('button', { name: /Dashboard/i })
  if (!(await dashboard.count())) test.skip(true, 'No authenticated Firebase session in the isolated test browser.')

  await expect(dashboard.first()).toBeVisible()
  for (const label of [/New Review/i, /Watch List/i, /Review History/i]) {
    const nav = page.getByRole('button', { name: label }).first()
    await nav.click()
    await expect(page.locator('main, .page-stack').first()).toBeVisible()
  }

  const performance = page.getByRole('button', { name: /Agent Performance/i })
  if (await performance.count()) {
    await performance.first().click()
    await expect(page.getByRole('heading', { name: /Agent Performance/i })).toBeVisible()
    await expect(page.getByLabel('Search agents')).toBeVisible()
  }
})
