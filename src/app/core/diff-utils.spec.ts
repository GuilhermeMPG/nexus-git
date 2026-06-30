import { computeImportDiff, computePublishDiff } from './diff-utils';

interface Item { id: number; value: string; updatedAt: number; }

const getKey = (i: Item) => i.id;
const getTimestamp = (i: Item) => i.updatedAt;
const hasChanged = (a: Item, b: Item) => a.value !== b.value;
const wrap = (i: Item): Item => ({ ...i });

describe('diff-utils', () => {
  describe('computeImportDiff', () => {
    it('adds items present only in the wiki', () => {
      const local = new Map<number, Item>();
      const { toAdd, toUpdate } = computeImportDiff(
        [{ id: 1, value: 'a', updatedAt: 1 }], local, getKey, getTimestamp, hasChanged, wrap,
      );
      expect(toAdd.length).toBe(1);
      expect(toUpdate.length).toBe(0);
    });

    it('queues an update only when the wiki item is both newer and changed', () => {
      const local = new Map<number, Item>([[1, { id: 1, value: 'a', updatedAt: 1 }]]);

      const sameValueNewer = computeImportDiff(
        [{ id: 1, value: 'a', updatedAt: 2 }], local, getKey, getTimestamp, hasChanged, wrap,
      );
      expect(sameValueNewer.toUpdate.length).toBe(0); // newer but unchanged — no update

      const changedButOlder = computeImportDiff(
        [{ id: 1, value: 'b', updatedAt: 0 }], local, getKey, getTimestamp, hasChanged, wrap,
      );
      expect(changedButOlder.toUpdate.length).toBe(0); // changed but older — local wins

      const changedAndNewer = computeImportDiff(
        [{ id: 1, value: 'b', updatedAt: 2 }], local, getKey, getTimestamp, hasChanged, wrap,
      );
      expect(changedAndNewer.toUpdate.length).toBe(1);
    });
  });

  describe('computePublishDiff', () => {
    it('adds local-only items, removes wiki-only items, updates changed items', () => {
      const localItems: Item[] = [
        { id: 1, value: 'local-only', updatedAt: 0 },
        { id: 2, value: 'changed-local', updatedAt: 0 },
        { id: 3, value: 'unchanged', updatedAt: 0 },
      ];
      const wikiMap = new Map<number, Item>([
        [2, { id: 2, value: 'changed-wiki', updatedAt: 0 }],
        [3, { id: 3, value: 'unchanged', updatedAt: 0 }],
        [4, { id: 4, value: 'wiki-only', updatedAt: 0 }],
      ]);

      const { toAdd, toUpdate, toRemove } = computePublishDiff(localItems, wikiMap, getKey, hasChanged, wrap);

      expect(toAdd.map(i => i.id)).toEqual([1]);
      expect(toUpdate.map(c => c.local.id)).toEqual([2]);
      expect(toRemove.map(i => i.id)).toEqual([4]);
    });
  });
});
