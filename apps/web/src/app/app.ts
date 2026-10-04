import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  imports: [RouterOutlet],
  selector: 'mf-root',
  template: '<router-outlet />',
})
export class App {}
