// @traces 1018-FR-009
// @traces 1018-FR-011
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { dashed, frontMatter, hosted, notionId, renderBlocks, renderProperty, richText } from './render.mjs';

const A = 'aaaaaaaa-1111-2222-3333-444444444444';
const B = 'bbbbbbbb-1111-2222-3333-444444444444';
const OUT = 'cccccccc-1111-2222-3333-444444444444';
const compact = (id) => id.replaceAll('-', '');

const text = (content, extra = {}) => ({
  type: 'text',
  plain_text: content,
  text: { content, link: extra.href ? { url: extra.href } : null },
  href: extra.href ?? null,
  annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default', ...extra.annotations },
});
const mention = (kind, id, plain) => ({ type: 'mention', plain_text: plain, href: `https://www.notion.so/${compact(id)}`, mention: { type: kind, [kind]: { id } }, annotations: {} });
const block = (type, body = {}, children) => ({ object: 'block', id: `${type}-id`, type, has_children: Boolean(children), [type]: body, ...(children ? { children } : {}) });
const rt = (s) => ({ rich_text: [text(s)] });

function context(paths = { [A]: 'a.md', [B]: 'sub/b.md' }) {
  return {
    resolve: (id) => paths[id] ?? null,
    file: (b) => (b.id === 'hosted' ? 'page.files/pic.png' : null),
    unknown: {},
  };
}

describe('rich text', () => {
  it('renders annotations, links and equations', () => {
    const ctx = context();
    assert.equal(richText([text('b', { annotations: { bold: true } }), text(' '), text('i', { annotations: { italic: true } })], ctx), '**b** *i*');
    assert.equal(richText([text('x', { annotations: { code: true } })], ctx), '`x`');
    assert.equal(richText([text('gone', { annotations: { strikethrough: true } })], ctx), '~~gone~~');
    assert.equal(richText([text('site', { href: 'https://example.com/x' })], ctx), '[site](https://example.com/x)');
    assert.equal(richText([{ type: 'equation', plain_text: 'e=mc^2', equation: { expression: 'e=mc^2' }, annotations: {} }], ctx), '$e=mc^2$');
  });

  it('rewrites page and database mentions to relative paths, and leaves one outside the crawl on its Notion URL', () => {
    const ctx = context();
    assert.equal(richText([mention('page', A, 'A page')], ctx), '[A page](a.md)');
    assert.equal(richText([mention('database', B, 'B db')], ctx), '[B db](sub/b.md)');
    assert.equal(richText([mention('page', OUT, 'Elsewhere')], ctx), `[Elsewhere](https://www.notion.so/${compact(OUT)})`);
  });
});

describe('Notion links', () => {
  it('reads the page id from every Notion URL form', () => {
    for (const url of [
      `https://www.notion.so/${compact(A)}`,
      `https://www.notion.so/My-page-${compact(A)}`,
      `https://www.notion.so/workspace/My-page-${compact(A)}?pvs=4`,
      `https://app.notion.com/p/${compact(A)}`,
      `https://app.notion.com/p/Some-title-${compact(A)}#block`,
      `https://team.notion.site/${A}`,
      `https://notion.so/${A}?v=1`,
    ]) {
      assert.equal(notionId(url), A, url);
    }
    assert.equal(notionId('https://example.com/aaaaaaaa111122223333444444444444'), null);
    assert.equal(notionId('https://www.notion.so/no-id-here'), null);
  });

  it('rewrites a Notion URL in the crawl to its path, and leaves an outside one and an external one unchanged', () => {
    const ctx = context();
    assert.equal(richText([text('see', { href: `https://app.notion.com/p/Title-${compact(A)}?pvs=21` })], ctx), '[see](a.md)');
    assert.equal(richText([text('see', { href: `https://www.notion.so/${compact(OUT)}` })], ctx), `[see](https://www.notion.so/${compact(OUT)})`);
    assert.equal(richText([text('x', { href: 'https://github.com/a/b' })], ctx), '[x](https://github.com/a/b)');
  });
});

