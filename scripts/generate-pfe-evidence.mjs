#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const nodeCmd = process.execPath;

const generatedAt = new Date();
const runId = generatedAt.toISOString().replace(/[:.]/g, '-');
const artifactsDir = path.join(repoRoot, 'artifacts', 'pfe-evidence', runId);
const axeDir = path.join(artifactsDir, 'axe');
const reportsDir = path.join(artifactsDir, 'reports');
const markdownReportPath = path.join(reportsDir, 'pfe-evidence-report.md');
const jsonSummaryPath = path.join(reportsDir, 'pfe-evidence-summary.json');

function relativePath(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}

function safeFileName(value) {
  return String(value)
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'artifact';
}

function commandLine(command, args) {
  return [command, ...args].join(' ');
}

function needsShell(command) {
  return process.platform === 'win32' && /\.cmd$/i.test(command);
}

function spawnTarget(definition) {
  if (!needsShell(definition.command)) {
    return {
      command: definition.command,
      args: definition.args,
    };
  }

  return {
    command: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', definition.command, ...definition.args],
  };
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function parseTapSummary(text) {
  const summary = {
    tests: null,
    pass: null,
    fail: null,
    cancelled: null,
    skipped: null,
    todo: null,
    durationMs: null,
  };
  let matched = false;

  for (const line of text.split(/\r?\n/)) {
    const countMatch = /^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$/.exec(line);
    if (countMatch) {
      summary[countMatch[1]] = Number(countMatch[2]);
      matched = true;
      continue;
    }

    const durationMatch = /^# duration_ms ([\d.]+)\s*$/.exec(line);
    if (durationMatch) {
      summary.durationMs = Number(durationMatch[1]);
      matched = true;
    }
  }

  return matched ? summary : null;
}

function parseJsonFromText(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const starts = [
      trimmed.indexOf('{\n  "config"'),
      trimmed.indexOf('{\r\n  "config"'),
      trimmed.indexOf('{"config"'),
      trimmed.indexOf('{\n  "stats"'),
      trimmed.indexOf('{"stats"'),
    ].filter((index) => index >= 0);
    const start = starts.length ? Math.min(...starts) : trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function collectPlaywrightOutcomes(report) {
  const counts = {
    expected: 0,
    unexpected: 0,
    flaky: 0,
    skipped: 0,
    total: 0,
    durationMs: typeof report?.stats?.duration === 'number' ? report.stats.duration : null,
  };

  if (report?.stats) {
    counts.expected = Number(report.stats.expected || 0);
    counts.unexpected = Number(report.stats.unexpected || 0);
    counts.flaky = Number(report.stats.flaky || 0);
    counts.skipped = Number(report.stats.skipped || 0);
    counts.total = counts.expected + counts.unexpected + counts.flaky + counts.skipped;
    return counts;
  }

  function visitSuite(suite) {
    for (const spec of suite?.specs || []) {
      for (const test of spec.tests || []) {
        const outcome = test.outcome || test.status || 'unknown';
        if (outcome === 'expected') counts.expected += 1;
        else if (outcome === 'unexpected') counts.unexpected += 1;
        else if (outcome === 'flaky') counts.flaky += 1;
        else if (outcome === 'skipped') counts.skipped += 1;
      }
    }
    for (const child of suite?.suites || []) {
      visitSuite(child);
    }
  }

  for (const suite of report?.suites || []) {
    visitSuite(suite);
  }
  counts.total = counts.expected + counts.unexpected + counts.flaky + counts.skipped;
  return counts.total ? counts : null;
}

function parseCommandOutput(parser, stdout, stderr) {
  if (parser === 'tap') {
    return parseTapSummary(`${stdout}\n${stderr}`);
  }
  if (parser === 'playwright-json') {
    const report = parseJsonFromText(stdout) || parseJsonFromText(`${stdout}\n${stderr}`);
    if (!report) return null;
    return {
      stats: collectPlaywrightOutcomes(report),
      projectCount: Array.isArray(report.config?.projects) ? report.config.projects.length : null,
    };
  }
  if (parser === 'version') {
    return { value: stdout.trim() || stderr.trim() };
  }
  return null;
}

async function runCommand(definition) {
  const fileBase = safeFileName(definition.id);
  const stdoutPath = path.join(artifactsDir, `${fileBase}.stdout.log`);
  const stderrPath = path.join(artifactsDir, `${fileBase}.stderr.log`);
  const combinedPath = path.join(artifactsDir, `${fileBase}.combined.log`);
  const startedAt = new Date();
  const startedAtMs = Date.now();

  const target = spawnTarget(definition);
  const child = spawn(target.command, target.args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      CI: process.env.CI || '1',
      ...(definition.env || {}),
    },
    shell: false,
  });

  const stdoutChunks = [];
  const stderrChunks = [];
  child.stdout.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));

  const exitCode = await new Promise((resolve) => {
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(typeof code === 'number' ? code : 1));
  });

  const finishedAt = new Date();
  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = Buffer.concat(stderrChunks).toString('utf8');
  await fs.writeFile(stdoutPath, stdout, 'utf8');
  await fs.writeFile(stderrPath, stderr, 'utf8');
  await fs.writeFile(
    combinedPath,
    [
      `$ ${commandLine(definition.command, definition.args)}`,
      '',
      '--- stdout ---',
      stdout,
      '--- stderr ---',
      stderr,
    ].join('\n'),
    'utf8',
  );

  return {
    id: definition.id,
    label: definition.label,
    command: commandLine(definition.command, definition.args),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Date.now() - startedAtMs,
    exitCode,
    status: exitCode === 0 ? 'pass' : 'fail',
    parsed: parseCommandOutput(definition.parser, stdout, stderr),
    logs: {
      stdout: relativePath(stdoutPath),
      stderr: relativePath(stderrPath),
      combined: relativePath(combinedPath),
    },
  };
}

