// Step 2 (encryption build, installed over step 1): opens the plain database with
// ifUnencrypted: 'open', keeping every note. Mirrors
// ../../NotesApp/maestro-encryption/2-opens-unencrypted.yaml.
const {waitForNoteCount, waitForTestID, waitForTestIDText, waitForText} = require('../e2e/helpers')

test('encryption build: opens the plain database', async () => {
  await waitForTestIDText('encryption-status', text => text === 'Not encrypted', 60000)
  await waitForNoteCount(101)
  await waitForText('Upgrade marker')
  await waitForTestID('encrypt-button')
})
