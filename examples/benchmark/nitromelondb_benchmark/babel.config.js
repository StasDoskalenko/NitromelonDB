module.exports = function (api) {
  api.cache(true)
  return {
    // Standard (TC39 2023-11) decorators: models declare fields with `accessor`.
    // See docs/Advanced/StandardDecorators.
    presets: [['babel-preset-expo', { decorators: { version: '2023-11' } }]],
  }
}