async function readWorkflowSummary() {
  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'tests.yml');
  const text = await readTextIfExists(workflowPath);
  const steps = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*-\s+name:\s+(.+)\s*$/.exec(line);
    if (match) steps.push(match[1].trim());
  }
  return {
    path: relativePath(workflowPath),
    exists: Boolean(text),
    steps,
  };
}

async function buildMetricsSummary() {
  const capabilityModule = await import('./page-understanding-capability-report.mjs');
  const qualityModule = await import('./page-understanding-quality-report.mjs');
  const capabilityRows = capabilityModule.buildCapabilityRows();
  const qualityRows = qualityModule.buildQualityRows();
  const capabilitySummary = capabilityModule.summarizeCapabilityRows(capabilityRows);
  const qualitySummary = qualityModule.summarizeQualityRows(qualityRows);
  const capabilityPath = path.join(reportsDir, 'page-understanding-capability-report.md');
  const qualityPath = path.join(reportsDir, 'page-understanding-quality-report.md');

  await fs.writeFile(capabilityPath, capabilityModule.renderCapabilityReport(capabilityRows), 'utf8');
  await fs.writeFile(qualityPath, qualityModule.renderQualityReport(qualityRows), 'utf8');

  return {
    capability: {
      reportPath: relativePath(capabilityPath),
      summary: capabilitySummary,
    },
    quality: {
      reportPath: relativePath(qualityPath),
      summary: qualitySummary,
    },
  };
}

async function collectAxeSummary() {
  let files = [];
  try {
    files = (await fs.readdir(axeDir))
      .filter((file) => file.endsWith('.json'))
      .sort();
  } catch {
    files = [];
  }

  const byImpact = {
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0,
    none: 0,
  };
  const audits = [];

  for (const file of files) {
    const filePath = path.join(axeDir, file);
    const payload = await readJsonIfExists(filePath);
    if (!payload) continue;
    const impacts = payload.summary?.violationImpacts || {};
    for (const impact of Object.keys(byImpact)) {
      byImpact[impact] += Number(impacts[impact] || 0);
    }
    audits.push({
      title: payload.title || file,
      url: payload.url || '',
      file: relativePath(filePath),
      summary: payload.summary || null,
      violations: Array.isArray(payload.violations) ? payload.violations : [],
    });
  }

  return {
    auditCount: audits.length,
    totalViolationCount: audits.reduce((total, audit) => total + Number(audit.summary?.violationCount || 0), 0),
    totalSeriousOrCriticalViolationCount: byImpact.serious + byImpact.critical,
    byImpact,
    audits,
  };
}

