import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component.js';

bootstrapApplication(AppComponent).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
});
