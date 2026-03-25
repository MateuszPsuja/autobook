import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: '/settings',
    pathMatch: 'full'
  },
  {
    path: '',
    loadComponent: () => import('./ui/shell/shell.component').then(m => m.ShellComponent),
    children: [
      {
        path: 'settings',
        loadComponent: () => import('./ui/settings/settings.component').then(m => m.SettingsComponent)
      },
      {
        path: 'config',
        loadComponent: () => import('./ui/config/config.component').then(m => m.ConfigComponent)
      },
      {
        path: 'generator',
        loadComponent: () => import('./ui/generator/generator.component').then(m => m.GeneratorComponent)
      },
      {
        path: 'viewer',
        loadComponent: () => import('./ui/viewer/chapter-view.component').then(m => m.ChapterViewComponent)
      },
      {
        path: 'export',
        loadComponent: () => import('./ui/export/export.component').then(m => m.ExportComponent)
      }
    ]
  }
];
