/** State and callbacks the settings page needs; App owns them, the views only render them. */
import type { RefObject } from 'preact';
import type { SettingsPatch } from '../shared/messages.ts';

export type ListField = 'ignore' | 'split';
export type NoticeSlot = 'export' | 'import' | 'log' | 'delete' | 'settings';

export interface SettingsUi {
  drafts: Record<ListField, string>;
  errors: Record<ListField, string>;
  /** Hosts shown in the grouping list: the stored overrides plus any switched off during this visit. */
  seenSplits: string[];
  notices: Partial<Record<NoticeSlot, string>>;
  /** True while the undo toast is up; delete stays disabled until it goes. */
  undoOpen: boolean;
}

export interface SettingsHandlers {
  /** Sends only the changed keys to the worker. */
  change(patch: SettingsPatch): void;
  pause(paused: boolean): void;
  draft(field: ListField, value: string): void;
  add(field: ListField): void;
  removeIgnore(host: string): void;
  exportJson(): void;
  exportLog(): void;
  importFile(file: File): void;
  deleteAll(): void;
  /** Scrolls a settings group into view without changing the route. */
  jump(id: string): void;
  /** The hidden file input that "Choose file" opens. */
  fileRef: RefObject<HTMLInputElement | null>;
}

export const EMPTY_UI: SettingsUi = {
  drafts: { ignore: '', split: '' },
  errors: { ignore: '', split: '' },
  seenSplits: [],
  notices: {},
  undoOpen: false,
};

/** The grouping list keeps hosts switched off during the visit, so a switch can be flipped back on. */
export function mergeSeen(seen: readonly string[], overrides: readonly string[]): string[] {
  const out = [...seen];
  for (const host of overrides) if (!out.includes(host)) out.push(host);
  return out;
}
