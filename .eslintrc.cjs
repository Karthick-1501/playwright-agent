module.exports = {
  root: true,
  env: {
    node: true,
    es2021: true,
  },
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'script'
  },
  extends: [
    'eslint:recommended'
  ],
  rules: {
    // allow console during development
    'no-console': 'off',
    // prefer const where possible
    'prefer-const': 'warn'
  }
};
