/**
 * Source-integrity gate. Runs inside `npm run check`.
 *
 * This is the mechanism behind the project's central data claim: no number reaches a user
 * without a citation. It fails the build when
 *   - a reference table is malformed or a row is missing its source note,
 *   - a canonical category has no row in either table,
 *   - a table references a category that is not canonical.
 *
 * It warns, without failing, on shelf-life rows still marked `verified: false` — the FSIS feed
 * blocks automated download, so those rows are a known, documented gap (see data/README.md).
 * Printing the count on every run is what keeps the gap visible instead of permanent.
 */

import { ITEM_CATEGORIES, type ItemCategory } from '@/lib/domain';
import { impactTable, shelfLifeTable } from '@/lib/reference-data';

type Problem = { severity: 'error' | 'warn'; message: string };

function check(): Problem[] {
  const problems: Problem[] = [];
  const canonical = new Set<string>(ITEM_CATEGORIES);

  // Zod parsing happens inside these calls and throws on malformed rows.
  const shelfLife = shelfLifeTable();
  const impact = impactTable();

  const shelfCategories = shelfLife.entries.map((e) => e.category);
  const impactCategories = impact.factors.map((f) => f.category);

  for (const category of ITEM_CATEGORIES) {
    if (!shelfCategories.includes(category)) {
      problems.push({
        severity: 'error',
        message: `shelf-life.json is missing category "${category}"`,
      });
    }
    if (!impactCategories.includes(category)) {
      problems.push({
        severity: 'error',
        message: `impact-factors.json is missing category "${category}"`,
      });
    }
  }

  for (const [table, categories] of [
    ['shelf-life.json', shelfCategories],
    ['impact-factors.json', impactCategories],
  ] as const) {
    const seen = new Set<string>();
    for (const category of categories) {
      if (!canonical.has(category)) {
        problems.push({
          severity: 'error',
          message: `${table} references unknown category "${category}"`,
        });
      }
      if (seen.has(category)) {
        problems.push({
          severity: 'error',
          message: `${table} has a duplicate row for "${category}"`,
        });
      }
      seen.add(category);
    }
  }

  // A quantified row must be traceable to a named published group.
  for (const factor of impact.factors) {
    if (!factor.notQuantified && !factor.commodityGroup) {
      problems.push({
        severity: 'error',
        message: `impact-factors.json "${factor.category}" is quantified but names no commodity group`,
      });
    }
  }

  const unverified = shelfLife.entries.filter((e) => !e.verified).map((e) => e.category);
  if (unverified.length > 0) {
    problems.push({
      severity: 'warn',
      message:
        `${unverified.length}/${shelfLife.entries.length} shelf-life rows are still ` +
        `verified:false and need a manual FoodKeeper pass (see data/README.md):\n    ` +
        unverified.join(', '),
    });
  }

  const unverifiedFactors = impact.factors
    .filter((f) => !f.verified)
    .map((f: { category: ItemCategory }) => f.category);
  if (unverifiedFactors.length > 0) {
    problems.push({
      severity: 'error',
      message: `impact-factors.json rows are unverified: ${unverifiedFactors.join(', ')}`,
    });
  }

  return problems;
}

function main(): void {
  let problems: Problem[];
  try {
    problems = check();
  } catch (cause) {
    console.error('✗ reference data failed to load\n');
    console.error(cause instanceof Error ? cause.message : cause);
    process.exit(1);
  }

  const errors = problems.filter((p) => p.severity === 'error');
  const warnings = problems.filter((p) => p.severity === 'warn');

  for (const w of warnings) console.warn(`  ! ${w.message}`);
  for (const e of errors) console.error(`  ✗ ${e.message}`);

  if (errors.length > 0) {
    console.error(`\n✗ source integrity check failed with ${errors.length} error(s).`);
    process.exit(1);
  }

  const shelfCount = shelfLifeTable().entries.length;
  const factorCount = impactTable().factors.length;
  console.log(
    `✓ source integrity: ${shelfCount} shelf-life rows, ${factorCount} impact rows, ` +
      `${ITEM_CATEGORIES.length} categories all covered and cited` +
      (warnings.length > 0 ? ` (${warnings.length} warning(s))` : '')
  );
}

main();
