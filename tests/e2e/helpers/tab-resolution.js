function getTargetPageUrl(pageOrUrl, callerName) {
  const pageUrl = typeof pageOrUrl === 'string' ? pageOrUrl : pageOrUrl?.url?.();
  if (!pageUrl) {
    throw new Error(`${callerName}: page/url is required`);
  }

  return pageUrl;
}

export async function resolveAuraTabForTest(serviceWorker, pageOrUrl, { allowHostFallback = false } = {}) {
  if (!serviceWorker) {
    throw new Error('resolveAuraTabForTest: serviceWorker is required');
  }

  const pageUrl = getTargetPageUrl(pageOrUrl, 'resolveAuraTabForTest');

  return serviceWorker.evaluate(async ({ url, allowFallback }) => {
    const target = new URL(url);
    const targetHref = target.href;

    const normalizeUrl = (value) => {
      if (typeof value !== 'string' || value.length === 0) {
        return null;
      }

      try {
        return new URL(value).href;
      } catch (error) {
        return value;
      }
    };

    const tabSummary = (tab) => ({
      id: typeof tab?.id === 'number' ? tab.id : null,
      url: tab?.url || null,
      pendingUrl: tab?.pendingUrl || null,
      active: tab?.active === true,
    });

    const tabHasExactUrl = (tab) => {
      return normalizeUrl(tab?.url) === targetHref || normalizeUrl(tab?.pendingUrl) === targetHref;
    };

    const tabHasTargetHost = (tab) => {
      if (!target.host) {
        return false;
      }

      return [tab?.url, tab?.pendingUrl].some((value) => {
        if (typeof value !== 'string' || value.length === 0) {
          return false;
        }

        try {
          return new URL(value).host === target.host;
        } catch (error) {
          return false;
        }
      });
    };

    const tabs = await chrome.tabs.query({});
    const exactMatches = tabs.filter((tab) => typeof tab?.id === 'number' && tabHasExactUrl(tab));

    if (exactMatches.length === 1) {
      return { ok: true, tabId: exactMatches[0].id, match: 'exact', tab: tabSummary(exactMatches[0]) };
    }

    if (exactMatches.length > 1) {
      return {
        ok: false,
        tabId: null,
        reason: 'AMBIGUOUS_EXACT_MATCH',
        candidates: exactMatches.map(tabSummary),
      };
    }

    const hostMatches = tabs.filter((tab) => typeof tab?.id === 'number' && tabHasTargetHost(tab));

    if (!allowFallback) {
      return {
        ok: false,
        tabId: null,
        reason: 'NO_EXACT_MATCH',
        candidates: hostMatches.map(tabSummary),
      };
    }

    if (hostMatches.length === 1) {
      return { ok: true, tabId: hostMatches[0].id, match: 'host', tab: tabSummary(hostMatches[0]) };
    }

    return {
      ok: false,
      tabId: null,
      reason: hostMatches.length > 1 ? 'AMBIGUOUS_HOST_FALLBACK' : 'NO_HOST_MATCH',
      candidates: hostMatches.map(tabSummary),
    };
  }, { url: pageUrl, allowFallback: allowHostFallback });
}

export async function getAuraTabId(serviceWorker, pageOrUrl, options = {}) {
  if (!serviceWorker) {
    throw new Error('getAuraTabId: serviceWorker is required');
  }

  const resolution = await resolveAuraTabForTest(serviceWorker, pageOrUrl, options);
  return typeof resolution?.tabId === 'number' ? resolution.tabId : null;
}