async function buildRollbackSummary() {
  const telemetryText = await readTextIfExists(path.join(repoRoot, 'background', 'telemetry.js'));
  const telemetryProductEnabled = !/TRACK_PRODUCT_ENABLED\s*=\s*false/.test(telemetryText);

  return {
    source: 'OUTCOME_LEDGER_V1 runtime events',
    sourceFiles: [
      'background/outcome-ledger.js',
      'background/css-applier.js',
      'tests/unit/promotion-gates.test.js',
      'tests/unit/outcome-ledger.test.js',
    ],
    formula: 'rollbackRate = ROLLED_BACK / (POST_APPLY_PASSED + POST_APPLY_FAILED + ROLLED_BACK)',
    productionTelemetryEnabled: telemetryProductEnabled,
    productionRollbackRate: null,
    observedCiOutcomeLedgerEvents: {
      POST_APPLY_PASSED: 0,
      POST_APPLY_FAILED: 0,
      ROLLED_BACK: 0,
    },
    observedCiRollbackRate: null,
    reason: 'The dissertation build keeps product telemetry disabled and the CI suites validate rollback logic without exporting real user outcome-ledger events.',
    safetyGateEvidence: {
      minimumRollbackSuccessRateForVerifiedPromotion: 0.995,
      source: 'tests/unit/promotion-gates.test.js',
    },
  };
}

function buildPassFailSummary(commandResults) {
  const unit = commandResults.find((item) => item.id === 'unit:node-test')?.parsed;
  const e2e = commandResults.find((item) => item.id === 'e2e:functional')?.parsed?.stats;
  const a11y = commandResults.find((item) => item.id === 'a11y:axe-core')?.parsed?.stats;

  const aggregate = {
    pass: 0,
    fail: 0,
    skipped: 0,
    flaky: 0,
    total: 0,
  };

  if (unit) {
    aggregate.pass += Number(unit.pass || 0);
    aggregate.fail += Number(unit.fail || 0);
    aggregate.skipped += Number(unit.skipped || 0);
    aggregate.total += Number(unit.tests || 0);
  }
  for (const item of [e2e, a11y]) {
    if (!item) continue;
    aggregate.pass += Number(item.expected || 0);
    aggregate.fail += Number(item.unexpected || 0);
    aggregate.skipped += Number(item.skipped || 0);
    aggregate.flaky += Number(item.flaky || 0);
    aggregate.total += Number(item.total || 0);
  }

  return {
    aggregate,
    unit,
    e2e,
    a11y,
  };
}

function markdownTable(headers, rows) {
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
  ];
  for (const row of rows) {
    lines.push(`| ${headers.map((header) => String(row[header] ?? '')).join(' | ')} |`);
  }
  return lines.join('\n');
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  return String(value);
}

function formatRate(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  return `${(value * 100).toFixed(2)}%`;
}

