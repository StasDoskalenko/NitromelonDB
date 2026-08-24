const {
  addNote,
  deleteNote,
  dismissKeyboard,
  pinNote,
  waitForPinned,
  waitForSeeded,
  waitForNoteCount,
  waitForText,
  waitForTextGone,
} = require('./helpers')

describe('add-pin-delete', () => {
  beforeAll(async () => {
    await waitForSeeded()
  })

  test('create, pin, and delete against the live database', async () => {
    await addNote('Test Note')
    await waitForText('Test Note')
    await waitForNoteCount(101)

    await dismissKeyboard()
    await pinNote('Test Note')
    await waitForPinned('Test Note')

    await deleteNote('Test Note')
    await waitForTextGone('Test Note')
    await waitForNoteCount(100)
  })
})
