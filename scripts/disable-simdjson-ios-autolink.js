#!/usr/bin/env node
/**
 * @nozbe/simdjson ships a podspec, so Expo/RN may autolink it as a second iOS
 * target. NitromelonDB already compiles those sources into its own pod — skip
 * simdjson's iOS autolink to avoid duplicate symbols.
 */
const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const CONTENTS = `module.exports = {
  dependency: {
    platforms: {
      ios: null,
    },
  },
}
`

try {
  const pkg = createRequire(__filename).resolve('@nozbe/simdjson/package.json')
  const dest = path.join(path.dirname(pkg), 'react-native.config.js')
  if (!fs.existsSync(dest) || fs.readFileSync(dest, 'utf8') !== CONTENTS) {
    fs.writeFileSync(dest, CONTENTS)
  }
} catch {
  // Not installed (web-only) or the store is read-only (some pnpm layouts).
}
