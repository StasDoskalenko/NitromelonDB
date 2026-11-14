import { expect, test, type Page } from '@playwright/test'

// Two devices running the web app on wa-sqlite (two browser profiles, so two separate databases)
// sync through the reference sync server (examples/sync-server, started by playwright.config.ts).
// Tests that sync share that one server, so they mustn't run at the same time: keep them in this
// test, or make the file serial.
const SERVER = 'http://127.0.0.1:3000'

async function openDevice(page: Page, errors: string[]) {
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByTestId('subtitle')).toContainText('wa-sqlite', { timeout: 90_000 })
  await expect(page.getByTestId('subtitle')).toContainText('100 notes')
  return page
}

// Taps Sync and waits for the status of this sync (the app counts finished syncs)
async function sync(page: Page, expectedCount: number) {
  await page.getByTestId('sync-button').click()
  await expect(page.getByTestId('sync-status')).toHaveText(`Synced (${expectedCount})`, {
    timeout: 60_000,
  })
}

async function addNote(page: Page, title: string) {
  await page.getByTestId('title-input').fill(title)
  await page.getByTestId('body-input').fill(`${title} body`)
  await page.getByTestId('add-note-button').click()
  await expect(page.getByTestId(title)).toBeVisible()
}

async function serverNoteCount(page: Page) {
  const response = await page.request.get(`${SERVER}/__test/dump`)
  const dump = (await response.json()) as { notes: { deleted: number }[] }
  return dump.notes.filter((note) => !note.deleted).length
}

test('two devices on wa-sqlite sync notes through the sync server', async ({
  browser,
  request,
}) => {
  await request.post(`${SERVER}/__test/reset`, { data: {} })
  const errors: string[] = []
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const deviceA = await openDevice(await contextA.newPage(), errors)
  const deviceB = await openDevice(await contextB.newPage(), errors)

  // Each device seeded its own 100 notes. A pushes them, B pushes its own and pulls A's, A pulls B's.
  await sync(deviceA, 1)
  expect(await serverNoteCount(deviceA)).toBe(100)
  await sync(deviceB, 1)
  await expect(deviceB.getByTestId('subtitle')).toContainText('200 notes')
  await sync(deviceA, 2)
  await expect(deviceA.getByTestId('subtitle')).toContainText('200 notes')
  expect(await serverNoteCount(deviceA)).toBe(200)

  // A note added on one device appears on the other
  await addNote(deviceA, 'Written on device A')
  await sync(deviceA, 3)
  await sync(deviceB, 2)
  await expect(deviceB.getByTestId('subtitle')).toContainText('201 notes')
  await expect(deviceB.getByTestId('Written on device A')).toBeVisible()

  // Both add a note and sync at the same time. Adding a note renumbers every note's rank, so both
  // push changes to the same records: one push may be rejected (409), and syncing again resolves it.
  await addNote(deviceA, 'Second note from A')
  await addNote(deviceB, 'Note from B')
  const syncCounts = new Map([
    [deviceA, 3],
    [deviceB, 2],
  ])
  const outcomes = await Promise.all(
    [deviceA, deviceB].map(async (device) => {
      const next = syncCounts.get(device)! + 1
      await device.getByTestId('sync-button').click()
      const status = device.getByTestId('sync-status')
      await expect(status).toHaveText(new RegExp(`^(Synced \\(${next}\\)|Sync failed.*)$`), {
        timeout: 60_000,
      })
      return (await status.textContent()) ?? ''
    }),
  )
  expect(outcomes.some((status) => status.startsWith('Synced'))).toBe(true)
  for (const [index, device] of [deviceA, deviceB].entries()) {
    if (outcomes[index].startsWith('Sync failed')) {
      expect(outcomes[index]).toContain('409')
      await sync(device, syncCounts.get(device)! + 1)
    }
    syncCounts.set(device, syncCounts.get(device)! + 1)
  }
  // One more round, so each device pulls what the other pushed last
  for (const device of [deviceA, deviceB]) {
    syncCounts.set(device, syncCounts.get(device)! + 1)
    await sync(device, syncCounts.get(device)!)
  }

  for (const device of [deviceA, deviceB]) {
    await expect(device.getByTestId('subtitle')).toContainText('203 notes')
    await expect(device.getByTestId('Note from B')).toBeVisible()
    await expect(device.getByTestId('Second note from A')).toBeVisible()
  }
  expect(await serverNoteCount(deviceA)).toBe(203)

  // What a device synced survives a reload
  await deviceB.reload()
  await expect(deviceB.getByTestId('subtitle')).toContainText('203 notes', { timeout: 90_000 })

  expect(errors).toEqual([])
  await contextA.close()
  await contextB.close()
})
