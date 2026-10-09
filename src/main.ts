import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { API_URL } from './app/core/api.interceptor';
import { loadTranslations } from './app/core/i18n';

/** public/config.json can be edited on the server after a build, e.g. {"apiUrl": "https://api.example.com"}. */
async function loadApiUrl(): Promise<string> {
  try {
    const config = await (await fetch('config.json', { cache: 'no-store' })).json();
    return String(config.apiUrl ?? '').replace(/\/+$/, '');
  } catch {
    return '';
  }
}

// The API address and the dictionary of the language, then the app.
Promise.all([loadApiUrl(), loadTranslations()])
  .then(([apiUrl]) =>
    bootstrapApplication(App, {
      ...appConfig,
      providers: [...appConfig.providers, { provide: API_URL, useValue: apiUrl }],
    }),
  )
  .catch((err) => console.error(err));
