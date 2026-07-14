/** @typedef {'allow'|'deny'} DomainListKind */
/** @typedef {'success'|'error'|'info'} DomainStatusKind */
/** @typedef {{ allowlist: string[], denylist: string[] }} DomainLists */
/** @typedef {{ ok: boolean, reason?: string, domain?: string }} DomainValidation */
/** @typedef {{ ok: boolean, reason?: string, matchType?: string, value?: string }} ProfileTargetValidation */
/** @typedef {{ id?: string|null, matchType: string, modeId: string, value: string, action?: string, createdAt?: number, updatedAt?: number }} SiteProfileEntry */
/** @typedef {{ entries: SiteProfileEntry[], [key: string]: any }} SiteProfiles */
/** @typedef {{ id: string|null, matchType: string, modeId: string, value: string }} SiteProfileIdentity */
/** @typedef {{ identity: SiteProfileIdentity, label: string }} SiteProfileRow */
/** @typedef {{ kind: DomainStatusKind, message: string }} DomainFeedback */
/** @typedef {{ ok: boolean, reason?: string, presented?: boolean, allowlist?: string[], denylist?: string[] }} DomainOperationResult */
/** @typedef {{ ALWAYS: string, NEVER: string, ASK: string }} ProfileActions */
/** @typedef {{
 * validateListInput: (kind: DomainListKind, rawValue: unknown) => boolean,
 * setListQuery: (kind: DomainListKind, value: unknown) => boolean,
 * addListEntry: (kind: DomainListKind, rawValue: unknown) => Promise<DomainOperationResult>,
 * removeListEntry: (kind: DomainListKind, domain: string) => Promise<DomainOperationResult>,
 * validateProfileTarget: (rawValue: unknown) => boolean,
 * saveProfile: (draft?: {target?: string, modeId?: string, action?: string}) => Promise<DomainOperationResult>,
 * removeProfile: (identity: SiteProfileIdentity) => Promise<DomainOperationResult>,
 * }} DomainConfigurationActions
 */
/** @typedef {{
 * bind: (actions: DomainConfigurationActions) => void|(() => void),
 * renderLists: (allowRows: Array<{domain: string}>, denyRows: Array<{domain: string}>, queries: {allow: string, deny: string}) => void,
 * renderProfiles: (rows: SiteProfileRow[]) => void,
 * setListFeedback: (kind: DomainListKind, message: string) => void,
 * clearListInput: (kind: DomainListKind) => void,
 * setProfileFeedback: (message: string) => void,
 * resetProfileForm: (defaultAction: string) => void,
 * reportInline: (kind: DomainStatusKind, message: string) => void,
 * reportDomains: (kind: DomainStatusKind, message: string) => void,
 * dispose?: () => void,
 * }} DomainConfigurationView
 */

function requireFunction(name, value) {
  if (typeof value !== 'function') throw new TypeError(`${name} dependency is required`);
}

function asList(value) {
  return Array.isArray(value) ? [...value] : [];
}

function formatProfileAction(action) {
  if (action === 'always') return 'Always on';
  if (action === 'never') return 'Always off';
  return 'Ask each time';
}

function formatProfileMatch(matchType) {
  if (matchType === 'hostname') return 'Hostname';
  if (matchType === 'pattern') return 'Pattern';
  return 'Domain';
}

function formatModeLabel(modeId) {
  if (modeId === 'comfort-visual') return 'Comfort Visual';
  if (modeId === 'focus') return 'Focus';
  return modeId;
}

/** @param {unknown} values @returns {Array<{domain: string}>} */
export function buildDomainListRows(values) {
  return asList(values).map((domain) => ({ domain: String(domain) }));
}

/** @param {SiteProfiles|undefined|null} profiles @returns {SiteProfileRow[]} */
export function buildSiteProfileRows(profiles) {
  const entries = Array.isArray(profiles?.entries) ? [...profiles.entries] : [];
  return entries
    .sort((left, right) => {
      const first = `${left.value}-${left.modeId}-${left.action}`;
      const second = `${right.value}-${right.modeId}-${right.action}`;
      return first.localeCompare(second);
    })
    .map((entry) => ({
      identity: {
        id: typeof entry.id === 'string' && entry.id ? entry.id : null,
        matchType: entry.matchType,
        modeId: entry.modeId,
        value: entry.value,
      },
      label: `${entry.value} • ${formatProfileMatch(entry.matchType)} • ${formatModeLabel(entry.modeId)} • ${formatProfileAction(entry.action)}`,
    }));
}

