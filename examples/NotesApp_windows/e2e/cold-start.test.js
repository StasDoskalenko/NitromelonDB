const {waitForSeeded, waitForTestID, waitForText} = require('./helpers')

describe('cold-start', () => {
  beforeAll(async () => {
    await waitForSeeded()
  })

  test('fresh install seeds 100 notes and shows the list', async () => {
    await waitForTestID('subtitle')
    await waitForText('NitromelonDB')
    await waitForTestID('notes-list')
    await waitForTestID('composer')
    await waitForTestID('title-input')
    await waitForTestID('add-note-button')
    await waitForText('Note #100')
  })
})
