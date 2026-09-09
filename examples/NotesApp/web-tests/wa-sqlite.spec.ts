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

test('survives a remote outage, works offline, reconnects, and persists through reload', async ({
  context,
  page,
}) => {
  const browserErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))

  await page.goto('/')
  await expect(page.getByTestId('subtitle')).toContainText('wa-sqlite', { timeout: 90_000 })
  await expect(page.getByTestId('subtitle')).toContainText('100 notes')

  const remoteUrl = `${new URL(page.url()).origin}/metadata.json?remote-host-check=${Date.now()}`
  const remoteResponds = () =>
    page.evaluate(async (url) => {
      try {
        return (await fetch(url, { cache: 'no-store' })).ok
      } catch {
        return false
      }
    }, remoteUrl)
  expect(await remoteResponds()).toBe(true)

  await page.getByTestId('title-input').fill('Available before going offline')
  await page.getByTestId('body-input').fill('Stored in the local SQLite replica')
  await page.getByTestId('add-note-button').click()
  await expect(page.getByTestId('Available before going offline')).toBeVisible()

  // Model an authoritative backend that becomes unreachable independently of the loaded app.
  await page.route(remoteUrl, (route) => route.abort('connectionrefused'))
  expect(await remoteResponds()).toBe(false)

  await context.setOffline(true)
  try {
    const networkIsBlocked = await page.evaluate(async () => {
      try {
        await fetch(`/metadata.json?offline-check=${Date.now()}`, { cache: 'no-store' })
        return false
      } catch {
        return true
      }
    })
    expect(networkIsBlocked).toBe(true)

    // Reading and committing a new transaction must work without any network access.
    await expect(page.getByTestId('Available before going offline')).toBeVisible()
    await page.getByTestId('title-input').fill('Created while offline')
    await page.getByTestId('body-input').fill('Committed by wa-sqlite while networking was disabled')
    await page.getByTestId('add-note-button').click()
    await expect(page.getByTestId('subtitle')).toContainText('102 notes')
    await expect(page.getByTestId('Created while offline')).toBeVisible()
  } finally {
    // Reloading the uncached application shell is a hosting/PWA responsibility, so reconnect
    // before navigation and then verify that the offline transaction survived worker teardown.
    await context.setOffline(false)
    await page.unroute(remoteUrl)
  }

  // The same remote endpoint is usable again after connectivity is restored.
  expect(await remoteResponds()).toBe(true)
  await page.reload()
  await expect(page.getByTestId('subtitle')).toContainText('wa-sqlite', { timeout: 90_000 })
  await expect(page.getByTestId('subtitle')).toContainText('102 notes')
  await expect(page.getByTestId('Available before going offline')).toBeVisible()
  await expect(page.getByTestId('Created while offline')).toBeVisible()
  expect(browserErrors).toEqual([])
})

test('passes the shared adapter and SQLite-specific suites in Chromium', async ({ page }) => {
  test.setTimeout(600_000)
  await page.goto('/?adapter-tests=1')
  const status = page.getByTestId('adapter-tests-status')
  await expect(status).toContainText(/Done:|Failed:/, { timeout: 570_000 })
  const failures = await page.getByTestId('adapter-test-failure').allTextContents()
  expect(
    failures,
    failures.length ? `Adapter suite failures:\n\n${failures.join('\n\n')}` : undefined,
  ).toEqual([])
})
