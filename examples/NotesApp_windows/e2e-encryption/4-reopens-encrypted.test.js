// Steps 4 and 6 (encryption build): a cold start opens the encrypted database with the passphrase,
// with every note. Mirrors ../../NotesApp/maestro-encryption/4-reopens-encrypted.yaml.
const {testIDExists, waitForNoteCount, waitForTestIDText, waitForText} = require('../e2e/helpers')

test('encryption build: reopens the encrypted database', async () => {
  await waitForTestIDText('encryption-status', text => text === 'Encrypted', 60000)
  await waitForNoteCount(102)
  await waitForText('After encryption')
  await waitForText('Upgrade marker')
  expect(await testIDExists('encrypt-button')).toBe(false)
})
