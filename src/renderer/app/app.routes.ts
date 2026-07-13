import { Routes } from '@angular/router';

export const appRoutes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./pages/dashboard-page/dashboard-page.component').then(
        (m) => m.DashboardPageComponent
      ),
  },
  {
    path: 'components',
    loadComponent: () =>
      import('./pages/components-page/components-page.component').then(
        (m) => m.ComponentsPageComponent
      ),
  },
  {
    path: 'products',
    loadComponent: () =>
      import('./pages/products-page/products-page.component').then(
        (m) => m.ProductsPageComponent
      ),
  },
  {
    path: 'products/:id',
    loadComponent: () =>
      import('./pages/variant-detail-page/variant-detail-page.component').then(
        (m) => m.VariantDetailPageComponent
      ),
  },
  {
    path: 'make-batch',
    loadComponent: () =>
      import('./pages/make-batch-page/make-batch-page.component').then(
        (m) => m.MakeBatchPageComponent
      ),
  },
  {
    path: 'stock-log',
    loadComponent: () =>
      import('./pages/stock-log-page/stock-log-page.component').then(
        (m) => m.StockLogPageComponent
      ),
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./pages/settings-page/settings-page.component').then(
        (m) => m.SettingsPageComponent
      ),
  },
  { path: '**', redirectTo: 'dashboard' },
];
