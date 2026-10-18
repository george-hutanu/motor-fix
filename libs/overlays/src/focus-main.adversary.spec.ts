import { focusMain } from './index';

const added: HTMLElement[] = [];

function addMain(
  attrs: Record<string, string> = {},
  parent: HTMLElement = document.body,
) {
  const main = document.createElement('main');
  for (const [name, value] of Object.entries(attrs))
    main.setAttribute(name, value);
  parent.append(main);
  added.push(main);
  return main;
}

afterEach(() => {
  for (const el of added.splice(0)) el.remove();
  (document.activeElement as HTMLElement | null)?.blur();
});

// @traces 248-FR-006
describe('focusMain', () => {
  it('answers false and leaves the focus alone when the page has no main', () => {
    const button = document.createElement('button');
    document.body.append(button);
    added.push(button);
    button.focus();

    expect(focusMain(document)).toBe(false);
    expect(document.activeElement).toBe(button);
  });

  it('takes the first of several mains and leaves the others untouched', () => {
    const first = addMain();
    const second = addMain();

    expect(focusMain(document)).toBe(true);
    expect(document.activeElement).toBe(first);
    expect(second.hasAttribute('tabindex')).toBe(false);
  });

  it('keeps a tabindex the main already has', () => {
    const main = addMain({ tabindex: '0' });

    expect(focusMain(document)).toBe(true);
    expect(main.getAttribute('tabindex')).toBe('0');
    expect(document.activeElement).toBe(main);
  });

  it('keeps an explicit tabindex of -1 and does not stack attributes when called twice', () => {
    const main = addMain({ tabindex: '-1' });

    expect(focusMain(document)).toBe(true);
    expect(focusMain(document)).toBe(true);

    expect(main.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(main);
  });

  it('pulls the focus back from another control', () => {
    const main = addMain();
    const input = document.createElement('input');
    main.append(input);
    input.focus();

    focusMain(document);

    expect(document.activeElement).toBe(main);
  });

  it('finds a main nested deep in the page', () => {
    const wrapper = document.createElement('div');
    document.body.append(wrapper);
    added.push(wrapper);
    const main = addMain({}, wrapper);

    expect(focusMain(document)).toBe(true);
    expect(document.activeElement).toBe(main);
  });

  it('works on a document that holds nothing at all', () => {
    const empty = document.implementation.createHTMLDocument('');
    empty.body.replaceChildren();

    expect(focusMain(empty)).toBe(false);
  });
});
