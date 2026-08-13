const config = {
  env: {
    es6: true,
    // configure globals
    jest: true,
    browser: true,
    commonjs: true,
    node: true,
  },
  plugins: ['import', '@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:flowtype/recommended',
    'prettier',
    'plugin:jest/recommended',
  ],
  parser: '@babel/eslint-parser',
  ignorePatterns: ['examples/typescript/**/*.ts', 'node_modules/**'],
  settings: {
    flowtype: {
      onlyFilesWithFlowAnnotation: true,
    },
    'import/ignore': ['node_modules/react-native'],
    react: {
      version: 'detect',
    },
  },
  rules: {
    'no-console': ['error'],
    'no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
      },
    ],
    'import/no-cycle': 'error',
    'jest/no-large-snapshots': 'warn',
    'jest/no-disabled-tests': 'off',
    'jest/expect-expect': 'off',
  },
  overrides: [
    {
      files: ['src/**/*.js'],
      excludedFiles: ['*integrationTest.js', '*test.js', '**/__tests__/**', '*test.*.js'],
      rules: {
        'flowtype/require-valid-file-annotation': ['error', 'always'],
      },
    },
    {
      files: ['src/**/*.ts', 'src/**/*.tsx', 'examples/typescript/*.ts'],
      excludedFiles: ['**/*.d.ts'],
      parser: '@typescript-eslint/parser',
      rules: {
        'flowtype/no-types-missing-file-annotation': 'off',
        'flowtype/require-valid-file-annotation': 'off',
        'no-unused-vars': 'off',
        'no-redeclare': 'off',
        'no-undef': 'off',
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-redeclare': 'error',
        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
          },
        ],
      },
    },
  ],
}

module.exports = config