/**
 * @param {{
 * document?: Document,
 * reportInlineStatus?: (kind: DomainStatusKind, message: string) => void,
 * reportSectionStatus?: (sectionId: string, kind: DomainStatusKind, message: string) => void,
 * }} [dependencies]
 * @returns {DomainConfigurationView}
 */
export function createOptionsDomainConfigurationView({
  document: documentRef,
  reportInlineStatus,
  reportSectionStatus,
} = {}) {
  if (!documentRef || typeof documentRef.getElementById !== 'function') {
    throw new TypeError('document dependency is required');
  }
  requireFunction('reportInlineStatus', reportInlineStatus);
  requireFunction('reportSectionStatus', reportSectionStatus);

  const elements = {
    allowInput: /** @type {HTMLInputElement|null} */ (documentRef.getElementById('allowlist-input')),
    denyInput: /** @type {HTMLInputElement|null} */ (documentRef.getElementById('denylist-input')),
    allowSearch: /** @type {HTMLInputElement|null} */ (documentRef.getElementById('allowlist-search')),
    denySearch: /** @type {HTMLInputElement|null} */ (documentRef.getElementById('denylist-search')),
    allowFeedback: /** @type {HTMLElement|null} */ (documentRef.getElementById('allowlist-feedback')),
    denyFeedback: /** @type {HTMLElement|null} */ (documentRef.getElementById('denylist-feedback')),
    allowList: /** @type {HTMLElement|null} */ (documentRef.getElementById('allowlist-items')),
    denyList: /** @type {HTMLElement|null} */ (documentRef.getElementById('denylist-items')),
    addAllow: /** @type {HTMLButtonElement|null} */ (documentRef.getElementById('add-allow')),
    addDeny: /** @type {HTMLButtonElement|null} */ (documentRef.getElementById('add-deny')),
    profileTarget: /** @type {HTMLInputElement|null} */ (documentRef.getElementById('site-profile-target')),
    profileFeedback: /** @type {HTMLElement|null} */ (documentRef.getElementById('site-profile-feedback')),
    profileMode: /** @type {HTMLSelectElement|null} */ (documentRef.getElementById('site-profile-mode')),
    profileAction: /** @type {HTMLSelectElement|null} */ (documentRef.getElementById('site-profile-action')),
    profileSave: /** @type {HTMLButtonElement|null} */ (documentRef.getElementById('site-profile-save')),
    profileList: /** @type {HTMLElement|null} */ (documentRef.getElementById('site-profile-list')),
  };
  for (const [name, element] of Object.entries(elements)) {
    if (!element) throw new Error(`Missing Domain configuration element: ${name}`);
  }

  let unbind = null;

  function renderList(rows, container, query, kind) {
    container.textContent = '';
    if (!rows.length) {
      const empty = documentRef.createElement('li');
      empty.className = 'list-item';
      empty.textContent = 'No domains';
      empty.hidden = Boolean(query) && !empty.textContent.toLowerCase().includes(query);
      container.appendChild(empty);
      return;
    }
    for (const row of rows) {
      const item = documentRef.createElement('li');
      item.className = 'list-item';
      item.dataset.domain = row.domain;
      item.hidden = Boolean(query) && !row.domain.toLowerCase().includes(query);
      const label = documentRef.createElement('span');
      label.textContent = row.domain;
      const button = documentRef.createElement('button');
      button.className = 'btn danger';
      button.textContent = 'Remove';
      button.dataset.domainRemove = kind;
      button.dataset.domain = row.domain;
      item.append(label, button);
      container.appendChild(item);
    }
  }

  return Object.freeze({
    bind(actions) {
      if (unbind) return unbind;
      /** @type {Array<[HTMLElement, string, EventListener]>} */
      const listeners = [
        [elements.allowInput, 'blur', () => actions.validateListInput('allow', elements.allowInput.value)],
        [elements.denyInput, 'blur', () => actions.validateListInput('deny', elements.denyInput.value)],
        [elements.allowSearch, 'input', () => actions.setListQuery('allow', elements.allowSearch.value)],
        [elements.denySearch, 'input', () => actions.setListQuery('deny', elements.denySearch.value)],
        [elements.addAllow, 'click', () => { void actions.addListEntry('allow', elements.allowInput.value); }],
        [elements.addDeny, 'click', () => { void actions.addListEntry('deny', elements.denyInput.value); }],
        [elements.profileTarget, 'blur', () => actions.validateProfileTarget(elements.profileTarget.value)],
        [elements.profileSave, 'click', () => {
          void actions.saveProfile({
            target: elements.profileTarget.value,
            modeId: elements.profileMode.value,
            action: elements.profileAction.value,
          });
        }],
        [elements.allowList, 'click', (event) => {
          const target = event.target instanceof Element ? event.target : null;
          const button = /** @type {HTMLButtonElement|null} */ (target?.closest('button[data-domain-remove="allow"]') || null);
          if (button && elements.allowList.contains(button)) void actions.removeListEntry('allow', button.dataset.domain);
        }],
        [elements.denyList, 'click', (event) => {
          const target = event.target instanceof Element ? event.target : null;
          const button = /** @type {HTMLButtonElement|null} */ (target?.closest('button[data-domain-remove="deny"]') || null);
          if (button && elements.denyList.contains(button)) void actions.removeListEntry('deny', button.dataset.domain);
        }],
        [elements.profileList, 'click', (event) => {
          const target = event.target instanceof Element ? event.target : null;
          const button = /** @type {HTMLButtonElement|null} */ (target?.closest('button[data-profile-remove]') || null);
          if (button && elements.profileList.contains(button)) {
            void actions.removeProfile({
              id: button.dataset.profileId || null,
              matchType: button.dataset.profileMatchType,
              modeId: button.dataset.profileModeId,
              value: button.dataset.profileValue,
            });
          }
        }],
      ];
      for (const [element, type, listener] of listeners) element.addEventListener(type, listener);
      unbind = () => {
        for (const [element, type, listener] of listeners) element.removeEventListener(type, listener);
        unbind = null;
      };
      return unbind;
    },
    renderLists(allowRows, denyRows, queries) {
      renderList(allowRows, elements.allowList, queries.allow, 'allow');
      renderList(denyRows, elements.denyList, queries.deny, 'deny');
    },
    renderProfiles(rows) {
      elements.profileList.textContent = '';
      if (!rows.length) {
        const empty = documentRef.createElement('li');
        empty.className = 'list-item';
        empty.textContent = 'No site overrides yet.';
        elements.profileList.appendChild(empty);
        return;
      }
      for (const row of rows) {
        const item = documentRef.createElement('li');
        item.className = 'list-item';
        const label = documentRef.createElement('span');
        label.textContent = row.label;
        const button = documentRef.createElement('button');
        button.className = 'btn danger';
        button.textContent = 'Remove';
        button.dataset.profileRemove = '';
        if (row.identity.id) button.dataset.profileId = row.identity.id;
        button.dataset.profileMatchType = row.identity.matchType;
        button.dataset.profileModeId = row.identity.modeId;
        button.dataset.profileValue = row.identity.value;
        item.append(label, button);
        elements.profileList.appendChild(item);
      }
    },
    setListFeedback(kind, message) {
      elements[kind === 'deny' ? 'denyFeedback' : 'allowFeedback'].textContent = message;
    },
    clearListInput(kind) {
      elements[kind === 'deny' ? 'denyInput' : 'allowInput'].value = '';
    },
    setProfileFeedback(message) {
      elements.profileFeedback.textContent = message;
    },
    resetProfileForm(defaultAction) {
      elements.profileTarget.value = '';
      elements.profileAction.value = defaultAction;
      elements.profileFeedback.textContent = '';
    },
    reportInline(kind, message) {
      reportInlineStatus(kind, message);
    },
    reportDomains(kind, message) {
      reportSectionStatus('domains', kind, message);
    },
    dispose() {
      unbind?.();
    },
  });
}

