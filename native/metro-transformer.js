const { transformFromAstSync } = require('@babel/core')
const hermesParser = require('hermes-parser')
const babelConfig = require('../babel.config')
const rnPreset = require('@react-native/babel-preset')

const isNodeModule = (filename) => {
  const normalized = filename.replace(/\\/g, '/')
  return normalized.includes('/node_modules/') || normalized.startsWith('node_modules/')
}

const transform = ({ src, filename, options }) => {
  // React Native 0.87 ships TypeScript-in-JS and Flow class fields that our
  // project Babel config (Flow parser + loose class transform) cannot handle.
  // Bundle node_modules with RN's preset and Hermes parser, and do not load
  // the repo babel.config.js.
  if (isNodeModule(filename)) {
    const config = {
      filename,
      babelrc: false,
      configFile: false,
      sourceType: 'unambiguous',
      ast: true,
      cloneInputAst: false,
      cwd: options && options.projectRoot,
      presets: [
        [
          rnPreset,
          {
            projectRoot: options && options.projectRoot,
            disableImportExportTransform: options && options.experimentalImportSupport,
            enableBabelRuntime: options && options.enableBabelRuntime,
          },
        ],
      ],
      caller: {
        name: 'metro',
        bundler: 'metro',
        platform: options && options.platform,
        unstable_transformProfile: options && options.unstable_transformProfile,
      },
    }

    const sourceAst = hermesParser.parse(src, {
      babel: true,
      reactRuntimeTarget: '19',
      sourceType: 'unambiguous',
    })

    const result = transformFromAstSync(sourceAst, src, config)
    if (!result) {
      return { ast: null }
    }
    return { ast: result.ast, metadata: result.metadata }
  }

  const { ast, code, map } = require('@babel/core').transform(src, {
    filename,
    sourceFileName: filename,
    babelrc: false,
    configFile: false,
    ast: true,
    ...babelConfig.env.test,
  })

  return {
    ast,
    code,
    map,
    filename,
  }
}

module.exports = {
  transform,
}