function renderMarkdown(summary) {
  const commandRows = summary.ci.commands.map((command) => ({
    id: command.id,
    status: command.status,
    exitCode: command.exitCode,
    durationMs: command.durationMs,
    log: command.logs.combined,
  }));
  const countRows = [
    {
      suite: 'Unit tests Node',
      pass: summary.passFail.unit?.pass,
      fail: summary.passFail.unit?.fail,
      skipped: summary.passFail.unit?.skipped,
      flaky: 0,
      total: summary.passFail.unit?.tests,
    },
    {
      suite: 'E2E fonctionnels Playwright',
      pass: summary.passFail.e2e?.expected,
      fail: summary.passFail.e2e?.unexpected,
      skipped: summary.passFail.e2e?.skipped,
      flaky: summary.passFail.e2e?.flaky,
      total: summary.passFail.e2e?.total,
    },
    {
      suite: 'A11y axe-core Playwright',
      pass: summary.passFail.a11y?.expected,
      fail: summary.passFail.a11y?.unexpected,
      skipped: summary.passFail.a11y?.skipped,
      flaky: summary.passFail.a11y?.flaky,
      total: summary.passFail.a11y?.total,
    },
    {
      suite: 'Total tests automatises',
      pass: summary.passFail.aggregate.pass,
      fail: summary.passFail.aggregate.fail,
      skipped: summary.passFail.aggregate.skipped,
      flaky: summary.passFail.aggregate.flaky,
      total: summary.passFail.aggregate.total,
    },
  ];
  const axeRows = summary.axe.audits.map((audit) => ({
    audit: audit.title,
    violations: audit.summary?.violationCount ?? 'N/A',
    seriousCritical: audit.summary?.seriousOrCriticalViolationCount ?? 'N/A',
    file: audit.file,
  }));

  return [
    '# Rapport de preuves CI, qualite et accessibilite - AURA',
    '',
    `Genere le ${summary.generatedAt}.`,
    '',
    '## Fichiers produits',
    '',
    `- Resume JSON: ${summary.files.jsonSummary}`,
    `- Rapport Markdown: ${summary.files.markdownReport}`,
    `- Artefacts bruts: ${summary.files.artifactsDir}`,
    `- Rapport capability: ${summary.metrics.capability.reportPath}`,
    `- Rapport quality: ${summary.metrics.quality.reportPath}`,
    '',
    '## Synthese',
    '',
    `- Statut global des commandes: ${summary.status}`,
    `- Tests automatises: ${summary.passFail.aggregate.pass} pass, ${summary.passFail.aggregate.fail} fail, ${summary.passFail.aggregate.skipped} skipped, ${summary.passFail.aggregate.flaky} flaky, ${summary.passFail.aggregate.total} total.`,
    `- Audits axe-core: ${summary.axe.auditCount} audits, ${summary.axe.totalViolationCount} violations totales, ${summary.axe.totalSeriousOrCriticalViolationCount} violations serious/critical.`,
    `- Rollback production: ${formatRate(summary.rollback.productionRollbackRate)} (${summary.rollback.reason})`,
    '',
    '## Sorties CI locales',
    '',
    `Workflow GitHub reference: ${summary.ci.workflow.path}`,
    '',
    summary.ci.workflow.steps.length
      ? `Etapes du workflow: ${summary.ci.workflow.steps.join(' -> ')}`
      : 'Workflow GitHub non detecte.',
    '',
    markdownTable(['id', 'status', 'exitCode', 'durationMs', 'log'], commandRows),
    '',
    '## Pass/fail counts',
    '',
    markdownTable(['suite', 'pass', 'fail', 'skipped', 'flaky', 'total'], countRows),
    '',
    '## Resultats axe-core',
    '',
    `- Critical: ${summary.axe.byImpact.critical}`,
    `- Serious: ${summary.axe.byImpact.serious}`,
    `- Moderate: ${summary.axe.byImpact.moderate}`,
    `- Minor: ${summary.axe.byImpact.minor}`,
    `- Sans impact declare: ${summary.axe.byImpact.none}`,
    '',
    axeRows.length ? markdownTable(['audit', 'violations', 'seriousCritical', 'file'], axeRows) : 'Aucun fichier axe-core genere. Voir la sortie de la commande a11y.',
    '',
    '## Metriques fonctionnelles',
    '',
    '### Page Understanding Capability',
    '',
    `- Fixtures: ${summary.metrics.capability.summary.fixtures}`,
    `- Rows: ${summary.metrics.capability.summary.totalRows}`,
    `- Average v2Coverage: ${summary.metrics.capability.summary.v2CoverageAverage}`,
    `- Action target hit rate: ${formatRate(summary.metrics.capability.summary.actionTargetHitRate)} (${summary.metrics.capability.summary.actionTargetHits}/${summary.metrics.capability.summary.actionTargetEligible})`,
    `- Confident wrong rate: ${formatRate(summary.metrics.capability.summary.confidentWrongRate)}`,
    `- Eligible fallback dependency rate: ${formatRate(summary.metrics.capability.summary.eligibleFallbackDependencyRate)}`,
    '',
    '### Page Understanding Quality',
    '',
    `- Fixtures: ${summary.metrics.quality.summary.fixtures}`,
    `- Rows: ${summary.metrics.quality.summary.totalRows}`,
    `- Average v2Coverage: ${summary.metrics.quality.summary.v2CoverageAverage}`,
    `- Action target hit rate: ${formatRate(summary.metrics.quality.summary.actionTargetHitRate)} (${summary.metrics.quality.summary.actionTargetHits}/${summary.metrics.quality.summary.actionTargetEligible})`,
    `- Current fallback dependency rate: ${formatRate(summary.metrics.quality.summary.currentFallbackDependencyRate)}`,
    `- V3-lite opportunity rate: ${formatRate(summary.metrics.quality.summary.v3LiteOpportunityRate)}`,
    '',
    '## Rollback',
    '',
    `- Source prevue: ${summary.rollback.source}`,
    `- Formule: ${summary.rollback.formula}`,
    `- Evenements CI observes: POST_APPLY_PASSED=${summary.rollback.observedCiOutcomeLedgerEvents.POST_APPLY_PASSED}, POST_APPLY_FAILED=${summary.rollback.observedCiOutcomeLedgerEvents.POST_APPLY_FAILED}, ROLLED_BACK=${summary.rollback.observedCiOutcomeLedgerEvents.ROLLED_BACK}`,
    `- Taux observe en CI: ${formatRate(summary.rollback.observedCiRollbackRate)}`,
    `- Taux production: ${formatRate(summary.rollback.productionRollbackRate)}`,
    `- Exigence de gate verifiee par tests: rollbackSuccessRate >= ${summary.rollback.safetyGateEvidence.minimumRollbackSuccessRateForVerifiedPromotion}`,
    '',
    'Note: le taux de rollback production reste non mesurable tant qu aucun export du ledger runtime ou telemetry opt-in n est active. Le rapport fournit donc la formule, les points de code, les tests de securite, et signale explicitement l absence de donnees production.',
    '',
    '## Reproductibilite',
    '',
    'Commande:',
    '',
    '```powershell',
    'npm run report:pfe:evidence',
    '```',
    '',
    'Les logs bruts sont conserves dans le dossier artefacts indique en haut du rapport.',
    '',
    '## Limites',
    '',
    '- Les sorties CI sont reproduites localement avec les memes scripts que le workflow GitHub; ce rapport ne telecharge pas les logs historiques GitHub Actions.',
    '- Les resultats axe-core proviennent des tests Playwright a11y existants.',
    '- La telemetry produit est desactivee dans ce build de memoire; aucun taux de rollback utilisateur reel ne doit etre invente.',
    '',
  ].join('\n');
}

