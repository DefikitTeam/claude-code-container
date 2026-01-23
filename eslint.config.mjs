import globals from 'globals';
import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      "**/dist/",
      "**/node_modules/",
      "**/.wrangler/",
      "**/.acp-sessions/",
      ".dev.vars",
      "worker-configuration.d.ts",
      "**/coverage/"
    ]
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    languageOptions: { globals: {...globals.browser, ...globals.node} },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^", "varsIgnorePattern": "^", "caughtErrorsIgnorePattern": "^" }],
      "@typescript-eslint/no-empty-object-type": "off",
      "no-useless-escape": "off",
      "no-empty": "off",
      "prefer-const": "off",
      "no-self-assign": "off",
      "no-useless-catch": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-extraneous-class": "off"
    }
  }
];
