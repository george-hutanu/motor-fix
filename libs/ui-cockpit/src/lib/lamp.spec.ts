import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Lamp } from './lamp';

@Component({
  imports: [Lamp],
  template: `<mf-lamp [state]="state()" label="Lucrează pe Dacia" [pulse]="pulse()" />`,
})
class Host {
  readonly state = signal<string>('green');
  readonly pulse = signal(false);
}

@Component({ imports: [Lamp], template: '<mf-lamp state="red" />' })
class Unlabelled {}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const lamp = (fixture.nativeElement as HTMLElement).querySelector(
    'mf-lamp',
  ) as HTMLElement;
  const set = (state: string, pulse = false) => {
    fixture.componentInstance.state.set(state);
    fixture.componentInstance.pulse.set(pulse);
    fixture.detectChanges();
  };
  return { lamp, set };
}

afterEach(() => jest.restoreAllMocks());

describe('Lamp', () => {
  it('shows a dot hidden from screen readers and the label beside it', () => {
    const { lamp } = render();
    const dot = lamp.querySelector('.mf-lamp-dot');

    expect(lamp.getAttribute('data-state')).toBe('green');
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
    expect(lamp.textContent?.trim()).toBe('Lucrează pe Dacia');
    expect(dot?.textContent).toBe('');
  });

  it('takes each of the four states', () => {
    const { lamp, set } = render();

    for (const state of ['green', 'red', 'amber', 'grey']) {
      set(state);
      expect(lamp.getAttribute('data-state')).toBe(state);
    }
  });

  it('shows an unknown state as grey and warns once in development', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { lamp, set } = render();

    set('purple');

    expect(lamp.getAttribute('data-state')).toBe('grey');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('purple');
  });

  it('marks a pulsing lamp without animating it', () => {
    const { lamp, set } = render();
    expect(lamp.hasAttribute('data-pulse')).toBe(false);

    set('amber', true);

    expect(lamp.hasAttribute('data-pulse')).toBe(true);
  });

  it('refuses to render without a label', () => {
    const fixture = TestBed.createComponent(Unlabelled);

    expect(() => fixture.detectChanges()).toThrow(/NG0950/);
  });
});

describe('lamp colours', () => {
  const css = readFileSync(join(__dirname, '../styles/cockpit.css'), 'utf8');
  const lampCss = readFileSync(join(__dirname, 'lamp.ts'), 'utf8');

  const block = (source: string) => {
    const tokens = new Map<string, string>();
    for (const [, name, value] of source.matchAll(
      /(--mf-[\w-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi,
    ))
      tokens.set(name, value);
    return tokens;
  };
  const lightStart = css.indexOf('@media (prefers-color-scheme: light)');
  const themes = {
    dark: block(css.slice(0, lightStart)),
    light: new Map([
      ...block(css.slice(0, lightStart)),
      ...block(css.slice(lightStart, css.indexOf('body {'))),
    ]),
  };

  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  const stateToken = (state: string) => {
    const match = new RegExp(
      `data-state=['"]?${state}['"]?\\]\\)?\\s*\\{[^}]*--mf-lamp-colour:\\s*var\\((--mf-[\\w-]+)\\)`,
    ).exec(lampCss);
    if (!match) throw new Error(`no colour token for ${state}`);
    return match[1];
  };

  const surfaces = ['--mf-bg', '--mf-panel', '--mf-panel-raised'];

  for (const [name, tokens] of Object.entries(themes)) {
    it(`gives every dot 3:1 and the label 4.5:1 on each surface in ${name}`, () => {
      for (const surface of surfaces) {
        const ground = tokens.get(surface) as string;
        for (const state of ['green', 'red', 'amber', 'grey']) {
          const dot = tokens.get(stateToken(state)) as string;
          expect([state, surface, contrast(dot, ground) >= 3]).toEqual([
            state,
            surface,
            true,
          ]);
        }
        expect(
          contrast(tokens.get('--mf-text') as string, ground),
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
