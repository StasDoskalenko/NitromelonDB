export default async function expectToRejectWithMessage(promise, message) {
  await expect(promise).rejects.toMatchObject({
    message: expect.stringMatching(message),
  })
}
