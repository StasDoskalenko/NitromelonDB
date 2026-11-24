// Step 5 (plain build, installed over the encrypted database): it can't open it, and says why,
// instead of resetting it. The script checks the file is unchanged. Mirrors
// ../../NotesApp/maestro-encryption/5-plain-refuses.yaml.
const {waitForTestIDText} = require('../e2e/helpers')

test('plain build: refuses the encrypted database', async () => {
  await waitForTestIDText(
    'setup-error',
    text => text.includes('encryption_key_required'),
    60000,
  )
})
