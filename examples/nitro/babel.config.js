const path = require('path')

module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        require.resolve('@babel/plugin-proposal-decorators', {
          paths: [path.resolve(__dirname, '../..')],
        }),
        { legacy: true },
      ],
    ],
  }
}
