import eslint		from '@eslint/js';
import tseslint		from 'typescript-eslint';

export default [
	{
		ignores: [
			"build/",
			"test/",
			"admin/",
		]
	},
	eslint.configs.recommended,
	...tseslint.configs.strictTypeChecked,
	...tseslint.configs.stylisticTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				projectService:		true,
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				tsconfigRootDir:	import.meta.dirname,
			},
		},
		rules: {
			'@typescript-eslint/no-unused-vars': ['error', {
				argsIgnorePattern:	'^_',
				varsIgnorePattern:	'^_',
				caughtErrors:		'none',
			}],
		}
	}
];
