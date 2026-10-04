import { Component, inject, RESPONSE_INIT } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LanguageSwitch, TranslatePipe } from '@motor-fix/i18n';

@Component({
  imports: [LanguageSwitch, RouterLink, TranslatePipe],
  selector: 'mf-not-found',
  template: `
    <header><mf-language-switch /></header>
    <h1>{{ 'shell.notFound.title' | t }}</h1>
    <p>{{ 'shell.notFound.text' | t }}</p>
    <a routerLink="/">{{ 'shell.notFound.home' | t }}</a>
  `,
})
export class NotFound {
  constructor() {
    // Only the server render provides it; in the browser there is no status to set.
    const response = inject(RESPONSE_INIT, { optional: true });
    if (response) response.status = 404;
  }
}
