const path = require('path');
const { windowsAppDependencies } = require('../../windows-autolink');

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
  dependencies: windowsAppDependencies({
    root: path.resolve(__dirname, '../..'),
  }),
};
