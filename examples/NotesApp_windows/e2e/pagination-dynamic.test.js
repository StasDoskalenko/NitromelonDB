const {
  addNote,
  dismissKeyboard,
  waitForSeeded,
  tapTestID,
  waitForNoteCount,
  waitForText,
  waitForTextGone,
} = require('./helpers')

describe('pagination-dynamic', () => {
  beforeAll(async () => {
    await waitForSeeded()
  })

  test('adding notes updates count and page windows', async () => {
    await waitForText('Page 1 of 5')

    await addNote('Dynamic Note 1')
    await addNote('Dynamic Note 2')
    await addNote('Dynamic Note 3')
    await addNote('Dynamic Note 4')
    await addNote('Dynamic Note 5')
    await dismissKeyboard()

    await waitForNoteCount(105)
    await waitForText('Page 1 of 6')
    await waitForText('Dynamic Note 5')
    await waitForText('Note #100')
    await waitForTextGone('Note #80')

    await tapTestID('next-page-button')
    await waitForText('Page 2 of 6')
    await waitForNoteCount(105)
    await waitForTextGone('Dynamic Note 5')
    await waitForTextGone('Note #100')
    await waitForText('Note #85')

    await tapTestID('prev-page-button')
    await waitForText('Page 1 of 6')
    await waitForText('Dynamic Note 5')
  })
})
