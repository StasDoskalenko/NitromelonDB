const config = {
  env: {
    es6: true,
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
    'prettier',
    'plugin:jest/recommended',
  ],
  parser: '@babel/eslint-parser',
  ignorePatterns: ['examples/typescript/**/*.ts', 'examples/nitro/**', 'nitrogen/**', 'node_modules/**'],
  settings: {
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
      excludedFiles: [
        '*integrationTest.js',
        '*test.js',
        '**/__tests__/**',
        '*test.*.js',
        '**/__playground__/**',
        '*.integrationTests.native.js',
      ],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: 'Program',
            message:
              'Implementation files under src/ must be TypeScript (.ts/.tsx). JavaScript is only allowed in tests.',
          },
        ],
      },
    },
    {
      files: ['src/**/*.ts', 'src/**/*.tsx'],
      excludedFiles: ['**/*.d.ts'],
      parser: '@typescript-eslint/parser',
      extends: [
        'plugin:@typescript-eslint/eslint-recommended',
        'plugin:@typescript-eslint/recommended',
      ],
      rules: {
        '@typescript-eslint/no-explicit-any': 'error',
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
        '@typescript-eslint/no-require-imports': 'off',
        '@typescript-eslint/no-unused-expressions': [
          'error',
          { allowShortCircuit: true, allowTernary: true },
        ],
        '@typescript-eslint/no-this-alias': ['error', { allowedNames: ['model'] }],
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
