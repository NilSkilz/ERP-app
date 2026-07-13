import 'zone.js';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

// Studio theme is dark-only — engage PrimeNG's dark mode at the root before
// Angular bootstraps so first paint already has the right scheme.
document.documentElement.classList.add('dark');

console.log('[renderer] main.ts loaded — bootstrapping Angular');

bootstrapApplication(AppComponent, appConfig)
  .then(() => console.log('[renderer] bootstrap complete'))
  .catch((err: unknown) => {
    console.error('[renderer] bootstrap failed', err);
    document.body.innerHTML =
      `<pre style="padding:1rem;color:#b91c1c;white-space:pre-wrap;">Bootstrap failed:\n${
        err instanceof Error ? err.stack ?? err.message : String(err)
      }</pre>`;
  });
