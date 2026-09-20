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
/** Must stay in step with AGENT_IDS in src/lib/domain.ts. */
const AGENTS = ['perception', 'prediction', 'negotiation', 'logistics', 'impact', 'partner'];

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
  /**
   * Architectural invariant, enforced by the linter rather than by prompt instruction: agents
   * coordinate through the Match blackboard and the AgentEvent log, never by importing one
   * another. See .kiro/steering/agent-architecture.md.
   *
   * One block per agent, each forbidding only the *other* agents — an agent importing its own
   * prompt, schema or policy module is normal and must stay allowed.
   */
  ...AGENTS.map((self) => ({
    files: [`src/agents/${self}/**/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: AGENTS.filter((other) => other !== self).map((other) => `@/agents/${other}/*`),
              message:
                'Agents must not import each other. Coordinate through the Match blackboard and the AgentEvent log (see .kiro/steering/agent-architecture.md).',
            },
          ],
        },
      ],
    },
  })),
  {
    // The orchestrator and the registry are the two places that legitimately know all agents.
    files: ['src/agents/orchestrator/**/*.ts', 'src/agents/registry.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // Scripts talk to a developer through stdout; that is their interface, not a stray debug line.
    files: ['tests/**/*.ts', 'src/scripts/**/*.ts', 'scripts/**/*.mjs'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
  {
    /*
     * `react-hooks/purity` cannot distinguish a React Server Component from a client one, and it
     * flags reading the clock during render. Every page and layout in this project is a server
     * component (none carries 'use client'), where reading the current time per request is exactly
     * correct — the pages that do it are also marked `dynamic = 'force-dynamic'`.
     *
     * The rule stays on everywhere under src/components, which is where the hydration hazard it
     * exists to catch actually lives.
     */
    files: ['src/app/**/page.tsx', 'src/app/**/layout.tsx'],
    rules: { 'react-hooks/purity': 'off' },
  }
);
