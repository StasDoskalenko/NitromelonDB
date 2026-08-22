const {
  addNote,
  deleteNote,
  dismissKeyboard,
  pinNote,
  waitForPinned,
  waitForSeeded,
  waitForNoteCount,
  waitForTestID,
  waitForText,
  waitForTextGone,
} = require('./helpers')

describe('interaction-burst', () => {
  beforeAll(async () => {
    await waitForSeeded()
  })

  test('rapid add / pin / delete', async () => {
    await addNote('Burst Note 1')
    await addNote('Burst Note 2')
    await addNote('Burst Note 3')

    await waitForText('Burst Note 1')
    await waitForText('Burst Note 2')
    await waitForText('Burst Note 3')
    await waitForNoteCount(103)

    await dismissKeyboard()
    await pinNote('Burst Note 3')
    await waitForPinned('Burst Note 3')
    await pinNote('Burst Note 2')
    await pinNote('Burst Note 1')

    await deleteNote('Burst Note 3')
    await waitForTextGone('Burst Note 3')
    await waitForNoteCount(102)
    await waitForTestID('notes-list')
  })
})
