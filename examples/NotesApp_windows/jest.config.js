const path = require('path');

module.exports = {
  preset: 'react-native',
  haste: {
    defaultPlatform: 'windows',
    platforms: ['windows', 'native'],
  },
  modulePaths: [path.resolve(__dirname, 'node_modules')],
  moduleNameMapper: {
    '^nitromelondb$': path.resolve(__dirname, '../../src/index.ts'),
    '^nitromelondb/(.*)$': path.resolve(__dirname, '../../src/$1'),
  },
};
