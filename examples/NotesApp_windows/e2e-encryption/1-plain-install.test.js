// Step 1 (plain build): a fresh install with one note of its own. Mirrors
// ../../NotesApp/maestro-encryption/1-plain-install.yaml; see README.md.
const {addNote, testIDExists, waitForNoteCount, waitForSeeded} = require('../e2e/helpers')

test('plain build: fresh install, adds "Upgrade marker"', async () => {
  await waitForSeeded()
  // The plain build has no encryption, so no status
  expect(await testIDExists('encryption-status')).toBe(false)
  await addNote('Upgrade marker')
  await waitForNoteCount(101)
})
