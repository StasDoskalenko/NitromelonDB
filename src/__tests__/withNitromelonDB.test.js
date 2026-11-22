// The library root has no Expo install; the plugin only needs these two helpers.
jest.mock(
  '@expo/config-plugins',
  () => ({
    createRunOncePlugin: (plugin) => plugin,
    withXcodeProject: (config, action) => ({ ...config, xcodeProjectMod: action }),
  }),
  { virtual: true },
)

const withNitromelonDB = require('../../plugin/withNitromelonDB')

describe('withNitromelonDB', () => {
  it('returns the config unchanged by default', () => {
    const config = { name: 'app' }
    expect(withNitromelonDB(config)).toBe(config)
  })

  it('refuses the New Architecture being off', () => {
    expect(() => withNitromelonDB({ newArchEnabled: false })).toThrow(/New Architecture/)
  })

  it('points `encryption` to package.json instead of ignoring it', () => {
    for (const encryption of [true, false]) {
      expect(() => withNitromelonDB({ name: 'app' }, { encryption })).toThrow(
        /"nitromelondb": \{ "encryption": true \}.*package\.json/,
      )
    }
  })

  it('still supports excludeSimArch', () => {
    expect(withNitromelonDB({ name: 'app' }, { excludeSimArch: true }).xcodeProjectMod).toEqual(
      expect.any(Function),
    )
  })
})
