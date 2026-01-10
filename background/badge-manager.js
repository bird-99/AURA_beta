import { stateManager } from './state-manager.js';

export class BadgeManager {
  constructor(stateManagerInstance) {
    this.stateManager = stateManagerInstance;
  }

  async refresh() {
    const pending = await this.stateManager.getAllPendingDecisions();
    const count = pending.length;
    const text = count > 0 ? String(count) : '';

    await chrome.action.setBadgeText({ text });
  }

  async onStateChanged() {
    await this.refresh();
  }
}

export const badgeManager = new BadgeManager(stateManager);
export default badgeManager;
