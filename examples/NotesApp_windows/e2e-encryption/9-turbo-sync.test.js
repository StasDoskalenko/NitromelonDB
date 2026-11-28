// Step 9 (encryption build, installed over the decrypted database): encrypts it again, empties it,
// then makes its first sync a Turbo Login, which native code writes straight into the encrypted
// file. Turbo doesn't notify the list, so a cold start checks the result. Needs the sync server
// (the script starts it, and exempts the app from loopback isolation). Mirrors
// ../../NotesApp/maestro-encryption/9-turbo-sync.yaml.
const {
  killAndRelaunch,
  tapTestID,
  testIDExists,
  textVisible,
  waitForNoteCount,
  waitForTestID,
  waitForTestIDText,
  waitForText,
} = require('../e2e/helpers')
const {prepareServer, serverNotes} = require('./sync-server')

test('encryption build: a Turbo Login sync into the encrypted database', async () => {
  await waitForTestID('encryption-status', 60000)
  // Encrypting after a decrypt. Not on a retry after it was already encrypted
  if (await testIDExists('encrypt-button')) {
    await tapTestID('encrypt-button')
  }
  await waitForTestIDText('encryption-status', text => text === 'Encrypted', 60000)

  // The first sync of this install. Not on a retry after it already synced
  if (!(await textVisible('From the server'))) {
    // Turbo Login is for an empty database
    await tapTestID('delete-all-button')
    await waitForNoteCount(0, 30000)
    // Shows once the app has read that it never synced, which can come after the list
    await waitForTestID('turbo-sync-button', 30000)
    await prepareServer()
    await tapTestID('turbo-sync-button')
    await waitForTestIDText('sync-status', text => text === 'Synced (1)', 60000)
  }

  await killAndRelaunch()
  await waitForTestIDText('encryption-status', text => text === 'Encrypted', 60000)
  // Only the server's note
  await waitForNoteCount(1)
  await waitForText('From the server')
  expect(await testIDExists('turbo-sync-button')).toBe(false)

  // Nothing to push: the device had no notes
  expect((await serverNotes()).length).toBe(1)
})
