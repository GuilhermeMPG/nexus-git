/** Generic diff helpers shared by the link/error wiki-preview functions in AppStateService. */

export interface DiffChange<T> {
  local: T;
  wiki: T;
}

/** Diff for "pull from wiki": items new in the wiki get added; items changed AND newer in the
 *  wiki (per `getTimestamp`) get queued as updates. Does not compute removals — import never
 *  deletes local items missing from a partial wiki page. */
export function computeImportDiff<T, K>(
  wikiItems: T[],
  localMap: Map<K, T>,
  getKey: (item: T) => K,
  getTimestamp: (item: T) => number,
  hasChanged: (local: T, wiki: T) => boolean,
  wrap: (item: T) => T,
): { toAdd: T[]; toUpdate: DiffChange<T>[] } {
  const toAdd: T[] = [];
  const toUpdate: DiffChange<T>[] = [];

  for (const wikiItem of wikiItems) {
    const local = localMap.get(getKey(wikiItem));
    if (!local) {
      toAdd.push(wrap(wikiItem));
    } else if (getTimestamp(wikiItem) > getTimestamp(local) && hasChanged(local, wikiItem)) {
      toUpdate.push({ local, wiki: wrap(wikiItem) });
    }
  }

  return { toAdd, toUpdate };
}

/** Diff for "publish to wiki": items local-only get added, items wiki-only (not in local) get
 *  queued for removal, and changed items (regardless of which side is newer) get queued as
 *  updates — publish always pushes the local version. */
export function computePublishDiff<T, K>(
  localItems: T[],
  wikiMap: Map<K, T>,
  getKey: (item: T) => K,
  hasChanged: (local: T, wiki: T) => boolean,
  wrap: (item: T) => T,
): { toAdd: T[]; toUpdate: DiffChange<T>[]; toRemove: T[] } {
  const toAdd: T[] = [];
  const toUpdate: DiffChange<T>[] = [];
  const toRemove: T[] = [];
  const localKeys = new Set(localItems.map(getKey));

  for (const local of localItems) {
    const wiki = wikiMap.get(getKey(local));
    if (!wiki) {
      toAdd.push(local);
    } else if (hasChanged(local, wiki)) {
      toUpdate.push({ local, wiki: wrap(wiki) });
    }
  }

  for (const [key, wikiItem] of wikiMap) {
    if (!localKeys.has(key)) toRemove.push(wrap(wikiItem));
  }

  return { toAdd, toUpdate, toRemove };
}
