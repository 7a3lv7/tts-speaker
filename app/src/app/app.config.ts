import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideNzI18n, zh_CN } from 'ng-zorro-antd/i18n';

export const appConfig: ApplicationConfig = {
  providers: [provideBrowserGlobalErrorListeners(), provideNzI18n(zh_CN)]
};