async function main() {
  await fs.mkdir(artifactsDir, { recursive: true });
  await fs.mkdir(axeDir, { recursive: true });
  await fs.mkdir(reportsDir, { recursive: true });

  const commandDefinitions = [
    {
      id: 'environment:node-version',
      label: 'Node.js version',
      command: nodeCmd,
      args: ['--version'],
      parser: 'version',
    },
    {
      id: 'environment:npm-version',
      label: 'npm version',
      command: npmCmd,
      args: ['--version'],
      parser: 'version',
    },
    {
      id: 'static:typecheck',
      label: 'Static checks and contract tests',
      command: npmCmd,
      args: ['run', 'typecheck'],
    },
    {
      id: 'unit:node-test',
      label: 'Node unit tests',
      command: nodeCmd,
      args: ['--test', '--test-reporter=tap'],
      parser: 'tap',
    },
    {
      id: 'e2e:functional',
      label: 'Functional Playwright E2E suite',
      command: npmCmd,
      args: ['run', 'test:e2e', '--', '--reporter=json'],
      parser: 'playwright-json',
    },
    {
      id: 'a11y:axe-core',
      label: 'axe-core Playwright accessibility suite',
      command: npmCmd,
      args: ['run', 'test:a11y', '--', '--reporter=json'],
      parser: 'playwright-json',
      env: {
        AURA_A11Y_RESULTS_DIR: axeDir,
      },
    },
  ];

  const commands = [];
  for (const definition of commandDefinitions) {
    process.stdout.write(`[pfe-evidence] Running ${definition.id}\n`);
    commands.push(await runCommand(definition));
  }

  const metrics = await buildMetricsSummary();
  const axe = await collectAxeSummary();
  const rollback = await buildRollbackSummary();
  const workflow = await readWorkflowSummary();
  const passFail = buildPassFailSummary(commands);
  const packageJson = await readJsonIfExists(path.join(repoRoot, 'package.json'));

  const summary = {
    generatedAt: generatedAt.toISOString(),
    status: commands.every((command) => command.exitCode === 0) ? 'pass' : 'fail',
    project: {
      root: repoRoot,
      packageType: packageJson?.type || null,
      scripts: packageJson?.scripts || {},
      devDependencies: packageJson?.devDependencies || {},
    },
    files: {
      markdownReport: relativePath(markdownReportPath),
      jsonSummary: relativePath(jsonSummaryPath),
      artifactsDir: relativePath(artifactsDir),
      axeDir: relativePath(axeDir),
    },
    ci: {
      workflow,
      commands,
    },
    passFail,
    axe,
    metrics,
    rollback,
  };

  await fs.writeFile(jsonSummaryPath, JSON.stringify(summary, null, 2), 'utf8');
  await fs.writeFile(markdownReportPath, renderMarkdown(summary), 'utf8');
  process.stdout.write(`[pfe-evidence] Wrote ${relativePath(markdownReportPath)}\n`);
  process.stdout.write(`[pfe-evidence] Wrote ${relativePath(jsonSummaryPath)}\n`);

  if (summary.status !== 'pass') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
