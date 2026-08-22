const {
  waitForSeeded,
  scrollUntilText,
  tapTestID,
  waitForTestID,
  waitForText,
  waitForTextGone,
} = require('./helpers')

describe('pagination-seed', () => {
  beforeAll(async () => {
    await waitForSeeded()
  })

  test('sticky pager windows with Q.skip + Q.take(20)', async () => {
    await waitForTestID('page-label')
    await waitForText('Page 1 of 5')
    await waitForText('Note #100')
    await waitForTextGone('Note #80')

    await waitForTestID('next-page-button')
    await tapTestID('next-page-button')
    await waitForText('Page 2 of 5')
    await waitForText('Note #80')
    await waitForTextGone('Note #100')

    await tapTestID('next-page-button')
    await waitForText('Page 3 of 5')
    await waitForText('Note #60')

    await tapTestID('next-page-button')
    await waitForText('Page 4 of 5')
    await waitForText('Note #40')

    await tapTestID('next-page-button')
    await waitForText('Page 5 of 5')
    await waitForText('Note #20')
    await waitForTextGone('Note #21')

    await scrollUntilText('Note #1')
    await waitForText('Note #1')

    await tapTestID('prev-page-button')
    await waitForText('Page 4 of 5')
    await waitForText('Note #40')
  })
})
