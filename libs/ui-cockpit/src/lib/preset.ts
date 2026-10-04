import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';

const v = (token: string) => `var(--mf-${token})`;

const focusRing = {
  color: v('focus'),
  offset: v('focus-offset'),
  shadow: 'none',
  style: 'solid',
  width: v('focus-width'),
};

const surface = {
  background: v('panel-raised'),
  borderColor: v('line'),
  color: v('text'),
};

// Status colours are under 4.5:1 as text on the light surfaces, so toast text
// stays in the text colour and the icon carries the severity.
const message = {
  ...surface,
  closeButton: {
    focusRing: { color: v('focus'), shadow: 'none' },
    hoverBackground: v('panel'),
  },
  detailColor: v('text-secondary'),
  shadow: 'none',
};

export const CockpitPreset = definePreset(Aura, {
  components: {
    button: {
      root: {
        secondary: {
          activeBackground: v('panel-raised'),
          activeBorderColor: v('text-secondary'),
          activeColor: v('text'),
          background: 'transparent',
          borderColor: v('line-strong'),
          color: v('text'),
          focusRing: { color: v('focus'), shadow: 'none' },
          hoverBackground: v('panel-raised'),
          hoverBorderColor: v('text-secondary'),
          hoverColor: v('text'),
        },
      },
    },
    tabs: {
      activeBar: { background: v('amber-ink') },
      tab: { activeColor: v('amber-ink') },
    },
    toast: {
      error: message,
      info: message,
      success: message,
      warn: message,
    },
  },
  semantic: {
    content: {
      background: v('panel'),
      borderColor: v('line'),
      borderRadius: v('radius-control'),
      color: v('text'),
      hoverBackground: v('panel-raised'),
      hoverColor: v('text'),
    },
    focusRing,
    formField: {
      background: v('bg'),
      borderColor: v('line-strong'),
      borderRadius: v('radius-control'),
      color: v('text'),
      floatLabelColor: v('text-secondary'),
      focusBorderColor: v('amber-ink'),
      focusRing,
      fontSize: v('size-field'),
      hoverBorderColor: v('text-secondary'),
      placeholderColor: v('text-secondary'),
      shadow: 'none',
      sm: {
        fontSize: '{form.field.font.size}',
        paddingX: '{form.field.padding.x}',
        paddingY: '{form.field.padding.y}',
      },
    },
    highlight: {
      background: v('amber-tint'),
      color: v('amber-ink'),
      focusBackground: v('amber-tint'),
      focusColor: v('amber-ink'),
    },
    mask: { background: v('mask') },
    overlay: {
      modal: { ...surface, borderRadius: v('radius-panel') },
      popover: { ...surface, borderRadius: v('radius-control') },
      select: { ...surface, borderRadius: v('radius-control') },
    },
    primary: {
      50: '{amber.50}',
      100: '{amber.100}',
      200: '{amber.200}',
      300: '{amber.300}',
      400: '{amber.400}',
      500: '{amber.500}',
      600: '{amber.600}',
      700: '{amber.700}',
      800: '{amber.800}',
      900: '{amber.900}',
      950: '{amber.950}',
      activeColor: v('amber-hover'),
      color: v('amber'),
      contrastColor: v('on-amber'),
      hoverColor: v('amber-hover'),
    },
    text: {
      color: v('text'),
      hoverColor: v('text'),
      hoverMutedColor: v('text'),
      mutedColor: v('text-secondary'),
    },
    typography: {
      fontFamily: v('font-body'),
      fontSize: v('size-body'),
    },
  },
});
