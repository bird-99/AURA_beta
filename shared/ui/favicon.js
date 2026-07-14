export const DEFAULT_FAVICON_URL = chrome.runtime.getURL('icons/icon-48.png');

export function buildFaviconApiUrl(pageUrl, sizePx = 32) {
  if (!pageUrl) {
    return null;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(pageUrl);
  } catch (error) {
    return null;
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return null;
  }

  const apiUrl = new URL(chrome.runtime.getURL('/_favicon/'));
  apiUrl.searchParams.set('pageUrl', pageUrl);
  apiUrl.searchParams.set('size', String(sizePx));
  return apiUrl.toString();
}

export function resolveFaviconUrl({ pageUrl, tabFavIconUrl, sizePx = 32 }) {
  if (tabFavIconUrl && tabFavIconUrl.startsWith('http')) {
    return {
      kind: 'tabFavIconUrl',
      url: tabFavIconUrl,
      pageUrl: pageUrl ?? undefined,
    };
  }

  const apiUrl = buildFaviconApiUrl(pageUrl, sizePx);
  if (apiUrl) {
    return {
      kind: 'faviconApi',
      url: apiUrl,
      pageUrl: pageUrl ?? undefined,
    };
  }

  return {
    kind: 'fallback',
    url: DEFAULT_FAVICON_URL,
    pageUrl: pageUrl ?? undefined,
  };
}
