// Step 8 (plain build, installed over the decrypted database): opens it like any database from
// before encryption, with every note. Mirrors
// ../../NotesApp/maestro-encryption/8-plain-opens-decrypted.yaml.
const {testIDExists, waitForNoteCount, waitForText} = require('../e2e/helpers')

test('plain build: opens the decrypted database', async () => {
  await waitForNoteCount(103)
  expect(await testIDExists('setup-error')).toBe(false)
  // The plain build has no encryption, so no status
  expect(await testIDExists('encryption-status')).toBe(false)
  await waitForText('After decryption')
  await waitForText('After encryption')
  await waitForText('Upgrade marker')
})
