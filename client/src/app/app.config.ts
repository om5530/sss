import { environment } from '../environments/environment';
import { saasAccountInterceptor } from './core/interceptors/saas-account.interceptor';
import {
  ApplicationConfig,
  isDevMode,
  provideBrowserGlobalErrorListeners,
  provideAppInitializer,
  inject,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling, withViewTransitions } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { errorInterceptor } from './core/interceptors/error.interceptor';
import { adminActivityInterceptor } from './core/interceptors/admin-activity.interceptor';
import { AuthService } from './core/services/auth.service';
import { AppInstallService } from './core/services/app-install.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' }),
      // Native cross-fade between routes on supporting browsers; no-op elsewhere.
      withViewTransitions(),
    ),
    provideHttpClient(withInterceptors([authInterceptor, saasAccountInterceptor, adminActivityInterceptor, errorInterceptor])),
    provideAppInitializer(() => { if (!environment.saasPreview) inject(AppInstallService); }),
    // Restore an existing session (if any) before the first route renders.
    provideAppInitializer(() => environment.saasPreview ? undefined : inject(AuthService).restoreSession()),
    // PWA: offline app shell + cached menu; only registered in prod builds.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode() && !environment.saasPreview,
      // Register immediately so the browser can expose its full PWA install
      // prompt on the first visit instead of falling back to a shortcut.
      registrationStrategy: 'registerImmediately',
    }),
  ],
};
