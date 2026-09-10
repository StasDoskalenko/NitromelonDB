// Babel is deliberately pinned to the 7.x line. See .github/dependabot.yml for
// the full rationale: `fast-async` (module:fast-async) and the `babel-minify`
// plugins in babel.config.js are unmaintained and do not work on Babel 8, and
// Metro / React Native still run on `@babel/core@^7`. Revisit when Metro ships
// Babel 8 support.
//
// This keeps `ncu` from proposing `@babel/* -> 8.x` while still allowing 7.x
// minor/patch bumps for everything under the @babel scope.
module.exports = {
  target: (dependencyName) =>
    dependencyName.startsWith('@babel/') ? 'minor' : 'latest',
}
