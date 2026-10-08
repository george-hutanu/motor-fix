// The sweep's measured layout checks: what a reviewer would otherwise judge by
// eye, measured in the page as rendered. `measureLayout` runs inside the
// browser (`page.evaluate(measureLayout, opts)`), so it is one self-contained
// function: nothing it uses may come from this module's scope.
//
// Each observation names the rule, the element (a short selector), what was
// measured and what was expected. The type scale and the theme fonts are read
// from the page's own `--mf-size-*` and `--mf-font-*` custom properties, so the
// check never keeps a copy of the Cockpit tokens.

export const LAYOUT_RULES = ["min-text", "type-scale", "tap-target", "clipped", "overlap", "grid", "stretched-image", "font-fallback", "focus-ring"];

/**
 * @param {{ phone: boolean, tapTargets: boolean, focus: boolean }} opts
 *   phone: hold body text to 16 px; tapTargets: hold controls to 44×44 px;
 *   focus: focus every control to look for a ring (one viewport is enough).
 */
export async function measureLayout({ phone, tapTargets, focus }) {
  const CAP = 20;
  const MAX_CONTROLS = 200;
  const HALF = 0.5;
  const TAP = 44;
  const FLOOR = 12;
  const BODY = 16;
  const FIELD = 16;
  const RUNNING_ROLES = "p, li, td, th, dd, button, a[href], [role=button], [role=link]";
  const CAPTIONS = new Set(["SMALL", "SUB", "SUP"]);
  const FIELDS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
  const CONTROLS = "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=menuitem], [tabindex]:not([tabindex='-1'])";

  const found = new Map();
  const report = (rule, el, measured, expected, selector) => {
    const list = found.get(rule) ?? [];
    found.set(rule, list);
    list.push({ kind: "layout", rule, selector: selector ?? selectorOf(el), measured, expected, text: el ? ownText(el).slice(0, 60) : "" });
  };
  const px = (v) => `${Math.round(v * 10) / 10}px`;
  const near = (v, m) => Math.abs(v - Math.round(v / m) * m) <= HALF;
  const style = (el) => getComputedStyle(el);

  function selectorOf(el) {
    const part = (e) => {
      const tag = e.tagName.toLowerCase();
      if (e.id) return `${tag}#${CSS.escape(e.id)}`;
      const cls = [...e.classList].slice(0, 2).map((c) => `.${CSS.escape(c)}`).join("");
      const same = e.parentElement ? [...e.parentElement.children].filter((c) => c.tagName === e.tagName) : [];
      return `${tag}${cls}${same.length > 1 ? `:nth-of-type(${same.indexOf(e) + 1})` : ""}`;
    };
    const parts = [];
    for (let e = el; e && e !== document.body && e !== document.documentElement && parts.length < 3; e = e.parentElement) {
      parts.unshift(part(e));
      if (e.id) break;
    }
    return parts.join(" > ") || el.tagName.toLowerCase();
  }

  function ownText(el) {
    if (FIELDS.has(el.tagName)) return String(el.value ?? el.placeholder ?? "").trim();
    let text = "";
    for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE) text += n.textContent;
    return text.replace(/\s+/g, " ").trim();
  }

  // Shown to a sighted user: laid out, not hidden, and not a 1 px screen-reader-only box.
  function visible(el) {
    if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    for (let e = el; e; e = e.parentElement) {
      const s = style(e);
      if (s.clip !== "auto" && s.position === "absolute") return false;
    }
    return true;
  }

  const inRunningText = (el) => {
    const parent = el.parentElement;
    if (!parent || style(el).display !== "inline") return false;
    return [...parent.childNodes].some((n) => n !== el && n.nodeType === Node.TEXT_NODE && n.textContent.trim());
  };

  const all = [...document.body.querySelectorAll("*")].filter((el) => !["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "svg"].includes(el.tagName) && visible(el));
  const withText = all.filter((el) => ownText(el));

  // The theme's tokens, as the page resolves them.
  const rootStyle = style(document.documentElement);
  const names = new Set();
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    const walk = (list) => {
      for (const rule of list) {
        if (rule.style) for (const prop of rule.style) if (prop.startsWith("--mf-size-") || prop.startsWith("--mf-font-")) names.add(prop);
        if (rule.cssRules) walk(rule.cssRules);
      }
    };
    walk(rules);
  }
  const sizes = [...names]
    .filter((n) => n.startsWith("--mf-size-"))
    .sort()
    .map((name) => ({ name, value: Number.parseFloat(rootStyle.getPropertyValue(name)) }))
    .filter((t) => Number.isFinite(t.value));
  const fonts = [...names]
    .filter((n) => n.startsWith("--mf-font-"))
    .sort()
    .map((name) => ({ name, families: rootStyle.getPropertyValue(name).split(",").map((f) => f.trim().replace(/^["']|["']$/g, "")) }))
    .filter((t) => t.families[0]);
  const scale = [...new Set(sizes.map((s) => s.value))].sort((a, b) => a - b);

  for (const el of withText) {
    const size = Number.parseFloat(style(el).fontSize);
    // Text under the minimum.
    if (FIELDS.has(el.tagName)) {
      if (size < FIELD - HALF) report("min-text", el, px(size), `${FIELD}px (field)`);
    } else if (size < FLOOR - HALF) report("min-text", el, px(size), `${FLOOR}px`);
    else if (phone && !CAPTIONS.has(el.tagName) && el.closest(RUNNING_ROLES) && size < BODY - HALF && !(el.matches("a[href]") && inRunningText(el)))
      report("min-text", el, px(size), `${BODY}px (phone body)`);
    // Off the type scale.
    if (scale.length && !scale.some((v) => Math.abs(v - size) <= HALF)) report("type-scale", el, px(size), `one of ${scale.map(px).join(", ")}`);
    // Clipped, ellipsised or spilling out of its box.
    const s = style(el);
    const hides = [s.overflowX, s.overflowY].some((o) => o === "hidden" || o === "clip");
    if (hides || s.textOverflow === "ellipsis" || s.webkitLineClamp !== "none") {
      if (el.scrollWidth > el.clientWidth + HALF || el.scrollHeight > el.clientHeight + HALF)
        report("clipped", el, `content ${el.scrollWidth}×${el.scrollHeight}px in ${el.clientWidth}×${el.clientHeight}px`, "fits its box");
    } else if (s.overflowX === "visible" && !FIELDS.has(el.tagName)) {
      const range = document.createRange();
      const box = el.getBoundingClientRect();
      for (const n of el.childNodes) {
        if (n.nodeType !== Node.TEXT_NODE || !n.textContent.trim()) continue;
        range.selectNodeContents(n);
        const t = range.getBoundingClientRect();
        if (t.left < box.left - HALF || t.right > box.right + HALF) {
          report("clipped", el, `text ${px(t.width)} wide in a ${px(box.width)} box`, "fits its box");
          break;
        }
      }
    }
  }

  // Controls: tap size, overlap, focus.
  const controls = all.filter((el) => el.matches(CONTROLS)).slice(0, MAX_CONTROLS);
  if (tapTargets)
    for (const el of controls) {
      if (el.matches("a[href]") && inRunningText(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < TAP - HALF || r.height < TAP - HALF) report("tap-target", el, `${Math.round(r.width)}×${Math.round(r.height)}px`, `${TAP}×${TAP}px`);
    }
  const rects = controls.map((el) => [el, el.getBoundingClientRect()]);
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const [a, ra] = rects[i];
      const [b, rb] = rects[j];
      if (a.contains(b) || b.contains(a)) continue;
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > HALF && h > HALF) report("overlap", a, `${px(w)}×${px(h)} shared`, "no overlap", `${selectorOf(a)} × ${selectorOf(b)}`);
    }

  // Spacing on the 4 px grid: gaps and padding as computed.
  for (const el of all) {
    const s = style(el);
    const gaps = [s.rowGap, s.columnGap].filter((v) => v.endsWith("px")).map(Number.parseFloat);
    const flexOrGrid = /flex|grid/.test(s.display);
    const offGap = flexOrGrid ? gaps.find((g) => !near(g, 4)) : undefined;
    if (offGap !== undefined) report("grid", el, `gap ${px(offGap)}`, "a multiple of 4px");
    const pads = [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map(Number.parseFloat);
    if (pads.some((p) => !near(p, 4))) report("grid", el, `padding ${pads.map(px).join(" ")}`, "a multiple of 4px");
  }

  // Images drawn at a ratio other than their own.
  for (const img of all.filter((el) => el.tagName === "IMG")) {
    if (!img.naturalWidth || !img.naturalHeight || style(img).objectFit !== "fill") continue;
    const r = img.getBoundingClientRect();
    const drift = Math.abs(r.width / r.height / (img.naturalWidth / img.naturalHeight) - 1);
    if (drift > 0.02) report("stretched-image", img, `rendered ${Math.round(r.width)}×${Math.round(r.height)}`, `natural ratio ${img.naturalWidth}×${img.naturalHeight}`);
  }

  // Theme fonts that never arrived.
  await document.fonts.ready;
  const generic = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded", "math", "emoji"]);
  const faces = [...document.fonts];
  for (const { name, families } of fonts) {
    const [first, ...rest] = families;
    if (generic.has(first)) continue;
    const own = faces.filter((f) => f.family.replace(/^["']|["']$/g, "") === first);
    const fallback = rest.find((f) => generic.has(f) || document.fonts.check(`16px "${f}"`)) ?? "the browser default";
    if (!own.length) report("font-fallback", null, `"${first}" (not declared)`, `"${first}" loaded (in use: ${fallback})`, name);
    else if (own.every((f) => f.status === "error")) report("font-fallback", null, `"${first}" (error)`, `"${first}" loaded (in use: ${fallback})`, name);
  }

  // A visible change when a control takes keyboard focus.
  if (focus) {
    const before = document.activeElement;
    const { scrollX, scrollY } = window;
    const look = (el) => {
      const s = style(el);
      return [s.outlineStyle === "none" ? "none" : `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`, s.boxShadow, s.borderColor, s.backgroundColor, s.textDecorationLine].join("|");
    };
    for (const el of controls) {
      if (FIELDS.has(el.tagName) && el.disabled) continue;
      const rest = look(el);
      el.focus({ focusVisible: true, preventScroll: true });
      if (document.activeElement !== el) continue;
      if (look(el) === rest) report("focus-ring", el, "no change on focus", "a visible focus ring");
      el.blur();
    }
    before?.focus?.({ preventScroll: true });
    window.scrollTo(scrollX, scrollY);
  }

  const observations = [];
  for (const [rule, list] of found) {
    observations.push(...list.slice(0, CAP));
    if (list.length > CAP) observations.push({ kind: "layout", rule, selector: "…", measured: "", expected: "", text: `…and ${list.length - CAP} more` });
  }
  return { observations, tokens: { sizes, fonts } };
}
