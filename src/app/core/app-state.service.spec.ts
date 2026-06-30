import { TestBed } from '@angular/core/testing';
import { AppStateService } from './app-state.service';
import { TauriBridgeService } from './tauri-bridge.service';
import { ConfigService } from './config.service';
import { encodeBlock } from './wiki-format';
import { Link, DevError } from '../models';

// Must match the private markers in app-state.service.ts.
const LINKS_MARKER_V2 = 'nexus-git:links:v2';
const ERRORS_MARKER_V2 = 'nexus-git:errors:v2';

function linksWikiContent(payload: { sprints?: string[]; links?: Link[]; deletedKeys?: string[] }): string {
  const data = { sprints: [], links: [], deletedKeys: [], ...payload };
  return `<!-- ${LINKS_MARKER_V2} ${encodeBlock(data)} -->\n# Relatório Vínculos`;
}

function errorsWikiContent(payload: { groups?: string[]; errors?: DevError[]; deletedIds?: string[] }): string {
  const data = { groups: [], errors: [], deletedIds: [], ...payload };
  return `<!-- ${ERRORS_MARKER_V2} ${encodeBlock(data)} -->\n# Relatório Erros`;
}

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-02T00:00:00.000Z';

function makeLink(overrides: Partial<Link>): Link {
  return {
    projectId: 'p1', issueIid: 1, issueTitle: 'Issue', branchNames: ['b1'],
    sprintName: 's1', createdAt: T0, updatedAt: T0, ...overrides,
  };
}

function makeError(overrides: Partial<DevError>): DevError {
  return {
    id: 'e1', projectId: 'p1', description: 'desc', status: 'Pendente',
    createdAt: T0, updatedAt: T0, ...overrides,
  };
}

