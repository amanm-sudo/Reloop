import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Flat config on ESLint 10.
 *
 * `eslint-config-next` is deliberately not used: it bundles an eslint-plugin-react build that
 * still calls the pre-10 rule context API, which crashes the whole run. Composing
 * @next/eslint-plugin-next + eslint-plugin-react-hooks + typescript-eslint directly keeps every
 * rule we actually rely on and stays on a supported ESLint.
 */
export default tseslint.config(
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'coverage/**'],
  },
  nextPlugin.configs['core-web-vitals'],
  reactHooks.configs.flat.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Conventions: no `any`, no non-null assertions outside tests.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    /**
     * Architectural invariant, enforced by the linter rather than by prompt instruction:
     * agents coordinate through the Match blackboard and the AgentEvent log, never by
     * importing one another. See .kiro/steering/agent-architecture.md.
     */
    files: ['src/agents/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/agents/perception/*',
                '@/agents/prediction/*',
                '@/agents/negotiation/*',
                '@/agents/logistics/*',
                '@/agents/impact/*',
                '@/agents/partner/*',
              ],
              message:
                'Agents must not import each other. Coordinate through the Match blackboard and the AgentEvent log (see .kiro/steering/agent-architecture.md).',
            },
          ],
        },
      ],
    },
  },
  {
    // The orchestrator and the registry are the two places that legitimately know all agents.
    files: ['src/agents/orchestrator/**/*.ts', 'src/agents/registry.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['tests/**/*.ts', 'src/scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  }
);