/**
 * @param {{
 * mutateLists?: (update: (stored: DomainLists) => DomainLists) => Promise<DomainLists>,
 * mutateProfiles?: (update: (stored: unknown) => SiteProfiles) => Promise<unknown>,
 * normalizeDomain?: (value: unknown) => DomainValidation,
 * parseProfileTarget?: (value: unknown) => ProfileTargetValidation,
 * normalizeProfiles?: (value: unknown) => SiteProfiles,
 * profileActions?: ProfileActions,
 * defaultModeId?: string,
 * now?: () => number,
 * createProfileId?: (timestamp: number) => string,
 * view?: DomainConfigurationView,
 * }} [dependencies]
 */
export function createOptionsDomainConfigurationController({
  mutateLists,
  mutateProfiles,
  normalizeDomain,
  parseProfileTarget,
  normalizeProfiles,
  profileActions,
  defaultModeId,
  now = Date.now,
  createProfileId,
  view,
} = {}) {
  for (const [name, dependency] of Object.entries({
    mutateLists,
    mutateProfiles,
    normalizeDomain,
    parseProfileTarget,
    normalizeProfiles,
    now,
    createProfileId,
  })) requireFunction(name, dependency);
  if (!view || typeof view.bind !== 'function') throw new TypeError('view dependency is required');
  if (!profileActions?.ALWAYS || !profileActions?.NEVER || !profileActions?.ASK) {
    throw new TypeError('profileActions dependency is required');
  }
  if (!defaultModeId) throw new TypeError('defaultModeId dependency is required');

  let allowlist = [];
  let denylist = [];
  let profiles = normalizeProfiles({});
  const queries = { allow: '', deny: '' };
  let initialized = false;
  let disposed = false;
  let profileUiEpoch = 0;

  function renderLists() {
    if (disposed) return;
    view.renderLists(buildDomainListRows(allowlist), buildDomainListRows(denylist), { ...queries });
  }

  function renderProfiles() {
    if (disposed) return;
    view.renderProfiles(buildSiteProfileRows(profiles));
  }

  function validateList(kind, rawValue) {
    const validation = normalizeDomain(rawValue);
    view.setListFeedback(kind, validation.ok ? '' : validation.reason);
    return validation;
  }

  async function commitLists(update) {
    try {
      const committed = await mutateLists((stored) => update({
        allowlist: asList(stored?.allowlist),
        denylist: asList(stored?.denylist),
      }));
      allowlist = asList(committed?.allowlist);
      denylist = asList(committed?.denylist);
      renderLists();
      return { ok: true, allowlist, denylist };
    } catch (error) {
      const message = error?.message || 'Unable to update domain lists';
      view.reportInline('error', message);
      view.reportDomains('error', message);
      return { ok: false, reason: message };
    }
  }

  function profileIdentityMatches(entry, identity) {
    if (typeof identity?.id === 'string' && identity.id) return entry.id === identity.id;
    return entry.modeId === identity?.modeId
      && entry.matchType === identity?.matchType
      && entry.value === identity?.value;
  }

  function findProfileIndex(entries, identity) {
    return entries.findIndex((entry) => profileIdentityMatches(entry, identity));
  }

  function canPresentProfileOperation(operation) {
    return !disposed && operation === profileUiEpoch;
  }

  /**
   * @param {(profiles: SiteProfiles) => SiteProfiles} update
   * @param {{ operation?: number, feedback?: DomainFeedback|(() => DomainFeedback) }} [options]
   * @returns {Promise<DomainOperationResult>}
   */
  async function commitProfiles(update, { operation, feedback } = {}) {
    try {
      const committed = await mutateProfiles((storedProfiles) => {
        const latest = normalizeProfiles(storedProfiles);
        return normalizeProfiles(update(latest));
      });
      if (!canPresentProfileOperation(operation)) return { ok: true, presented: false };
      profiles = normalizeProfiles(committed);
      renderProfiles();
      const resolvedFeedback = typeof feedback === 'function' ? feedback() : feedback;
      if (resolvedFeedback?.message) {
        view.reportInline(resolvedFeedback.kind, resolvedFeedback.message);
        view.reportDomains(resolvedFeedback.kind, resolvedFeedback.message);
      }
      return { ok: true, presented: true };
    } catch (error) {
      const message = error?.message || 'Unable to save site overrides';
      if (canPresentProfileOperation(operation)) {
        view.reportInline('error', message);
        view.reportDomains('error', message);
      }
      return { ok: false, reason: message };
    }
  }

  const actions = Object.freeze({
    validateListInput(kind, rawValue) {
      if (disposed) return false;
      validateList(kind, rawValue);
      return true;
    },
    setListQuery(kind, value) {
      if (disposed) return false;
      queries[kind === 'deny' ? 'deny' : 'allow'] = String(value || '').trim().toLowerCase();
      renderLists();
      return true;
    },
    async addListEntry(kind, rawValue) {
      if (disposed) return { ok: false, reason: 'DOMAIN_CONTROLLER_DISPOSED' };
      const validation = validateList(kind, rawValue);
      if (!validation.ok) {
        view.reportDomains('error', validation.reason);
        return { ok: false, reason: validation.reason };
      }
      const domain = validation.domain;
      let duplicate = false;
      const result = await commitLists((stored) => {
        const target = new Set(kind === 'deny' ? stored.denylist : stored.allowlist);
        const opposite = new Set(kind === 'deny' ? stored.allowlist : stored.denylist);
        duplicate = target.has(domain) && !opposite.has(domain);
        target.add(domain);
        opposite.delete(domain);
        return kind === 'deny'
          ? { allowlist: Array.from(opposite).sort(), denylist: Array.from(target).sort() }
          : { allowlist: Array.from(target).sort(), denylist: Array.from(opposite).sort() };
      });
      if (!result.ok) return result;
      if (duplicate) {
        view.reportDomains('info', `Domain already in ${kind === 'deny' ? 'denylist' : 'allowlist'}`);
      } else {
        view.reportDomains('success', `${kind === 'deny' ? 'Denylist' : 'Allowlist'} updated`);
      }
      view.clearListInput(kind);
      view.setListFeedback(kind, '');
      return { ok: true };
    },
    async removeListEntry(kind, domain) {
      if (disposed) return { ok: false, reason: 'DOMAIN_CONTROLLER_DISPOSED' };
      const result = await commitLists((stored) => {
        const allow = new Set(stored.allowlist);
        const deny = new Set(stored.denylist);
        (kind === 'deny' ? deny : allow).delete(domain);
        return { allowlist: Array.from(allow).sort(), denylist: Array.from(deny).sort() };
      });
      if (!result.ok) return result;
      view.reportDomains('success', `${kind === 'deny' ? 'Denylist' : 'Allowlist'} updated`);
      return { ok: true };
    },
    validateProfileTarget(rawValue) {
      if (disposed) return false;
      if (!String(rawValue || '').trim()) {
        view.setProfileFeedback('');
        return true;
      }
      const validation = parseProfileTarget(rawValue);
      view.setProfileFeedback(validation.ok ? '' : validation.reason);
      return validation.ok;
    },
    async saveProfile(draft = {}) {
      if (disposed) return { ok: false, reason: 'DOMAIN_CONTROLLER_DISPOSED' };
      const validation = parseProfileTarget(draft.target || '');
      if (!validation.ok) {
        view.setProfileFeedback(validation.reason);
        view.reportDomains('error', validation.reason);
        return { ok: false, reason: validation.reason };
      }
      const action = [profileActions.ALWAYS, profileActions.NEVER, profileActions.ASK].includes(draft.action)
        ? draft.action
        : profileActions.ASK;
      const modeId = draft.modeId || defaultModeId;
      const identity = {
        id: null,
        matchType: validation.matchType,
        modeId,
        value: validation.value,
      };
      const operation = ++profileUiEpoch;

      if (action === profileActions.ASK) {
        let removed = false;
        const result = await commitProfiles((latest) => {
          const entries = [...latest.entries];
          const existingIndex = findProfileIndex(entries, identity);
          removed = existingIndex >= 0;
          if (removed) entries.splice(existingIndex, 1);
          return { ...latest, entries };
        }, {
          operation,
          feedback: () => removed
            ? { kind: 'success', message: 'Site override removed' }
            : { kind: 'info', message: 'Ask is the default. No override saved.' },
        });
        if (result.ok && result.presented) view.resetProfileForm(profileActions.ASK);
        return result.ok ? { ok: true } : result;
      }

      const result = await commitProfiles((latest) => {
        const entries = [...latest.entries];
        const existingIndex = findProfileIndex(entries, identity);
        const existing = existingIndex >= 0 ? entries[existingIndex] : null;
        const timestamp = now();
        const upsertEntry = {
          id: existing?.id || createProfileId(timestamp),
          action,
          matchType: validation.matchType,
          modeId,
          value: validation.value,
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        if (existingIndex >= 0) entries[existingIndex] = upsertEntry;
        else entries.push(upsertEntry);
        return { ...latest, entries };
      }, {
        operation,
        feedback: { kind: 'success', message: 'Site overrides saved' },
      });
      if (result.ok && result.presented) view.resetProfileForm(profileActions.ASK);
      return result.ok ? { ok: true } : result;
    },
    async removeProfile(identity) {
      if (disposed) return { ok: false, reason: 'DOMAIN_CONTROLLER_DISPOSED' };
      const operation = ++profileUiEpoch;
      let removed = false;
      const result = await commitProfiles((latest) => {
        const entries = [...latest.entries];
        const existingIndex = findProfileIndex(entries, identity);
        removed = existingIndex >= 0;
        if (removed) entries.splice(existingIndex, 1);
        return { ...latest, entries };
      }, {
        operation,
        feedback: () => removed
          ? { kind: 'success', message: 'Site override removed' }
          : { kind: 'info', message: 'Site override already removed' },
      });
      return result.ok ? { ok: true } : result;
    },
  });

  return Object.freeze({
    initialize() {
      if (disposed || initialized) return false;
      initialized = true;
      view.bind(actions);
      return true;
    },
    setState(nextState = {}) {
      if (disposed) return false;
      profileUiEpoch += 1;
      allowlist = asList(nextState.allowlist);
      denylist = asList(nextState.denylist);
      profiles = normalizeProfiles(nextState.profiles || {});
      renderLists();
      renderProfiles();
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      profileUiEpoch += 1;
      initialized = false;
      view.dispose?.();
    },
    actions,
  });
}