describe('AppStateService — merge LWW', () => {
  let service: AppStateService;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        AppStateService,
        {
          provide: TauriBridgeService,
          useValue: { loadState: () => Promise.resolve({}), saveState: () => Promise.resolve() },
        },
        { provide: ConfigService, useValue: { config: () => ({ projects: [{ id: 'p1' }, { id: 'p2' }] }) } },
      ],
    });
    service = TestBed.inject(AppStateService);
    await service.load();
  });

  describe('mergeLinksFromMarkdown', () => {
    it('updates the local link when the wiki version is newer and changed', async () => {
      service.links.set([makeLink({ issueIid: 10, sprintName: 's1', updatedAt: T0 })]);
      const content = linksWikiContent({ links: [makeLink({ issueIid: 10, sprintName: 's2', updatedAt: T1 })] });

      await service.mergeLinksFromMarkdown(content, 'p1');

      const link = service.links().find(l => l.issueIid === 10);
      expect(link?.sprintName).toBe('s2');
    });

    it('preserves the local link when it is newer than the wiki version', async () => {
      service.links.set([makeLink({ issueIid: 11, sprintName: 'local-newer', updatedAt: T1 })]);
      const content = linksWikiContent({ links: [makeLink({ issueIid: 11, sprintName: 'wiki-older', updatedAt: T0 })] });

      await service.mergeLinksFromMarkdown(content, 'p1');

      const link = service.links().find(l => l.issueIid === 11);
      expect(link?.sprintName).toBe('local-newer');
    });

    it('adds a link that exists only in the wiki', async () => {
      const content = linksWikiContent({ links: [makeLink({ issueIid: 20 })] });

      await service.mergeLinksFromMarkdown(content, 'p1');

      expect(service.links().some(l => l.issueIid === 20 && l.projectId === 'p1')).toBeTrue();
    });

    it('keeps a locally-removed link removed even if the wiki still has it', async () => {
      service.links.set([makeLink({ issueIid: 30 })]);
      await service.removeLink(30, 'p1');

      const content = linksWikiContent({ links: [makeLink({ issueIid: 30, updatedAt: T1 })] });
      await service.mergeLinksFromMarkdown(content, 'p1');

      expect(service.links().some(l => l.issueIid === 30)).toBeFalse();
    });

    it('absorbs a wiki tombstone for an item not present locally, preventing it from reappearing later', async () => {
      const absorb = linksWikiContent({ deletedKeys: ['p1:40'] });
      await service.mergeLinksFromMarkdown(absorb, 'p1');

      const staleReappearance = linksWikiContent({ links: [makeLink({ issueIid: 40 })] });
      await service.mergeLinksFromMarkdown(staleReappearance, 'p1');

      expect(service.links().some(l => l.issueIid === 40)).toBeFalse();
    });

    it('isolates merges by project — merging project p1 does not touch project p2 links with the same issueIid', async () => {
      service.links.set([
        makeLink({ projectId: 'p1', issueIid: 1, sprintName: 'p1-local' }),
        makeLink({ projectId: 'p2', issueIid: 1, sprintName: 'p2-local' }),
      ]);
      const content = linksWikiContent({ links: [makeLink({ projectId: 'p1', issueIid: 1, sprintName: 'p1-from-wiki', updatedAt: T1 })] });

      await service.mergeLinksFromMarkdown(content, 'p1');

      const p1Link = service.links().find(l => l.projectId === 'p1' && l.issueIid === 1);
      const p2Link = service.links().find(l => l.projectId === 'p2' && l.issueIid === 1);
      expect(p1Link?.sprintName).toBe('p1-from-wiki');
      expect(p2Link?.sprintName).toBe('p2-local');
    });
  });

  describe('mergeErrorsFromMarkdown', () => {
    it('updates the local error when the wiki version is newer and changed', async () => {
      service.errors.set([makeError({ id: 'e10', description: 'old', updatedAt: T0 })]);
      const content = errorsWikiContent({ errors: [makeError({ id: 'e10', description: 'new', updatedAt: T1 })] });

      await service.mergeErrorsFromMarkdown(content, 'p1');

      expect(service.errors().find(e => e.id === 'e10')?.description).toBe('new');
    });

    it('preserves the local error when it is newer than the wiki version', async () => {
      service.errors.set([makeError({ id: 'e11', description: 'local-newer', updatedAt: T1 })]);
      const content = errorsWikiContent({ errors: [makeError({ id: 'e11', description: 'wiki-older', updatedAt: T0 })] });

      await service.mergeErrorsFromMarkdown(content, 'p1');

      expect(service.errors().find(e => e.id === 'e11')?.description).toBe('local-newer');
    });

    it('keeps a locally-removed error removed even if the wiki still has it', async () => {
      service.errors.set([makeError({ id: 'e30' })]);
      await service.removeError('e30');

      const content = errorsWikiContent({ errors: [makeError({ id: 'e30', updatedAt: T1 })] });
      await service.mergeErrorsFromMarkdown(content, 'p1');

      expect(service.errors().some(e => e.id === 'e30')).toBeFalse();
    });

    it('does NOT scope the merge by projectId — a same-id error from another project gets reassigned (documents current behavior)', async () => {
      // Unlike mergeLinksFromMarkdown, this function builds its local map from ALL errors
      // regardless of project, so an id collision across projects silently reassigns ownership.
      service.errors.set([makeError({ id: 'shared-id', projectId: 'p2', description: 'from p2', updatedAt: T0 })]);
      const content = errorsWikiContent({ errors: [makeError({ id: 'shared-id', projectId: 'p1', description: 'from p1 wiki', updatedAt: T1 })] });

      await service.mergeErrorsFromMarkdown(content, 'p1');

      const merged = service.errors().find(e => e.id === 'shared-id');
      expect(merged?.projectId).toBe('p1');
      expect(merged?.description).toBe('from p1 wiki');
    });
  });
});

describe('AppStateService — legacy tombstone migration', () => {
  let service: AppStateService;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        AppStateService,
        {
          provide: TauriBridgeService,
          useValue: { loadState: () => Promise.resolve({ deletedLinkIids: [99] }), saveState: () => Promise.resolve() },
        },
        { provide: ConfigService, useValue: { config: () => ({ projects: [{ id: 'p1' }] }) } },
      ],
    });
    service = TestBed.inject(AppStateService);
    await service.load();
  });

  it('migrates legacy iid-only tombstones to the default project composite key', async () => {
    const content = linksWikiContent({ links: [makeLink({ projectId: 'p1', issueIid: 99, updatedAt: T1 })] });
    await service.mergeLinksFromMarkdown(content, 'p1');

    expect(service.links().some(l => l.issueIid === 99)).toBeFalse();
  });
});
