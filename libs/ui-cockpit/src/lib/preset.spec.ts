import { CockpitPreset } from './preset';

const preset = CockpitPreset as any;
const semantic = preset.semantic;
const components = preset.components;

const token = (name: string) => `var(--mf-${name})`;

describe('CockpitPreset', () => {
  it('makes the primary colour the amber fill with dark text', () => {
    expect(semantic.primary).toMatchObject({
      activeColor: token('amber-hover'),
      color: token('amber'),
      contrastColor: token('on-amber'),
      hoverColor: token('amber-hover'),
    });
  });

  it('marks the selected state with amber ink on an amber tint', () => {
    expect(semantic.highlight).toEqual({
      background: token('amber-tint'),
      color: token('amber-ink'),
      focusBackground: token('amber-tint'),
      focusColor: token('amber-ink'),
    });
  });

  it('takes surfaces, borders and text from the tokens', () => {
    expect(semantic.content).toMatchObject({
      background: token('panel'),
      borderColor: token('line'),
      color: token('text'),
      hoverBackground: token('panel-raised'),
    });
    expect(semantic.text).toMatchObject({
      color: token('text'),
      mutedColor: token('text-secondary'),
    });
    for (const overlay of ['select', 'popover', 'modal']) {
      expect(semantic.overlay[overlay]).toMatchObject({
        background: token('panel-raised'),
        borderColor: token('line'),
        color: token('text'),
      });
    }
    expect(semantic.overlay.modal.borderRadius).toBe(token('radius-panel'));
    expect(semantic.mask.background).toBe(token('mask'));
  });

  it('styles form fields from the tokens at 16 px', () => {
    expect(semantic.formField).toMatchObject({
      background: token('bg'),
      borderColor: token('line-strong'),
      borderRadius: token('radius-control'),
      color: token('text'),
      focusBorderColor: token('amber-ink'),
      fontSize: token('size-field'),
      placeholderColor: token('text-secondary'),
    });
  });

  it('draws one focus ring from the tokens, fields included', () => {
    const ring = {
      color: token('focus'),
      offset: token('focus-offset'),
      style: 'solid',
      width: token('focus-width'),
    };
    expect(semantic.focusRing).toMatchObject(ring);
    expect(semantic.formField.focusRing).toMatchObject(ring);
  });

  it('offers no smaller size variant', () => {
    expect(semantic.formField.sm).toMatchObject({
      fontSize: '{form.field.font.size}',
      paddingX: '{form.field.padding.x}',
      paddingY: '{form.field.padding.y}',
    });
  });

  it('uses the body size and family for component text', () => {
    expect(semantic.typography).toMatchObject({
      fontFamily: token('font-body'),
      fontSize: token('size-body'),
    });
  });

  it('keeps secondary buttons out of amber', () => {
    const secondary = components.button.root.secondary;
    expect(secondary).toMatchObject({
      background: 'transparent',
      borderColor: token('line-strong'),
      color: token('text'),
    });
    expect(JSON.stringify(secondary)).not.toContain('amber');
  });

  it('marks the active tab in amber ink', () => {
    expect(components.tabs.tab.activeColor).toBe(token('amber-ink'));
    expect(components.tabs.activeBar.background).toBe(token('amber-ink'));
  });

  it('rounds controls with the control radius', () => {
    expect(semantic.content.borderRadius).toBe(token('radius-control'));
  });
});
