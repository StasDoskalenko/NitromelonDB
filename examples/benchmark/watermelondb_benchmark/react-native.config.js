// Avoid a duplicate simdjson pod when WatermelonDB autolinks @nozbe/simdjson.
module.exports = {
  dependencies: {
    '@nozbe/simdjson': {
      platforms: {
        ios: null,
      },
    },
  },
}