describe('blocks', () => {
  it('renders headings, paragraphs, quotes, dividers and code', () => {
    const md = renderBlocks(
      [
        block('heading_1', rt('One')),
        block('heading_2', rt('Two')),
        block('heading_3', rt('Three')),
        block('paragraph', rt('Body')),
        block('quote', rt('Said')),
        block('divider'),
        block('code', { language: 'typescript', rich_text: [text('const a = 1;')] }),
      ],
      context(),
    );
    assert.equal(md, '# One\n\n## Two\n\n### Three\n\nBody\n\n> Said\n\n---\n\n```typescript\nconst a = 1;\n```\n');
  });

  it('nests lists and to-dos by indentation', () => {
    const md = renderBlocks(
      [
        block('bulleted_list_item', rt('a'), [block('bulleted_list_item', rt('a1'))]),
        block('numbered_list_item', rt('n')),
        block('to_do', { ...rt('done'), checked: true }),
        block('to_do', { ...rt('open'), checked: false }),
      ],
      context(),
    );
    assert.equal(md, '- a\n  - a1\n\n1. n\n\n- [x] done\n\n- [ ] open\n');
  });

  it('renders a callout, a toggle, columns flattened in order and an equation', () => {
    const md = renderBlocks(
      [
        block('callout', { ...rt('Mind this'), icon: { type: 'emoji', emoji: '💡' } }),
        block('toggle', rt('More'), [block('paragraph', rt('Hidden'))]),
        block('column_list', {}, [block('column', {}, [block('paragraph', rt('Left'))]), block('column', {}, [block('paragraph', rt('Right'))])]),
        block('equation', { expression: 'a^2' }),
      ],
      context(),
    );
    assert.equal(md, '> 💡 Mind this\n\n<details>\n<summary>More</summary>\n\nHidden\n\n</details>\n\nLeft\n\nRight\n\n$$\na^2\n$$\n');
  });

  it('renders a table as GFM with its header row', () => {
    const row = (...cells) => block('table_row', { cells: cells.map((c) => [text(c)]) });
    const md = renderBlocks([block('table', { has_column_header: true, table_width: 2 }, [row('A', 'B'), row('1', '2|3')])], context());
    assert.equal(md, '| A | B |\n| --- | --- |\n| 1 | 2\\|3 |\n');
  });

  it('links child pages, child databases and link_to_page through the path map', () => {
    const ctx = context();
    const md = renderBlocks(
      [
        { ...block('child_page', { title: 'A page' }), id: A },
        { ...block('child_database', { title: 'B db' }), id: B },
        block('link_to_page', { type: 'page_id', page_id: A }),
      ],
      ctx,
    );
    assert.equal(md, '- [A page](a.md)\n\n- [B db](sub/b.md)\n\n- [A page](a.md)\n');
  });

  it('references a downloaded file relatively, keeps an external image URL and its caption', () => {
    const md = renderBlocks(
      [
        { ...block('image', { type: 'file', file: { url: 'https://s3.example/x?X-Amz-Signature=1' }, caption: [text('Pic')] }), id: 'hosted' },
        block('image', { type: 'external', external: { url: 'https://example.com/i.png' }, caption: [] }),
        block('bookmark', { url: 'https://example.com/read', caption: [] }),
      ],
      context(),
    );
    assert.equal(md, '![Pic](page.files/pic.png)\n\n![](https://example.com/i.png)\n\n<https://example.com/read>\n');
    assert.doesNotMatch(md, /X-Amz/);
  });

  it('renders the children of a synced block and leaves out a table of contents and a breadcrumb', () => {
    const md = renderBlocks([block('synced_block', {}, [block('paragraph', rt('Shared'))]), block('table_of_contents'), block('breadcrumb')], context());
    assert.equal(md, 'Shared\n');
  });

  it('turns an unknown block type into a comment naming it, and counts it', () => {
    const ctx = context();
    const md = renderBlocks([block('ai_block'), block('ai_block'), block('paragraph', rt('After'))], ctx);
    assert.equal(md, '<!-- notion: ai_block -->\n\n<!-- notion: ai_block -->\n\nAfter\n');
    assert.deepEqual(ctx.unknown, { ai_block: 2 });
  });
});

