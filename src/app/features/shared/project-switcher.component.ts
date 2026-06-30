import { Component, inject } from '@angular/core';
import { SyncStore } from '../../core/sync.store';

/** Active-project pill switcher — shared by Vínculos and Erros, the two tabs that operate on
 *  a single "active" project at a time (unlike Sync, which shows all projects in sections). */
@Component({
  selector: 'app-project-switcher',
  template: `
    @if (syncStore.enabledProjects().length > 1) {
      <div class="flex items-center gap-1 px-8 py-2 border-b border-gray-800/60 bg-gray-950/40 shrink-0">
        @for (project of syncStore.enabledProjects(); track project.id) {
          <button
            (click)="syncStore.setActiveProject(project.id)"
            class="px-3 py-1 text-xs rounded-md transition-colors
                   {{ syncStore.activeProject()?.id === project.id
                      ? 'bg-indigo-600/30 border border-indigo-500/50 text-indigo-300'
                      : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800' }}">
            {{ project.name }}
          </button>
        }
      </div>
    }
  `,
})
export class ProjectSwitcherComponent {
  protected syncStore = inject(SyncStore);
}
