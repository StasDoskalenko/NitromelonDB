const path = require('path');

// The published/library `react-native.config.js` still points at the old
// UWP Paper native project (`native/windows`). That vcxproj cannot autolink
// into this WinAppSDK New Architecture app. Keep Windows unlinked here until
// the New Arch SQLite module ships.
module.exports = {
  project: {
    windows: {
      sourceDir: 'windows',
      solutionFile: 'NitromelonWindows.sln',
      project: {
        projectFile: 'NitromelonWindows\\NitromelonWindows.vcxproj',
      },
    },
  },
  dependencies: {
    nitromelondb: {
      root: path.resolve(__dirname, '../..'),
      platforms: {
        windows: null,
      },
    },
    'react-native-nitro-modules': {
      platforms: {
        windows: null,
      },
    },
  },
};
