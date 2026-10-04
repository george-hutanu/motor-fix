import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { PublicTabBar } from './tab-bar';

// Full height, so the sticky bar sits at the bottom of a short page too.
@Component({
  imports: [RouterOutlet, PublicTabBar],
  selector: 'mf-public-frame',
  styles: `
    :host { display: flex; flex-direction: column; min-height: 100dvh; }
    main { flex: 1 0 auto; }
  `,
  template: '<main><router-outlet /></main><mf-public-tab-bar />',
})
export class PublicFrame {}
