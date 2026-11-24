// Step 3 (encryption build): encrypts the database in place with database.unsafe_EncryptDB(), then
// writes to it. Mirrors ../../NotesApp/maestro-encryption/3-encrypt.yaml.
const {
  addNote,
  tapTestID,
  testIDExists,
  textVisible,
  waitForNoteCount,
  waitForTestID,
  waitForTestIDText,
  waitForText,
} = require('../e2e/helpers')

test('encryption build: encrypts in place', async () => {
  await waitForTestID('encryption-status', 60000)
  // Not on a retry after it was already encrypted
  if (await testIDExists('encrypt-button')) {
    await tapTestID('encrypt-button')
  }
  await waitForTestIDText('encryption-status', text => text === 'Encrypted', 60000)
  expect(await testIDExists('encrypt-button')).toBe(false)
  await waitForText('Upgrade marker')
  if (!(await textVisible('After encryption'))) {
    await addNote('After encryption')
  }
  await waitForNoteCount(102)
})
