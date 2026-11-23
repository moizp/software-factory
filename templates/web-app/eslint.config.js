import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	prettier,
	...svelte.configs['flat/prettier'],
	{ languageOptions: { globals: { ...globals.browser, ...globals.node } } },
	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: { parserOptions: { parser: ts.parser } }
	},
	{
		// Shared code is plain TypeScript: the core imports only other core files. A package from outside the project
		// is written in-house, or named here with the reason (and approved in the plan's new_dependencies).
		files: ['src/lib/core/**'],
		ignores: ['**/*.test.ts', '**/*.spec.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							regex: '^(?!\\.{1,2}/|\\$lib/core/).+',
							message:
								'The core imports no framework and no outside package: write it in-house, or move this file out of src/lib/core.'
						}
					]
				}
			]
		}
	},
	{ files: ['**/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
	{ ignores: ['build/', '.svelte-kit/', 'dist/', 'coverage/', 'node_modules/'] }
);
