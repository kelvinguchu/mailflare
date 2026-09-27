import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

export default defineConfig([
	...nextVitals,
	...nextTypescript,
	{
		files: ["**/*.{ts,tsx,mts,cts}"],
		languageOptions: {
			parserOptions: {
				project: "./tsconfig.eslint.json",
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"jsx-a11y/anchor-has-content": "error",
			"jsx-a11y/aria-activedescendant-has-tabindex": "error",
			"jsx-a11y/click-events-have-key-events": "error",
			"jsx-a11y/control-has-associated-label": "error",
			"jsx-a11y/heading-has-content": "error",
			"jsx-a11y/html-has-lang": "error",
			"jsx-a11y/interactive-supports-focus": "error",
			"jsx-a11y/label-has-associated-control": "error",
			"jsx-a11y/no-access-key": "error",
			"jsx-a11y/no-autofocus": "error",
			"jsx-a11y/no-distracting-elements": "error",
			"jsx-a11y/no-static-element-interactions": "error",
			"jsx-a11y/tabindex-no-positive": "error",
			"@typescript-eslint/no-deprecated": "error",
			"@typescript-eslint/no-explicit-any": "error",
			"@typescript-eslint/no-floating-promises": "error",
			"@typescript-eslint/no-misused-promises": [
				"error",
				{
					checksVoidReturn: {
						attributes: false,
					},
				},
			],
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
					caughtErrorsIgnorePattern: "^_",
					destructuredArrayIgnorePattern: "^_",
					varsIgnorePattern: "^_",
				},
			],
			"react-hooks/set-state-in-effect": "off",
		},
	},
	{
		files: ["tests/**/*.ts"],
		rules: {
			"@typescript-eslint/no-floating-promises": "off",
		},
	},
	{
		files: ["scripts/**/*.mjs"],
		...tseslint.configs.disableTypeChecked,
	},
	globalIgnores([
		".next/**",
		".open-next/**",
		".wrangler/**",
		"out/**",
		"build/**",
		"next-env.d.ts",
		"cloudflare-env.d.ts",
	]),
]);
