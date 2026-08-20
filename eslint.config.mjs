import { defineConfig, globalIgnores } from 'eslint/config';
import eslintConfigSalesforceTypescript from 'eslint-config-salesforce-typescript';
import sfPlugin from 'eslint-plugin-sf-plugin';

export default defineConfig([
  ...eslintConfigSalesforceTypescript,
  ...sfPlugin.configs.recommended,
  {
    rules: {
      'header/header': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      '@typescript-eslint/prefer-optional-chain': 'off',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['src/**'],
              message: "imports from this repo's src folder should be a relative path",
            },
            {
              group: ['lib/**'],
              message: 'import from /src not from /lib. /lib is a build artifact',
            },
          ],
        },
      ],
    },
  },
  globalIgnores(['**/*.d.ts', 'lib/**/*', 'node_modules/**/*']),
  {
    files: ['**/test/**/*.ts', '**/test/**/*.nut.ts'],
    rules: {
      camelcase: 'off',
      'header/header': 'off',
      'no-throw-literal': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/prefer-optional-chain': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'header/header': 'off',
    },
  },
]);