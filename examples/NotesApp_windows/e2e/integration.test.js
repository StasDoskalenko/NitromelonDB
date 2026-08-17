const {app} = require('@react-native-windows/automation')

describe('NitromelonDB Windows', () => {
  test('SQLite integration tests pass', async () => {
    const view = await app.findElementByTestID('WatermelonTesterStatus')

    await app.waitUntil(
      async () => {
        const statusText = await view.getText()
        console.log(statusText)
        return statusText.includes('Done') || statusText.includes('Error')
      },
      {timeout: 180000},
    )

    const statusText = await view.getText()
    expect(statusText).toMatch(/Done/)
  })
})
