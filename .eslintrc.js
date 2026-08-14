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
  ignorePatterns: ['examples/typescript/**/*.ts', 'examples/nitro/**', 'nitrogen/**', 'node_modules/**'],
  settings: {
    flowtype: {
      onlyFilesWithFlowAnnotation: true,
    },
    'import/ignore': ['node_modules/react-native'],
    'import/parsers': {
      '@typescript-eslint/parser': ['.ts', '.tsx'],
      '@babel/eslint-parser': ['.js', '.jsx'],
    },
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
        'no-dupe-class-members': 'off',
        'no-undef': 'off',
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-redeclare': 'error',
        '@typescript-eslint/no-dupe-class-members': 'error',
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
        ],
        '@typescript-eslint/no-non-null-assertion': 'error',
        '@typescript-eslint/ban-ts-comment': [
          'error',
          {
            'ts-expect-error': 'allow-with-description',
            'ts-ignore': true,
            'ts-nocheck': true,
            'ts-check': false,
          },
        ],
        '@typescript-eslint/no-wrapper-object-types': 'error',
        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
          },
        ],
      },
    },
    {
      files: ['src/utils/rx/__wmelonRxShimESM2015/**'],
      rules: {
        '@typescript-eslint/ban-ts-comment': 'off',
      },
    },
  ],
}

module.exports = config
