const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { resolve } = require('metro-resolver');

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

// Library JS plus packages the Cavy integration bundle pulls in from src/.
const libraryDeps = [
  'rxjs',
  'sql-escape-string',
  'hoist-non-react-statics',
  '@babel/runtime',
  'cavy',
  '@nozbe/watermelondb_expect',
  'rambdax',
  'big-list-of-naughty-strings',
];

function resolveLibrarySource(moduleName) {
  const rest =
    moduleName === 'nitromelondb' ? 'index' : moduleName.slice('nitromelondb/'.length);
  const librarySrc = path.join(workspaceRoot, 'src');
  const candidates = [
    path.join(librarySrc, `${rest}.ts`),
    path.join(librarySrc, `${rest}.tsx`),
    path.join(librarySrc, `${rest}.js`),
    path.join(librarySrc, rest, 'index.ts'),
    path.join(librarySrc, rest, 'index.js'),
  ];
  return candidates.find(candidate => fs.existsSync(candidate));
}

function resolveDefault(context, moduleName, platform) {
  let name = moduleName;
  // Same redirect the RN CLI installs — our resolveRequest would otherwise
  // replace it, and `react-native` has no Platform.windows.js.
  if (platform === 'windows') {
    if (name === 'react-native') {
      name = 'react-native-windows';
    } else if (name.startsWith('react-native/')) {
      name = `react-native-windows/${name.slice('react-native/'.length)}`;
    }
  }
  return resolve({ ...context, resolveRequest: undefined }, name, platform);
}

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
      'react-native-windows': rnwPath,
      'react-native-nitro-modules': path.resolve(
        projectRoot,
        'node_modules/react-native-nitro-modules',
      ),
      ...Object.fromEntries(libraryDeps.map(name => [name, resolveDep(name)])),
    },
    // Yarn's file: link is found first, so extraNodeModules never runs.
    // Point App.tsx at workspace src/ (there is no published index.js).
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName === 'nitromelondb' || moduleName.startsWith('nitromelondb/')) {
        const filePath = resolveLibrarySource(moduleName);
        if (filePath) {
          return { type: 'sourceFile', filePath };
        }
      }
      return resolveDefault(context, moduleName, platform);
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
