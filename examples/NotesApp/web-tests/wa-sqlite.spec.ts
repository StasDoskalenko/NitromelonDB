import { expect, test } from '@playwright/test'

test('uses wa-sqlite, persists writes, and reopens from a second tab', async ({ context, page }) => {
  const browserErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))

  await page.goto('/')
  await expect(page.getByTestId('subtitle')).toContainText('wa-sqlite', { timeout: 90_000 })
  await expect(page.getByTestId('subtitle')).toContainText('100 notes')

  await page.getByTestId('title-input').fill('Web SQLite smoke')
  await page.getByTestId('body-input').fill('Persisted by IDBBatchAtomicVFS')
  await page.getByTestId('add-note-button').click()
  await expect(page.getByTestId('subtitle')).toContainText('101 notes')

  await page.reload()
  await expect(page.getByTestId('subtitle')).toContainText('wa-sqlite', { timeout: 90_000 })
  await expect(page.getByTestId('Web SQLite smoke')).toBeVisible()

  const secondTab = await context.newPage()
  secondTab.on('pageerror', (error) => browserErrors.push(error.message))
  await secondTab.goto('/')
  await expect(secondTab.getByTestId('subtitle')).toContainText('101 notes', { timeout: 90_000 })
  await expect(secondTab.getByTestId('Web SQLite smoke')).toBeVisible()

  await page.getByTestId('title-input').fill('Written by first tab')
  await page.getByTestId('body-input').fill('first concurrent writer')
  await secondTab.getByTestId('title-input').fill('Written by second tab')
  await secondTab.getByTestId('body-input').fill('second concurrent writer')
  await Promise.all([
    page.getByTestId('add-note-button').click(),
    secondTab.getByTestId('add-note-button').click(),
  ])
  await expect(page.getByTestId('subtitle')).toContainText(/10[23] notes/, { timeout: 90_000 })
  await expect(secondTab.getByTestId('subtitle')).toContainText(/10[23] notes/, {
    timeout: 90_000,
  })

  await page.reload()
  await expect(page.getByTestId('subtitle')).toContainText('103 notes', { timeout: 90_000 })
  await expect(page.getByTestId('Written by first tab')).toBeVisible()
  await expect(page.getByTestId('Written by second tab')).toBeVisible()

  expect(browserErrors).toEqual([])
})

test('passes the shared adapter and SQLite-specific suites in Chromium', async ({ page }) => {
  test.setTimeout(600_000)
  await page.goto('/?adapter-tests=1')
  const status = page.getByTestId('adapter-tests-status')
  await expect(status).toContainText(/Done:|Failed:/, { timeout: 570_000 })
  await expect(page.getByTestId('adapter-test-failure')).toHaveCount(0)
})
