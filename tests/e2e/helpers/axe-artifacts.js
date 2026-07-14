import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from '@playwright/test';

const IMPACTS = ['critical', 'serious', 'moderate', 'minor', 'none'];

function safeSegment(value) {
  return String(value || 'axe-audit')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'axe-audit';
}

function impactKey(impact) {
  return IMPACTS.includes(impact) ? impact : 'none';
}

function summarizeAxeResults(results) {
  const violations = Array.isArray(results?.violations) ? results.violations : [];
  const incomplete = Array.isArray(results?.incomplete) ? results.incomplete : [];
  const passes = Array.isArray(results?.passes) ? results.passes : [];
  const inapplicable = Array.isArray(results?.inapplicable) ? results.inapplicable : [];
  const violationImpacts = Object.fromEntries(IMPACTS.map((impact) => [impact, 0]));
  let violationNodeCount = 0;

  for (const violation of violations) {
    violationImpacts[impactKey(violation.impact)] += 1;
    violationNodeCount += Array.isArray(violation.nodes) ? violation.nodes.length : 0;
  }

  return {
    violationCount: violations.length,
    violationNodeCount,
    violationImpacts,
    seriousOrCriticalViolationCount: violationImpacts.serious + violationImpacts.critical,
    incompleteCount: incomplete.length,
    passRuleCount: passes.length,
    inapplicableRuleCount: inapplicable.length,
  };
}

export async function writeAxeResultArtifact(results, options = {}) {
  const outputDir = process.env.AURA_A11Y_RESULTS_DIR;
  if (!outputDir) {
    return null;
  }

  let title = options.label || '';
  try {
    title ||= test.info().titlePath.join(' - ');
  } catch {
    title ||= 'axe-audit';
  }

  const resolvedOutputDir = path.resolve(process.cwd(), outputDir);
  await fs.mkdir(resolvedOutputDir, { recursive: true });

  const summary = summarizeAxeResults(results);
  const payload = {
    generatedAt: new Date().toISOString(),
    title,
    url: results?.url || options.page?.url?.() || '',
    summary,
    violations: (results?.violations || []).map((violation) => ({
      id: violation.id,
      impact: violation.impact || 'none',
      help: violation.help,
      helpUrl: violation.helpUrl,
      nodeCount: Array.isArray(violation.nodes) ? violation.nodes.length : 0,
      targets: (violation.nodes || []).map((node) => node.target).slice(0, 20),
    })),
    raw: results,
  };

  const fileName = `${Date.now()}-${safeSegment(title)}.json`;
  const filePath = path.join(resolvedOutputDir, fileName);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
}
