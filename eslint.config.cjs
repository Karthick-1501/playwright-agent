module.exports = [
  {
    ignores: [
      'node_modules/**',
      '.agent/**',
      '.git/**',
      '.github/**',
      '.vscode/**',
      'playwright-report/**',
      'test-results/**',
      '.docs/**',
      'dist/**'
    ]
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script'
    },
    linterOptions: {
      reportUnusedDisableDirectives: true
    },
    rules: {
      'no-console': 'off',
      'prefer-const': 'warn',
      'no-unused-vars': ['warn', { 'argsIgnorePattern': '^_' }]
    }
  }
];
