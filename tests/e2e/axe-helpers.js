import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';

function summarizeViolations(violations) {
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .map((node) => `  - ${node.target.join(' ')}`)
        .join('\n');
      return `${violation.id} (${violation.impact})\n${violation.help}\n${nodes}`;
    })
    .join('\n\n');
}

/**
 * Runs axe-core against the page and fails on serious/critical violations.
 * @param {import('@playwright/test').Page} page
 */
export async function expectNoSeriousA11yViolations(page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  const blockingViolations = results.violations.filter((violation) =>
    ['serious', 'critical'].includes(violation.impact ?? '')
  );

  const nonBlockingViolations = results.violations.filter(
    (violation) => !['serious', 'critical'].includes(violation.impact ?? '')
  );

  if (nonBlockingViolations.length) {
    console.warn(
      'Non-blocking axe findings (informational):\n',
      summarizeViolations(nonBlockingViolations)
    );
  }

  expect(blockingViolations, summarizeViolations(blockingViolations)).toHaveLength(0);
}
