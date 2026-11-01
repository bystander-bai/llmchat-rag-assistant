module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'plugin:react-hooks/recommended'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  ignorePatterns: ['dist', 'node_modules', '*.config.ts'],
  rules: {
    'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
  },
}
