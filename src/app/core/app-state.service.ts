import { inject, Injectable, signal } from '@angular/core';
import { TauriBridgeService } from './tauri-bridge.service';
import { ConfigService } from './config.service';
import { Link, DevError, ErrorStatus, AppState, LinkDiffPreview, ErrorDiffPreview, ProjectConfig } from '../models';
import { WIKI_TITLE_LINKS, WIKI_TITLE_ERRORS } from './wiki-constants';
import { encodeBlock, extractBlock, escapeCell } from './wiki-format';
import { computeImportDiff, computePublishDiff } from './diff-utils';

interface WikiLinksData {
  projectId?: string;
  sprints: string[];
  links: Link[];
  deletedKeys?: string[];
  deletedIids?: number[];   // legacy
}

interface WikiErrorsData {
  projectId?: string;
  groups: string[];
  errors: DevError[];
  deletedIds?: string[];
}

const LINKS_MARKER_V2 = 'nexus-git:links:v2';
const ERRORS_MARKER_V2 = 'nexus-git:errors:v2';
const LINKS_MARKER_V1 = 'nexus-git:links:v1';
const ERRORS_MARKER_V1 = 'nexus-git:errors:v1';

@Injectable({ providedIn: 'root' })
export class AppStateService {
  private bridge = inject(TauriBridgeService);
  private configService = inject(ConfigService);

  readonly links = signal<Link[]>([]);
  readonly errors = signal<DevError[]>([]);
  readonly sprints = signal<string[]>([]);
  readonly errorGroups = signal<string[]>([]);

  private _loaded = false;
  /** Composite tombstone keys: "projectId:issueIid". */
  private _deletedLinkKeys = new Set<string>();
  private _deletedErrorIds = new Set<string>();

  private linkKey(projectId: string, issueIid: number): string {
    return `${projectId}:${issueIid}`;
  }

  reset() {
    this.links.set([]);
    this.errors.set([]);
    this.sprints.set([]);
    this.errorGroups.set([]);
    this._deletedLinkKeys = new Set();
    this._deletedErrorIds = new Set();
    this._loaded = false;
  }

  async load() {
    if (this._loaded) return;
    const state = await this.bridge.loadState();
    const defaultProjectId = this.configService.config()?.projects[0]?.id ?? '';

    // Backfill projectId on legacy items (no projectId field)
    const links = (state.links ?? []).map(l =>
      l.projectId ? l : { ...l, projectId: defaultProjectId }
    );
    const errors = (state.errors ?? []).map(e =>
      e.projectId ? e : { ...e, projectId: defaultProjectId }
    );

    this.links.set(links);
    this.errors.set(errors);
    this.sprints.set(state.sprints ?? []);
    this.errorGroups.set(state.errorGroups ?? []);

    // Load composite tombstone keys
    this._deletedLinkKeys = new Set(state.deletedLinkKeys ?? []);

    // Migrate legacy iid-only tombstones → composite keys using defaultProjectId
    if (defaultProjectId) {
      for (const iid of (state.deletedLinkIids ?? [])) {
        this._deletedLinkKeys.add(this.linkKey(defaultProjectId, iid));
      }
    }

    this._deletedErrorIds = new Set(state.deletedErrorIds ?? []);
    this._loaded = true;
  }

  private snapshot(): AppState {
    return {
      links: this.links(),
      errors: this.errors(),
      sprints: this.sprints(),
      errorGroups: this.errorGroups(),
      deletedLinkKeys: Array.from(this._deletedLinkKeys),
      deletedErrorIds: Array.from(this._deletedErrorIds),
    };
  }

  private async persist() {
    await this.bridge.saveState(this.snapshot());
  }

  // ── Sprints ──────────────────────────────────────────────────────────────
  async addSprint(name: string) {
    const trimmed = name.trim();
    if (!trimmed || this.sprints().includes(trimmed)) return;
    this.sprints.update(s => [...s, trimmed]);
    await this.persist();
  }

