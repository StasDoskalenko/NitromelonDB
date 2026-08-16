const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const fs = require('fs');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const rnwPath = fs.realpathSync(
  path.resolve(require.resolve('react-native-windows/package.json'), '..'),
);

function resolveDep(name) {
  const local = path.resolve(projectRoot, 'node_modules', name);
  const workspace = path.resolve(workspaceRoot, 'node_modules', name);
  if (fs.existsSync(local)) {
    return local;
  }
  if (fs.existsSync(workspace)) {
    return workspace;
  }
  return local;
}

// JS deps of nitromelondb. Metro only indexes projectRoot + watchFolders,
// so src/ imports of rxjs fail unless those packages are watched too.
const libraryDeps = [
  'rxjs',
  'sql-escape-string',
  'hoist-non-react-statics',
  '@babel/runtime',
];

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  watchFolders: [
    path.join(workspaceRoot, 'src'),
    ...libraryDeps.map(resolveDep).filter(dir => fs.existsSync(dir)),
  ],
  resolver: {
    blockList: [
      // This stops "npx @react-native-community/cli run-windows" from causing the metro server to crash if its already running
      new RegExp(
        `${path.resolve(__dirname, 'windows').replace(/[/\\]/g, '/')}.*`,
      ),
      // This prevents "npx @react-native-community/cli run-windows" from hitting: EBUSY: resource busy or locked, open msbuild.ProjectImports.zip or other files produced by msbuild
      new RegExp(`${rnwPath}/build/.*`),
      new RegExp(`${rnwPath}/target/.*`),
      /.*\.ProjectImports\.zip/,
    ],
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    extraNodeModules: {
      nitromelondb: path.join(workspaceRoot, 'src'),
      react: path.resolve(projectRoot, 'node_modules/react'),
      'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
      'react-native-windows': rnwPath,
      'react-native-nitro-modules': path.resolve(
        projectRoot,
        'node_modules/react-native-nitro-modules',
      ),
      ...Object.fromEntries(libraryDeps.map(name => [name, resolveDep(name)])),
    },
  },
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
