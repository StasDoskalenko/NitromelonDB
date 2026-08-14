module.exports = {
  dependencies: {
    '@nozbe/simdjson': {
      platforms: {
        // Compiled into NitromelonDB.podspec; skip a second simdjson iOS target.
        ios: null,
      },
    },
  },
}
