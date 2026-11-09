/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Selection for Tap & Speak / Talk-to-Select (`three-live-ai`, roadmap B2b-4).
 *
 * `el.selectedMeshes` is the multi-select set; `selected-mesh` / `el.selectedMesh` stays its
 * first entry for compatibility. Every change fires `three-live-select` with
 * `{mesh, meshes, added, removed, source, query?}` and highlights the whole set.
 */

/** What changed the selection. */
export type AISelectionSource = 'tap' | 'voice' | 'api';

/** How a request changes the selection. */
export type AISelectionMode = 'replace' | 'add' | 'remove' | 'toggle' | 'clear';

/** Payload of the `three-live-select` event. */
export interface AISelectionEventDetail {
  /** First selected mesh (compatibility with single selection), or `null`. */
  readonly mesh: string | null;
  readonly meshes: readonly string[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly source: AISelectionSource;
  /** The spoken / typed reference that produced this selection, if any. */
  readonly query?: string;
}

/** The element surface selection relies on. */
export interface AISelectableElement {
  selectedMesh?: string | null;
  selectedMeshes?: readonly string[];
  viewer?: {setSelectedMeshes?(names: readonly string[]): void} | null;
  fireEvent?(type: string, detail?: unknown): void;
  addEventListener?(type: string, fn: (e: Event) => void): void;
  __tlSelection?: string[];
  __tlSelectionInstalled?: boolean;
}

/** Most meshes one selection may hold. */
export const MAX_SELECTION = 50;

function clean(names: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    const name = typeof n === 'string' ? n.slice(0, 200) : '';
    if (name && !out.includes(name)) out.push(name);
    if (out.length >= MAX_SELECTION) break;
  }
  return out;
}

/**
 * The current selection. When `selected-mesh` was changed outside this module (an app setting
 * `el.selectedMesh`), that wins and becomes the whole selection.
 */
export function getSelection(el: AISelectableElement): string[] {
  const list = el.__tlSelection ?? [];
  const attr = el.selectedMesh || null;
  if ((list[0] ?? null) !== attr) return attr ? [attr] : [];
  return [...list];
}

/**
 * Changes the selection, highlights it, and fires `three-live-select`. Returns the event
 * detail, or `null` when nothing changed.
 */
export function setSelection(
  el: AISelectableElement,
  names: readonly string[] | string | null,
  options: {mode?: AISelectionMode; source?: AISelectionSource; query?: string} = {},
): AISelectionEventDetail | null {
  const mode = options.mode ?? 'replace';
  const before = getSelection(el);
  const given = clean(typeof names === 'string' ? [names] : (names ?? []));
  let next: string[];
  switch (mode) {
    case 'clear':
      next = [];
      break;
    case 'add':
      next = clean([...before, ...given]);
      break;
    case 'remove':
      next = before.filter((m) => !given.includes(m));
      break;
    case 'toggle':
      next = clean([
        ...before.filter((m) => !given.includes(m)),
        ...given.filter((m) => !before.includes(m)),
      ]);
      break;
    default:
      next = given;
  }
  const added = next.filter((m) => !before.includes(m));
  const removed = before.filter((m) => !next.includes(m));
  if (!added.length && !removed.length && next.join('\n') === before.join('\n')) return null;
  el.__tlSelection = next;
  // The attribute drives single-mesh consumers; the viewer then gets the full set.
  el.selectedMesh = next[0] ?? null;
  el.viewer?.setSelectedMeshes?.(next);
  const detail: AISelectionEventDetail = {
    mesh: next[0] ?? null,
    meshes: next,
    added,
    removed,
    source: options.source ?? 'api',
    ...(options.query ? {query: String(options.query).slice(0, 2000)} : {}),
  };
  el.fireEvent?.('three-live-select', detail);
  return detail;
}

/** Adds `el.selectedMeshes` and keeps the highlight across scene reloads. Idempotent. */
export function installSelectionState(el: AISelectableElement): void {
  if (!el || el.__tlSelectionInstalled) return;
  el.__tlSelectionInstalled = true;
  if (!('selectedMeshes' in el)) {
    Object.defineProperty(el, 'selectedMeshes', {
      get: () => getSelection(el),
      set: (v: readonly string[] | null) => {
        setSelection(el, v ?? [], {mode: 'replace', source: 'api'});
      },
      configurable: true,
    });
  }
  // A reload (e.g. an applied edit) re-applies only `selected-mesh`; restore the full set.
  el.addEventListener?.('three-load', () => {
    const current = getSelection(el);
    if (current.length > 1) el.viewer?.setSelectedMeshes?.(current);
  });
}

/** Describes a selection for a voice model ("the meshes "A" and "B""). */
export function describeSelection(meshes: readonly string[]): string {
  if (!meshes.length) return 'The user cleared the selection.';
  if (meshes.length === 1) {
    return `The user selected the mesh "${meshes[0]}". "This" or "it" now refers to it.`;
  }
  const shown = meshes.slice(0, 20).map((m) => `"${m}"`);
  const more = meshes.length > 20 ? ` and ${meshes.length - 20} more` : '';
  return `The user selected ${meshes.length} meshes: ${shown.join(', ')}${more}. "These", "them", or "it" refer to them.`;
}
