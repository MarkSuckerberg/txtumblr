import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import { defineConfig, globalIgnores, includeIgnoreFile } from 'eslint/config';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	globalIgnores(['worker-configuration.d.ts'], 'ignore-worker-types'),
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	ts.configs.recommendedTypeChecked,
	prettier,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
			},
		},
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off',
			'@typescript-eslint/no-unused-vars': 'warn',
			'@typescript-eslint/no-floating-promises': 'error',
		},
	},
	{
		// Override or add rule settings here, such as:
		// 'svelte/button-has-type': 'error'
		rules: {},
	}
);
