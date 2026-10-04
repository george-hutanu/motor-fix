# Data model: design tokens

No persisted data. The model is the token set in `libs/ui-cockpit/src/styles/cockpit.css`.

## Colour tokens (one value per theme)

| Token | Dark | Light (*proposed*) | Use |
| --- | --- | --- | --- |
| `--mf-bg` | 0B0C0E | F4F4F1 | page background, field background |
| `--mf-panel` | 101215 | FFFFFF | panels, content surfaces |
| `--mf-panel-raised` | 15171A | ECECE8 | raised panels, overlays, hover |
| `--mf-line` | 2A2D31 | D3D5D8 | hairlines |
| `--mf-line-strong` | 4A4E55 | 9A9EA5 | field and secondary-button borders (mock) |
| `--mf-text` | F2F2F0 | 15171A | text |
| `--mf-text-secondary` | B5B8BE | 50545B | secondary text |
| `--mf-amber` | FFB000 | FFB000 | main action fill, toggle on |
| `--mf-amber-hover` | FFC94D | FFC94D | main action hover |
| `--mf-on-amber` | 0B0C0E | 15171A | text on amber |
| `--mf-amber-ink` | FFB000 | 8A5E00 | amber text and lines, selected text |
| `--mf-amber-tint` | amber 10% | amber-ink 10% | selected background |
| `--mf-green` | 32D74B | 1E8E34 | status: works, ok |
| `--mf-red` | FF5A4F | D93A30 | status: problem |
| `--mf-focus` | FFB000 | 8A5E00 | focus ring |
| `--mf-mask` | black 60% | black 40% | modal mask |

Rules: every colour token exists in both sets (FR-004); the print set equals the light set (FR-002).

## Theme-independent tokens

| Group | Tokens |
| --- | --- |
| Type | `--mf-font-label`, `--mf-font-body`, `--mf-size-label` 12px, `--mf-size-small` 13px, `--mf-size-body` 15px, `--mf-size-field` 16px, `--mf-label-tracking` 0.14em |
| Spacing (4 px scale) | `--mf-space-1` 4px, `-2` 8px, `-3` 12px, `-4` 16px, `-5` 20px, `-6` 24px, `-8` 32px |
| Radius | `--mf-radius-panel` 20px, `--mf-radius-control` 12px, `--mf-radius-chip` 10px |
| Focus | `--mf-focus-width` 3px, `--mf-focus-offset` 3px |
| Target | `--mf-tap` 44px |

## Contrast pairs (FR-009)

- 4.5:1 — {`--mf-text`, `--mf-text-secondary`, `--mf-amber-ink`} × {`--mf-bg`, `--mf-panel`, `--mf-panel-raised`}; `--mf-on-amber` on `--mf-amber`.
- 3:1 — {`--mf-green`, `--mf-red`, `--mf-focus`} × {`--mf-bg`, `--mf-panel`, `--mf-panel-raised`}.

## Theme state

`dark | light`, from `prefers-color-scheme`, followed live by the browser; `print` uses light. Not stored, no switch.
