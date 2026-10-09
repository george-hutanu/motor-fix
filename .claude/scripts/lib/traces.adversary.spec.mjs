import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { traceTokens } from './traces.mjs';

// Assembled at runtime: a literal NNN-FR-NNN here would be scanned as a token.
const T = (feature, n) => `${feature}${'-FR-'}${n}`;
const A = T('001', '001');
const B = T('002', '002');
const C = T('003', '003');
const tag = '// ' + '@traces';
const ids = (text) => [...traceTokens(text)];

describe('traceTokens adversarial', () => {
  it('returns an empty set for empty text', () => {
    assert.deepEqual(ids(''), []);
  });
  it('reads a line at the very start of the file', () => {
    assert.deepEqual(ids(`${tag} ${A}\nx`), [A]);
  });
  it('reads a line at the very end with no newline', () => {
    assert.deepEqual(ids(`x\n${tag} ${A}`), [A]);
  });
  it('reads a line with CRLF line ends', () => {
    assert.deepEqual(ids(`${tag} ${A} ${B}\r\nit();\r\n`), [A, B]);
  });
  it('reads a CRLF line that is the last in the file', () => {
    assert.deepEqual(ids(`it();\r\n${tag} ${A}\r\n`), [A]);
  });
  it('accepts tab indentation and trailing tab', () => {
    assert.deepEqual(ids(`\t${tag} ${A}\t`), [A]);
  });
  it('accepts a trailing space', () => {
    assert.deepEqual(ids(`${tag} ${A}   \n`), [A]);
  });
  it('rejects a tab between tag and id', () => {
    assert.deepEqual(ids(`${tag}\t${A}`), []);
  });
  it('rejects two spaces between ids and drops the whole line', () => {
    assert.deepEqual(ids(`${tag} ${A}  ${B}`), []);
  });
  it('rejects two spaces between the tag and the first id', () => {
    assert.deepEqual(ids(`${tag}  ${A}`), []);
  });
  it('rejects a comma-separated list', () => {
    assert.deepEqual(ids(`${tag} ${A}, ${B}`), []);
  });
  it('rejects trailing comment text and none of its ids count', () => {
    assert.deepEqual(ids(`${tag} ${A} because`), []);
  });
  it('rejects a trailing second comment', () => {
    assert.deepEqual(ids(`${tag} ${A} // note`), []);
  });
  it('rejects a missing space after the slashes', () => {
    assert.deepEqual(ids(`//@traces ${A}`), []);
  });
  it('rejects two spaces after the slashes', () => {
    assert.deepEqual(ids(`//  @traces ${A}`), []);
  });
  it('rejects a capitalised tag', () => {
    assert.deepEqual(ids(`// @Traces ${A}`), []);
  });
  it('rejects a tag with no ids', () => {
    assert.deepEqual(ids(`${tag}`), []);
    assert.deepEqual(ids(`${tag} `), []);
  });
  it('rejects a block comment', () => {
    assert.deepEqual(ids(`/* @traces ${A} */`), []);
    assert.deepEqual(ids(`/** @traces ${A} */`), []);
    assert.deepEqual(ids(`/*\n * @traces ${A}\n */`), []);
  });
  it('rejects a tag after code on the same line', () => {
    assert.deepEqual(ids(`it('x'); ${tag} ${A}`), []);
  });
  it('rejects a tag inside a string or template', () => {
    assert.deepEqual(ids(`const s = '${tag} ${A}';`), []);
  });
  it('rejects a hash comment', () => {
    assert.deepEqual(ids(`# @traces ${A}`), []);
  });
  it('accepts four-digit feature numbers', () => {
    assert.deepEqual(ids(`${tag} ${T('1018', '001')}`), [T('1018', '001')]);
  });
  it('rejects four-digit requirement numbers', () => {
    assert.deepEqual(ids(`${tag} ${T('001', '0001')}`), []);
  });
  it('rejects two-digit numbers', () => {
    assert.deepEqual(ids(`${tag} ${T('01', '001')}`), []);
    assert.deepEqual(ids(`${tag} ${T('001', '01')}`), []);
  });
  it('rejects lowercase fr', () => {
    assert.deepEqual(ids(`${tag} 001-fr-001`), []);
  });
  it('rejects non-ascii digits', () => {
    assert.deepEqual(ids(`${tag} ${T('００１', '001')}`), []);
  });
  it('rejects a good id followed by a bad one on the same line', () => {
    assert.deepEqual(ids(`${tag} ${A} 001-FR-1`), []);
  });
  it('rejects a bare feature-less id', () => {
    assert.deepEqual(ids(`${tag} FR-001`), []);
  });
  it('rejects an id glued to extra characters', () => {
    assert.deepEqual(ids(`${tag} ${A}x`), []);
    assert.deepEqual(ids(`${tag} x${A}`), []);
  });
  it('does not join ids across a line break', () => {
    assert.deepEqual(ids(`${tag} ${A}\n${B}`), [A]);
  });
  it('does not let the whitespace run swallow the next line', () => {
    assert.deepEqual(ids(`${tag} ${A}\n\n\n${tag} ${B}`), [A, B]);
  });
  it('keeps order of appearance across lines', () => {
    assert.deepEqual(ids(`${tag} ${C}\n${tag} ${A} ${B}`), [C, A, B]);
  });
  it('deduplicates repeated ids within and across lines, first position wins', () => {
    assert.deepEqual(ids(`${tag} ${A} ${B} ${A}\n${tag} ${B} ${C}`), [A, B, C]);
  });
  it('is stable when called twice on the same text', () => {
    const text = `${tag} ${A}\n${tag} ${B}`;
    assert.deepEqual(ids(text), ids(text));
    assert.deepEqual(ids(text), [A, B]);
  });
  it('ignores an id with no tag', () => {
    assert.deepEqual(ids(`it('${A} works', () => {});`), []);
    assert.deepEqual(ids(`// ${A}`), []);
  });
  it('handles ten thousand ids on one line', () => {
    const many = Array.from({ length: 10000 }, (_, i) => T('001', String(i % 1000).padStart(3, '0')));
    assert.equal(traceTokens(`${tag} ${many.join(' ')}`).size, 1000);
  });
  it('finishes quickly on a long near-miss line', () => {
    const near = Array.from({ length: 20000 }, () => A).join(' ') + ' x';
    const t = Date.now();
    assert.equal(traceTokens(`${tag} ${near}`).size, 0);
    assert.ok(Date.now() - t < 2000);
  });
  it('accepts a form feed or vertical tab as surrounding whitespace per the grammar', () => {
    assert.deepEqual(ids(`\f${tag} ${A}\v`), [A]);
  });
  it('reads the first line of a file that starts with a byte order mark, which \\s covers', () => {
    assert.deepEqual(ids(`﻿${tag} ${A}\n${tag} ${B}`), [A, B]);
  });
});
