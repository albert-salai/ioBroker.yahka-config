// ioBroker eslint configuration with strict type-checked typescript-eslint rules
import config from '@iobroker/eslint-config';
import tseslint from 'typescript-eslint';

export default [
	...config,
	{
		// specify files to exclude from linting here
		ignores: [
			'.dev-server/',
			'.vscode/',
			'*.test.js',
			'test/**/*.js',
			'*.config.mjs',
			'build',
			'dist',
			'admin/words.js',
			'admin/admin.d.ts',
			'admin/blockly.js',
			'**/adapter-config.d.ts',
			'admin/index_m.js',
			'widgets/**/*.js'
		],
	},
	...tseslint.configs.strictTypeChecked,
	...tseslint.configs.stylisticTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			// its autofix inserts empty jsdoc blocks (jsdoc/no-blank-blocks)
			'jsdoc/require-jsdoc': 'off',
			'@typescript-eslint/no-unused-vars': ['error', {
				argsIgnorePattern: '^_',
				varsIgnorePattern: '^_',
				caughtErrors: 'none',
			}],
		},
	},
];
