import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

export async function runA11yAudit(page, options = {}) {
  const { include, exclude, tags } = options;

  let builder = new AxeBuilder({ page });

  if (Array.isArray(include) && include.length) {
    include.forEach((selector) => {
      builder = builder.include(selector);
    });
  } else {
    builder = builder.include(['html']);
  }

  if (Array.isArray(exclude) && exclude.length) {
    exclude.forEach((selector) => {
      builder = builder.exclude(selector);
    });
  }

  if (Array.isArray(tags) && tags.length) {
    builder = builder.withTags(tags);
  }

  return builder.analyze();
}

export function getCriticalViolations(results) {
  return results.violations.filter((violation) => violation.impact === 'critical');
}

export async function expectNoCriticalA11yViolations(page, options = {}) {
  const results = await runA11yAudit(page, options);
  const criticalViolations = getCriticalViolations(results);

  try {
    await test.info().attach('axe-results.json', {
      contentType: 'application/json',
      body: JSON.stringify(results, null, 2),
    });
  } catch (error) {
    console.warn('Unable to attach axe results to test info', error);
  }

  expect(
    criticalViolations,
    `Expected no critical accessibility violations (found ${criticalViolations.length}): ${criticalViolations
      .map((violation) => violation.id)
      .join(', ')}`,
  ).toEqual([]);
}
