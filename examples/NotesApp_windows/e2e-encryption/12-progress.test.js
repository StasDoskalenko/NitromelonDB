// Step 12 (encryption build, encrypted database): progress. Adds about 135 MB of filler notes, then
// decrypts and encrypts the database; after each, `encryption-progress` says what
// encryption.events.onProgress reported: at least one update, between 0 and 1, never going back.
// Mirrors ../../NotesApp/maestro-encryption/12-progress.yaml.
const {
  noteCountBelow,
  tapTestID,
  testIDExists,
  waitForTestID,
  waitForTestIDText,
} = require('../e2e/helpers')

const PROGRESS = operation =>
  new RegExp(`^${operation}: [1-9][0-9]* progress updates?, only forward, [0-9]+ ms$`)

test('encryption build: decrypting and encrypting report progress', async () => {
  await waitForTestID('encryption-status', 60000)
  // On a retry that stopped after decrypting: encrypted again first
  if (await testIDExists('encrypt-button')) {
    await tapTestID('encrypt-button')
    await waitForTestIDText('encryption-status', text => text === 'Encrypted', 180000)
  }

  // Not on a retry after the filler was added
  if (await noteCountBelow(1000)) {
    await tapTestID('fill-button')
    await waitForTestIDText('fill-status', text => /^Added \d+ notes$/.test(text), 180000)
  }

  await tapTestID('decrypt-button')
  await waitForTestIDText('encryption-status', text => text === 'Not encrypted', 180000)
  await waitForTestIDText('encryption-progress', text => PROGRESS('decrypt').test(text))

  await tapTestID('encrypt-button')
  await waitForTestIDText('encryption-status', text => text === 'Encrypted', 180000)
  await waitForTestIDText('encryption-progress', text => PROGRESS('encrypt').test(text))
})
