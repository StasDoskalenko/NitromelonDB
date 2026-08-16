import anymatch from 'anymatch'

export const DO_NOT_BUILD_PATHS = [
  /__tests__/,
  /__typetests__/,
  /__playground__/,
  /test\.js/,
  /test\.ts/,
  /test\.tsx/,
  /integrationTest/,
  /__mocks__/,
  /\.DS_Store/,
  /package\.json/,
]

export function isSourceFile(value) {
  // `.tsx` does not end with `.ts` — omitting it drops DatabaseProvider / withDatabase from npm.
  return (
    (value.endsWith('.js') || value.endsWith('.ts') || value.endsWith('.tsx')) &&
    !value.endsWith('.d.ts') &&
    !anymatch(DO_NOT_BUILD_PATHS, value)
  )
}