  async renameSprint(oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed) return;
    this.sprints.update(s => s.map(x => x === oldName ? trimmed : x));
    this.links.update(l => l.map(x => x.sprintName === oldName ? { ...x, sprintName: trimmed } : x));
    await this.persist();
  }

  async removeSprint(name: string) {
    this.sprints.update(s => s.filter(x => x !== name));
    const now = new Date().toISOString();
    this.links.update(l => l.map(x => x.sprintName === name ? { ...x, sprintName: '', updatedAt: now } : x));
    await this.persist();
  }

  async moveSprint(name: string, direction: 'up' | 'down') {
    const arr = [...this.sprints()];
    const i = arr.indexOf(name);
    if (i < 0) return;
    const j = direction === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    this.sprints.set(arr);
    await this.persist();
  }

  // ── Error Groups ─────────────────────────────────────────────────────────
  async addErrorGroup(name: string) {
    const trimmed = name.trim();
    if (!trimmed || this.errorGroups().includes(trimmed)) return;
    this.errorGroups.update(g => [...g, trimmed]);
    await this.persist();
  }

  async renameErrorGroup(oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed) return;
    this.errorGroups.update(g => g.map(x => x === oldName ? trimmed : x));
    this.errors.update(e => e.map(x => x.groupName === oldName ? { ...x, groupName: trimmed } : x));
    await this.persist();
  }

  async removeErrorGroup(name: string) {
    this.errorGroups.update(g => g.filter(x => x !== name));
    await this.persist();
  }

  // ── Links ─────────────────────────────────────────────────────────────────
  async addLink(issueIid: number, issueTitle: string, branchNames: string[], sprintName: string, projectId: string) {
    const key = this.linkKey(projectId, issueIid);
    const existing = this.links().findIndex(l => l.projectId === projectId && l.issueIid === issueIid);
    const now = new Date().toISOString();
    if (existing >= 0) {
      const updated = [...this.links()];
      const merged = Array.from(new Set([...updated[existing].branchNames, ...branchNames]));
      updated[existing] = { ...updated[existing], branchNames: merged, sprintName, updatedAt: now };
      this.links.set(updated);
    } else {
      this._deletedLinkKeys.delete(key);
      this.links.update(l => [...l, { projectId, issueIid, issueTitle, branchNames, sprintName, createdAt: now, updatedAt: now }]);
    }
    await this.persist();
  }

  async removeBranchFromLink(issueIid: number, branchName: string, projectId: string) {
    const now = new Date().toISOString();
    const updated = this.links().map(l =>
      l.projectId === projectId && l.issueIid === issueIid
        ? { ...l, branchNames: l.branchNames.filter(b => b !== branchName), updatedAt: now }
        : l
    );
    for (const l of updated) {
      if (l.projectId === projectId && l.issueIid === issueIid && l.branchNames.length === 0) {
        this._deletedLinkKeys.add(this.linkKey(projectId, issueIid));
      }
    }
    this.links.set(updated.filter(l => !(l.projectId === projectId && l.issueIid === issueIid && l.branchNames.length === 0)));
    await this.persist();
  }

  async removeLink(issueIid: number, projectId: string) {
    this._deletedLinkKeys.add(this.linkKey(projectId, issueIid));
    this.links.update(l => l.filter(x => !(x.projectId === projectId && x.issueIid === issueIid)));
    await this.persist();
  }

  async moveLink(issueIid: number, sprintName: string, projectId: string) {
    const now = new Date().toISOString();
    this.links.update(l => l.map(x =>
      x.projectId === projectId && x.issueIid === issueIid ? { ...x, sprintName, updatedAt: now } : x
    ));
    await this.persist();
  }

  async mergeCsvLinks(rows: { issueIid: number; issueTitle: string; branchNames: string[]; sprintName: string }[], projectId: string): Promise<{ added: number; updated: number }> {
    const now = new Date().toISOString();
    let added = 0, updated = 0;
    const otherLinks = this.links().filter(l => l.projectId !== projectId);
    const map = new Map(this.links().filter(l => l.projectId === projectId).map(l => [l.issueIid, l]));
    for (const row of rows) {
      this._deletedLinkKeys.delete(this.linkKey(projectId, row.issueIid));
      const existing = map.get(row.issueIid);
      if (existing) {
        map.set(row.issueIid, { ...existing, branchNames: row.branchNames, sprintName: row.sprintName, updatedAt: now });
        updated++;
      } else {
        map.set(row.issueIid, { projectId, issueIid: row.issueIid, issueTitle: row.issueTitle, branchNames: row.branchNames, sprintName: row.sprintName, createdAt: now, updatedAt: now });
        added++;
      }
    }
    this.links.set([...otherLinks, ...Array.from(map.values())]);
    await this.persist();
    return { added, updated };
  }

  // ── Errors ───────────────────────────────────────────────────────────────
  async addError(description: string, branchRef: string, status: ErrorStatus, projectId: string, groupName?: string, reportedBy?: string, resolutionBranch?: string, resolutionDescription?: string) {
    const now = new Date().toISOString();
    this.errors.update(e => [...e, {
      id: crypto.randomUUID(),
      projectId,
      description, status,
      branchRef: branchRef || undefined,
      groupName: groupName || undefined,
      reportedBy: reportedBy || undefined,
      resolutionBranch: resolutionBranch || undefined,
      resolutionDescription: resolutionDescription || undefined,
      createdAt: now, updatedAt: now,
    }]);
    await this.persist();
  }

  async updateError(id: string, patch: Partial<Pick<DevError, 'description' | 'branchRef' | 'status' | 'groupName' | 'reportedBy' | 'resolutionBranch' | 'resolutionDescription'>>) {
    this.errors.update(list => list.map(e =>
      e.id === id ? { ...e, ...patch, updatedAt: new Date().toISOString() } : e
    ));
    await this.persist();
  }

  async removeError(id: string) {
    this._deletedErrorIds.add(id);
    this.errors.update(e => e.filter(x => x.id !== id));
    await this.persist();
  }

  async mergeCsvErrors(rows: { id: string; description: string; branchRef: string; status: ErrorStatus; groupName: string; reportedBy: string; resolutionBranch: string; resolutionDescription: string }[], projectId: string): Promise<{ added: number; updated: number }> {
    const now = new Date().toISOString();
    let added = 0, updated = 0;
    const map = new Map(this.errors().map(e => [e.id, e]));
    for (const row of rows) {
      if (!row.description.trim()) continue;
      const id = row.id || crypto.randomUUID();
      this._deletedErrorIds.delete(id);
      const existing = map.get(id);
      const entry: DevError = {
        id, projectId,
        description: row.description,
        status: row.status,
        branchRef: row.branchRef || undefined,
        groupName: row.groupName || undefined,
        reportedBy: row.reportedBy || undefined,
        resolutionBranch: row.resolutionBranch || undefined,
        resolutionDescription: row.resolutionDescription || undefined,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      map.set(id, entry);
      if (existing) updated++; else added++;
    }
    this.errors.set(Array.from(map.values()));
    await this.persist();
    return { added, updated };
  }

  // ── Wiki export ──────────────────────────────────────────────────────────
  buildLinksMarkdown(projectId: string): string {
    const projectLinks = this.links().filter(l => l.projectId === projectId);
    const deletedKeys = Array.from(this._deletedLinkKeys).filter(k => k.startsWith(`${projectId}:`));
    const data: WikiLinksData = {
      projectId,
      sprints: this.sprints(),
      links: projectLinks,
      deletedKeys,
    };

    const lines: string[] = [
      `<!-- ${LINKS_MARKER_V2} ${encodeBlock(data)} -->`,
      '',
      `# ${WIKI_TITLE_LINKS}`,
      '',
      `_Atualizado em: ${new Date().toLocaleString('pt-BR')} via Nexus-Git_`,
      '',
      '---',
    ];

    const sprints = this.sprints();
    const noSprint = projectLinks.filter(l => !sprints.includes(l.sprintName));

    for (const sprint of sprints) {
      const sprintLinks = projectLinks.filter(l => l.sprintName === sprint);
      if (!sprintLinks.length) continue;
      lines.push('', `## ${sprint}`, '');
      lines.push('| Card | Título | Branches |');
      lines.push('|------|--------|---------|');
      for (const l of sprintLinks) {
        const branches = l.branchNames.map(b => `\`${b}\``).join(', ');
        lines.push(`| #${l.issueIid} | ${escapeCell(l.issueTitle)} | ${branches} |`);
      }
    }

    if (noSprint.length) {
      lines.push('', '## Sem sprint', '');
      lines.push('| Card | Título | Branches |');
      lines.push('|------|--------|---------|');
      for (const l of noSprint) {
        const branches = l.branchNames.map(b => `\`${b}\``).join(', ');
        lines.push(`| #${l.issueIid} | ${escapeCell(l.issueTitle)} | ${branches} |`);
      }
    }

    return lines.join('\n');
  }

  buildErrorsMarkdown(projectId: string): string {
    const projectErrors = this.errors().filter(e => e.projectId === projectId);
    const data: WikiErrorsData = {
      projectId,
      groups: this.errorGroups(),
      errors: projectErrors,
      deletedIds: Array.from(this._deletedErrorIds),
    };

    const lines: string[] = [
      `<!-- ${ERRORS_MARKER_V2} ${encodeBlock(data)} -->`,
      '',
      `# ${WIKI_TITLE_ERRORS}`,
      '',
      `_Atualizado em: ${new Date().toLocaleString('pt-BR')} via Nexus-Git_`,
      '',
      '---',
    ];

    const groups = this.errorGroups();
    const noGroup = projectErrors.filter(e => !e.groupName || !groups.includes(e.groupName));

    const renderGroup = (errors: DevError[]) => {
      lines.push('| Descrição | Branch | Status | Reportado por | Data |');
      lines.push('|-----------|--------|--------|---------------|------|');
      for (const e of errors) {
        const branch = e.branchRef ? `\`${e.branchRef}\`` : '—';
        const date = new Date(e.createdAt).toLocaleDateString('pt-BR');
        const reporter = e.reportedBy ? escapeCell(e.reportedBy) : '—';
        lines.push(`| ${escapeCell(e.description)} | ${branch} | ${e.status} | ${reporter} | ${date} |`);
      }
    };

    for (const group of groups) {
      const groupErrors = projectErrors.filter(e => e.groupName === group);
      if (!groupErrors.length) continue;
      lines.push('', `## ${group}`, '');
      renderGroup(groupErrors);
    }

    if (noGroup.length) {
      lines.push('', '## Sem grupo', '');
      renderGroup(noGroup);
    }

    return lines.join('\n');
  }

  // ── Wiki import / merge ──────────────────────────────────────────────────

  parseLinksMarkdown(content: string): { links: Link[]; sprints: string[] } | null {
    const data = extractBlock<WikiLinksData>(content, LINKS_MARKER_V2, LINKS_MARKER_V1);
    if (!data) return null;
    return { links: data.links ?? [], sprints: data.sprints ?? [] };
  }

  parseErrorsMarkdown(content: string): { errors: DevError[]; groups: string[] } | null {
    const data = extractBlock<WikiErrorsData>(content, ERRORS_MARKER_V2, ERRORS_MARKER_V1);
    if (!data) return null;
    return { errors: data.errors ?? [], groups: data.groups ?? [] };
  }

  /**
   * Pulls the existing wiki page (merging it in first, LWW), then builds and pushes the
   * current local state. Shared by the manual Publish flow and the auto-publish timer.
   */
  async publishProjectKind(
    project: ProjectConfig,
    kind: 'links' | 'errors',
    baseUrl: string,
    token: string,
    signal?: AbortSignal,
  ): Promise<{ count: number; wikiCount: number | null }> {
    const slug = kind === 'links' ? project.linksSlug : project.errorsSlug;
    const title = kind === 'links' ? WIKI_TITLE_LINKS : WIKI_TITLE_ERRORS;

    const existing = await this.bridge.fetchWikiPage(baseUrl, token, project.wikiProjectPath, slug, title);
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

    let wikiCount: number | null = null;
    if (existing) {
      wikiCount = kind === 'links'
        ? (this.parseLinksMarkdown(existing)?.links.length ?? 0)
        : (this.parseErrorsMarkdown(existing)?.errors.length ?? 0);
      if (kind === 'links') await this.mergeLinksFromMarkdown(existing, project.id);
      else await this.mergeErrorsFromMarkdown(existing, project.id);
    }

    const content = kind === 'links'
      ? this.buildLinksMarkdown(project.id)
      : this.buildErrorsMarkdown(project.id);

    // Never push to the Wiki once a cancellation (e.g. logout) has reset local state mid-cycle —
    // would otherwise overwrite real published data with whatever the now-cleared signals built.
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    await this.bridge.pushWikiPage(baseUrl, token, project.wikiProjectPath, slug, title, content);

    const count = kind === 'links'
      ? this.links().filter(l => l.projectId === project.id).length
      : this.errors().filter(e => e.projectId === project.id).length;

    return { count, wikiCount };
  }

  private linkChanged(local: Link, wiki: Link): boolean {
    return local.sprintName !== wiki.sprintName ||
      [...local.branchNames].sort().join(',') !== [...wiki.branchNames].sort().join(',');
  }

  previewLinkImport(content: string, projectId: string): LinkDiffPreview | null {
    const data = extractBlock<WikiLinksData>(content, LINKS_MARKER_V2, LINKS_MARKER_V1);
    if (!data) return null;

    const localMap = new Map(
      this.links().filter(l => l.projectId === projectId).map(l => [l.issueIid, l])
    );
    const { toAdd, toUpdate } = computeImportDiff(
      data.links ?? [],
      localMap,
      l => l.issueIid,
      l => new Date(l.updatedAt || l.createdAt).getTime(),
      this.linkChanged,
      l => ({ ...l, projectId }),
    );

    return { toAdd, toUpdate, toRemove: [] };
  }

  previewLinkPublish(wikiContent: string | null, projectId: string): LinkDiffPreview {
    const projectLinks = this.links().filter(l => l.projectId === projectId);
    if (!wikiContent) return { toAdd: [...projectLinks], toUpdate: [], toRemove: [] };

    const wikiData = extractBlock<WikiLinksData>(wikiContent, LINKS_MARKER_V2, LINKS_MARKER_V1);
    if (!wikiData) return { toAdd: [...projectLinks], toUpdate: [], toRemove: [] };

    const wikiMap = new Map((wikiData.links ?? []).map(l => [l.issueIid, l]));
    return computePublishDiff(
      projectLinks,
      wikiMap,
      l => l.issueIid,
      this.linkChanged,
      l => ({ ...l, projectId }),
    );
  }

  async importLinksFromMarkdown(content: string, projectId: string): Promise<boolean> {
    const data = extractBlock<WikiLinksData>(content, LINKS_MARKER_V2, LINKS_MARKER_V1);
    if (data?.links) {
      for (const link of data.links) {
        this._deletedLinkKeys.delete(this.linkKey(projectId, link.issueIid));
      }
    }
    return this.mergeLinksFromMarkdown(content, projectId);
  }

  private errorChanged(local: DevError, wiki: DevError): boolean {
    return local.description !== wiki.description ||
      local.status !== wiki.status ||
      local.branchRef !== wiki.branchRef ||
      local.groupName !== wiki.groupName ||
      local.reportedBy !== wiki.reportedBy;
  }

  previewErrorImport(content: string, projectId: string): ErrorDiffPreview | null {
    const data = extractBlock<WikiErrorsData>(content, ERRORS_MARKER_V2, ERRORS_MARKER_V1);
    if (!data) return null;

    const localMap = new Map(this.errors().map(e => [e.id, e]));
    const { toAdd, toUpdate } = computeImportDiff(
      data.errors ?? [],
      localMap,
      e => e.id,
      e => new Date(e.updatedAt).getTime(),
      this.errorChanged,
      e => ({ ...e, projectId }),
    );

    return { toAdd, toUpdate, toRemove: [] };
  }

  previewErrorPublish(wikiContent: string | null, projectId: string): ErrorDiffPreview {
    const projectErrors = this.errors().filter(e => e.projectId === projectId);
    if (!wikiContent) return { toAdd: [...projectErrors], toUpdate: [], toRemove: [] };

    const wikiData = extractBlock<WikiErrorsData>(wikiContent, ERRORS_MARKER_V2, ERRORS_MARKER_V1);
    if (!wikiData) return { toAdd: [...projectErrors], toUpdate: [], toRemove: [] };

    const wikiMap = new Map((wikiData.errors ?? []).map(e => [e.id, e]));
    return computePublishDiff(
      projectErrors,
      wikiMap,
      e => e.id,
      this.errorChanged,
      e => ({ ...e, projectId }),
    );
  }

  async importErrorsFromMarkdown(content: string, projectId: string): Promise<boolean> {
    const data = extractBlock<WikiErrorsData>(content, ERRORS_MARKER_V2, ERRORS_MARKER_V1);
    if (data?.errors) {
      for (const err of data.errors) this._deletedErrorIds.delete(err.id);
    }
    return this.mergeErrorsFromMarkdown(content, projectId);
  }

  async mergeLinksFromMarkdown(content: string, projectId: string): Promise<boolean> {
    const data = extractBlock<WikiLinksData>(content, LINKS_MARKER_V2, LINKS_MARKER_V1);
    if (!data) return false;

    // Only operate on links for this project
    const otherLinks = this.links().filter(l => l.projectId !== projectId);
    const localMap = new Map(
      this.links().filter(l => l.projectId === projectId).map(l => [l.issueIid, l])
    );

    // Absorb wiki tombstones for this project
    for (const key of (data.deletedKeys ?? [])) {
      const [kPid, kIid] = key.split(':');
      if (kPid === projectId && !localMap.has(Number(kIid))) {
        this._deletedLinkKeys.add(key);
      }
    }
    // Migrate legacy iid-only tombstones from wiki
    for (const iid of (data.deletedIids ?? [])) {
      const key = this.linkKey(projectId, iid);
      if (!localMap.has(iid)) this._deletedLinkKeys.add(key);
    }

    // LWW merge on issueIid (scoped to this project)
    for (const wikiLink of (data.links ?? [])) {
      const key = this.linkKey(projectId, wikiLink.issueIid);
      if (this._deletedLinkKeys.has(key)) continue;
      const local = localMap.get(wikiLink.issueIid);
      if (!local) {
        localMap.set(wikiLink.issueIid, { ...wikiLink, projectId });
      } else {
        const localTime = new Date(local.updatedAt || local.createdAt).getTime();
        const wikiTime = new Date(wikiLink.updatedAt || wikiLink.createdAt).getTime();
        if (wikiTime > localTime) localMap.set(wikiLink.issueIid, { ...wikiLink, projectId });
      }
    }

    // Remove tombstoned entries for this project
    for (const key of this._deletedLinkKeys) {
      const [kPid, kIid] = key.split(':');
      if (kPid === projectId) localMap.delete(Number(kIid));
    }

    // Merge sprints
    const localSprints = this.sprints();
    const wikiOnlySprints = (data.sprints ?? []).filter(s => !localSprints.includes(s));
    this.sprints.set([...localSprints, ...wikiOnlySprints]);
    this.links.set([...otherLinks, ...Array.from(localMap.values())]);
    await this.persist();
    return true;
  }

  async mergeErrorsFromMarkdown(content: string, projectId: string): Promise<boolean> {
    const data = extractBlock<WikiErrorsData>(content, ERRORS_MARKER_V2, ERRORS_MARKER_V1);
    if (!data) return false;

    const localMap = new Map(this.errors().map(e => [e.id, e]));

    for (const id of (data.deletedIds ?? [])) {
      if (!localMap.has(id)) this._deletedErrorIds.add(id);
    }

    for (const wikiErr of (data.errors ?? [])) {
      if (this._deletedErrorIds.has(wikiErr.id)) continue;
      const local = localMap.get(wikiErr.id);
      if (!local) {
        localMap.set(wikiErr.id, { ...wikiErr, projectId });
      } else {
        const localTime = new Date(local.updatedAt).getTime();
        const wikiTime = new Date(wikiErr.updatedAt).getTime();
        if (wikiTime > localTime) localMap.set(wikiErr.id, { ...wikiErr, projectId });
      }
    }

    for (const id of this._deletedErrorIds) localMap.delete(id);

    const localGroups = this.errorGroups();
    const wikiOnlyGroups = (data.groups ?? []).filter(g => !localGroups.includes(g));
    this.errorGroups.set([...localGroups, ...wikiOnlyGroups]);
    this.errors.set(Array.from(localMap.values()));
    await this.persist();
    return true;
  }
}
