const {
  addNote,
  dismissKeyboard,
  killAndRelaunch,
  waitForSeeded,
  waitForNoteCount,
  waitForTestID,
  waitForText,
} = require('./helpers')

describe('kill-and-relaunch', () => {
  test('data survives process death', async () => {
    await waitForSeeded()

    await addNote('Persistent Note')
    await dismissKeyboard()
    await waitForText('Persistent Note')
    await waitForNoteCount(101)

    await killAndRelaunch()

    await waitForTestID('subtitle')
    await waitForText('Persistent Note')
    await waitForNoteCount(101)
    await waitForTestID('notes-list')
  })
})