describe('properties', () => {
  it('renders each property type as text', () => {
    const ctx = context();
    const r = (prop) => renderProperty(prop, ctx);
    assert.equal(r({ type: 'title', title: [text('T')] }), 'T');
    assert.equal(r({ type: 'rich_text', rich_text: [text('R')] }), 'R');
    assert.equal(r({ type: 'select', select: { name: 'Open' } }), 'Open');
    assert.equal(r({ type: 'select', select: null }), '');
    assert.equal(r({ type: 'status', status: { name: 'Done' } }), 'Done');
    assert.equal(r({ type: 'multi_select', multi_select: [{ name: 'a' }, { name: 'b' }] }), 'a, b');
    assert.equal(r({ type: 'number', number: 3 }), '3');
    assert.equal(r({ type: 'checkbox', checkbox: true }), 'yes');
    assert.equal(r({ type: 'date', date: { start: '2026-10-01', end: '2026-10-03' } }), '2026-10-01 → 2026-10-03');
    assert.equal(r({ type: 'url', url: 'https://x.y' }), 'https://x.y');
    assert.equal(r({ type: 'people', people: [{ name: 'George' }] }), 'George');
    assert.equal(r({ type: 'relation', relation: [{ id: A }, { id: OUT }] }), `[a](a.md), https://www.notion.so/${compact(OUT)}`);
    assert.equal(r({ type: 'formula', formula: { type: 'number', number: 7 } }), '7');
    assert.equal(r({ type: 'unique_id', unique_id: { prefix: 'ST', number: 5 } }), 'ST-5');
    assert.equal(r({ type: 'created_time', created_time: '2026-10-01T00:00:00.000Z' }), '2026-10-01T00:00:00.000Z');
  });

  it('turns an unknown property type into a comment naming it, and counts it', () => {
    const ctx = context();
    assert.equal(renderProperty({ type: 'button', button: {} }, ctx), '<!-- notion: button -->');
    assert.deepEqual(ctx.unknown, { button: 1 });
  });
});

describe('front matter', () => {
  it('holds exactly title, notion_id, notion_url and last_edited, in that order, the title quoted', () => {
    const fm = frontMatter({ title: 'Say "hi" \\ there', id: compact(A), url: `https://www.notion.so/${compact(A)}`, edited: '2026-10-09T10:00:00.000Z' });
    assert.equal(
      fm,
      `---\ntitle: "Say \\"hi\\" \\\\ there"\nnotion_id: ${A}\nnotion_url: https://www.notion.so/${compact(A)}\nlast_edited: 2026-10-09T10:00:00.000Z\n---\n`,
    );
  });
});

describe('ids and hosts', () => {
  it('dashes a Notion id and refuses anything that could climb out of docs/', () => {
    assert.equal(dashed('0123456789ABCDEF0123456789abcdef'), '01234567-89ab-cdef-0123-456789abcdef');
    for (const bad of ['../../etc/passwd', '0123456789abcdef0123456789abcde', '0123456789abcdef0123456789abcdef/..', '']) assert.throws(() => dashed(bad), /not a Notion id/);
  });

  it('treats only the exact file hosts or their true subdomains, signed, as Notion-hosted', () => {
    const q = '?X-Amz-Signature=x';
    assert.equal(hosted(`https://prod-files-secure.s3.us-west-2.amazonaws.com/a.png${q}`), true);
    assert.equal(hosted(`https://file.notion.so/a.png${q}`), true);
    for (const url of [`https://evilamazonaws.com/a.png${q}`, `https://amazonaws.com.evil.example/a.png${q}`, `https://notnotion.so/a.png${q}`, 'https://file.notion.so/a.png'])
      assert.equal(hosted(url), false, url);
  });
});
