// Step 7 (encryption build, encrypted database): decrypts it with database.unsafe_DecryptDB(), which
// copies it to a plain file and replaces the database with it (MoveFileExW on Windows), then writes
// to it. Mirrors ../../NotesApp/maestro-encryption/7-decrypt.yaml.
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

test('encryption build: decrypts', async () => {
  await waitForTestID('encryption-status', 60000)
  // Not on a retry after it was already decrypted
  if (await testIDExists('decrypt-button')) {
    await tapTestID('decrypt-button')
  }
  await waitForTestIDText('encryption-status', text => text === 'Not encrypted', 60000)
  expect(await testIDExists('decrypt-button')).toBe(false)
  await waitForTestID('encrypt-button')
  await waitForText('Upgrade marker')
  await waitForText('After encryption')
  if (!(await textVisible('After decryption'))) {
    await addNote('After decryption')
  }
  await waitForNoteCount(103)
})
