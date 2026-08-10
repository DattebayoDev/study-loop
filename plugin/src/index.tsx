/**
 * Study Loop — RemNote plugin entry point.
 *
 * Registers:
 *  • Settings: watcherPort (default 3748), userId
 *  • Sidebar widget: SyncWidget — "Sync Now" button + status
 *  • Command: "Study Loop: Sync Now" (accessible from the command palette)
 *
 * Auto-sync note: the interval-based auto-sync runs while the sidebar widget
 * is mounted (i.e. while RemNote is open with the sidebar visible). There is
 * no RemNote background scheduler — if you close the sidebar the interval
 * stops. Use the command palette command as a manual trigger anytime.
 */
import { declareIndexPlugin, ReactRNPlugin, WidgetLocation } from '@remnote/remnote-lib';
import { SyncWidget } from './widgets/SyncWidget';

async function onActivate(plugin: ReactRNPlugin): Promise<void> {
  // ── Settings ─────────────────────────────────────────────────────────────
  await plugin.settings.registerNumberSetting({
    id: 'watcherPort',
    title: 'Watcher port',
    description: 'Port the local watch.ts server listens on (default 3748)',
    defaultValue: 3748,
  });

  await plugin.settings.registerStringSetting({
    id: 'userId',
    title: 'User ID',
    description: 'Identifies your reviews in the payload (default: "me")',
    defaultValue: 'me',
  });

  await plugin.settings.registerBooleanSetting({
    id: 'autoSync',
    title: 'Auto-sync while sidebar is open',
    description: 'Run sync automatically on an interval while the SyncWidget is visible.',
    defaultValue: true,
  });

  await plugin.settings.registerNumberSetting({
    id: 'autoSyncIntervalMin',
    title: 'Auto-sync interval (minutes)',
    description: 'How often to auto-sync (min 1). Only active while sidebar is visible.',
    defaultValue: 15,
  });

  // ── Sidebar widget ────────────────────────────────────────────────────────
  await plugin.app.registerWidget('SyncWidget', WidgetLocation.RightSidebar, {
    dimensions: { height: 'auto', width: '100%' },
  });

  // ── Command palette command ───────────────────────────────────────────────
  await plugin.app.registerCommand({
    id: 'sync-now',
    name: 'Study Loop: Sync Now',
    action: async () => {
      // Broadcast a message that SyncWidget listens for via storage
      await plugin.storage.setSession('syncTrigger', Date.now());
      await plugin.app.toast('Study Loop: sync triggered — check the sidebar widget for status.');
    },
  });
}

async function onDeactivate(_plugin: ReactRNPlugin): Promise<void> {}

declareIndexPlugin(onActivate, onDeactivate);
