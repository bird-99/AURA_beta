const DARK_COMFORT_THEME_REQUIRED_POSTCHECKS = Object.freeze([
  'textContrast',
  'largeTextContrast',
  'linksDistinct',
  'controlsVisible',
  'focusRingVisible',
  'placeholdersReadable',
  'codeReadable',
  'mediaPreserved',
  'svgVisible',
  'noHorizontalScrollRegression',
  'noClippedTextRegression',
  'cleanupExact',
]);

const DEFAULT_THRESHOLDS = Object.freeze({
  textContrast: 4.5,
  largeTextContrast: 3,
});

function normalizeBoolean(value) {
  return value === true;
}

function evaluateDarkComfortThemePostcheckV1(report = {}, thresholds = DEFAULT_THRESHOLDS) {
  const textContrast = typeof report.textContrast === 'number' ? report.textContrast : null;
  const largeTextContrast = typeof report.largeTextContrast === 'number' ? report.largeTextContrast : null;
  const failures = [];

  if (textContrast == null || textContrast < thresholds.textContrast) {
    failures.push('textContrast');
  }
  if (largeTextContrast != null && largeTextContrast < thresholds.largeTextContrast) {
    failures.push('largeTextContrast');
  }

  [
    'linksDistinct',
    'controlsVisible',
    'focusRingVisible',
    'placeholdersReadable',
    'codeReadable',
    'mediaPreserved',
    'svgVisible',
    'noHorizontalScrollRegression',
    'noClippedTextRegression',
    'cleanupExact',
  ].forEach((key) => {
    if (!normalizeBoolean(report[key])) {
      failures.push(key);
    }
  });

  if (report.budgetHit === true) {
    failures.push('budgetHit');
  }

  return {
    ok: failures.length === 0,
    postCheckPassed: failures.length === 0,
    failures,
    thresholds: {
      textContrast: thresholds.textContrast,
      largeTextContrast: thresholds.largeTextContrast,
    },
  };
}

export {
  DARK_COMFORT_THEME_REQUIRED_POSTCHECKS,
  DEFAULT_THRESHOLDS as DARK_COMFORT_THEME_POSTCHECK_THRESHOLDS,
  evaluateDarkComfortThemePostcheckV1,
};
