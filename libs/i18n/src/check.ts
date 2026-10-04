import {
  type AST,
  type BindingPipe,
  LiteralPrimitive,
  parseTemplate,
  RecursiveAstVisitor,
  type TmplAstBoundAttribute,
  type TmplAstBoundText,
  TmplAstRecursiveVisitor,
  type TmplAstText,
  type TmplAstTextAttribute,
  tmplAstVisitAll,
} from '@angular/compiler';

import { flatten, type Texts } from './files';
import type { Language } from './languages';

const LETTER = /\p{L}/u;
const CEDILLA = /[şţŞŢ]/;
const PERSON_FACING = new Set([
  'alt',
  'aria-label',
  'label',
  'placeholder',
  'title',
]);
const CATEGORIES = new Set(['few', 'many', 'one', 'other', 'two', 'zero']);

const isPluralGroup = (value: Texts) =>
  Object.hasOwn(value, 'other') &&
  Object.keys(value).every((key) => CATEGORIES.has(key));

function pluralProblem(key: string, group: Texts, language: Language) {
  const wanted = new Intl.PluralRules(language).resolvedOptions()
    .pluralCategories;
  return Object.keys(group).sort().join() === [...wanted].sort().join()
    ? []
    : [`${key}: ${language} needs the forms ${wanted.join(', ')}`];
}

// Plural groups collapse to their own key, so Romanian one/few/other and
// English one/other compare as the same key; their categories are checked
// against each language's plural rules instead.
function shape(
  prefix: string,
  texts: Texts,
  language: Language,
  problems: string[],
): Set<string> {
  const keys = new Set<string>();
  for (const [name, value] of Object.entries(texts)) {
    const key = `${prefix}.${name}`;
    if (typeof value === 'string') keys.add(key);
    else if (isPluralGroup(value)) {
      problems.push(...pluralProblem(key, value, language));
      keys.add(key);
    } else for (const k of shape(key, value, language, problems)) keys.add(k);
  }
  return keys;
}

function valueProblems(area: string, texts: Texts, language: Language) {
  return Object.entries(flatten(area, texts)).flatMap(([key, text]) => [
    ...(text.trim() ? [] : [`${key}: empty in ${language}`]),
    ...(language === 'ro' && CEDILLA.test(text)
      ? [`${key}: ş or ţ with a cedilla; use ș or ț`]
      : []),
  ]);
}

export function fileProblems(area: string, ro: Texts, en: Texts): string[] {
  const problems: string[] = [];
  const roKeys = shape(area, ro, 'ro', problems);
  const enKeys = shape(area, en, 'en', problems);
  for (const key of roKeys)
    if (!enKeys.has(key)) problems.push(`${key}: missing in en`);
  for (const key of enKeys)
    if (!roKeys.has(key)) problems.push(`${key}: missing in ro`);
  return [
    ...problems,
    ...valueProblems(area, ro, 'ro'),
    ...valueProblems(area, en, 'en'),
  ];
}

class TemplateReader extends TmplAstRecursiveVisitor {
  readonly text: string[] = [];
  readonly keys: string[] = [];

  override visitText(node: TmplAstText) {
    this.typed(node.value);
  }

  override visitBoundText(node: TmplAstBoundText) {
    const ast = (node.value as AST & { ast?: AST }).ast;
    for (const piece of (ast as { strings?: string[] })?.strings ?? [])
      this.typed(piece);
    this.read(node.value, true);
  }

  override visitTextAttribute(node: TmplAstTextAttribute) {
    if (PERSON_FACING.has(node.name)) this.typed(node.value);
  }

  override visitBoundAttribute(node: TmplAstBoundAttribute) {
    this.read(node.value);
  }

  private typed(value: string) {
    if (LETTER.test(value)) this.text.push(value.trim());
  }

  // Inside {{ }} a string literal is shown to the person unless it is the key
  // handed to the `t` pipe; in a bound attribute it may be a class or a URL.
  private read(expression: AST, shown = false) {
    const reader = this;
    expression.visit(
      new (class extends RecursiveAstVisitor {
        override visitPipe(pipe: BindingPipe, context: unknown) {
          if (
            pipe.name !== 't' ||
            !(pipe.exp instanceof LiteralPrimitive) ||
            typeof pipe.exp.value !== 'string'
          )
            return super.visitPipe(pipe, context);
          reader.keys.push(pipe.exp.value);
          return this.visitAll(pipe.args, context);
        }

        override visitLiteralPrimitive(literal: LiteralPrimitive) {
          if (shown && typeof literal.value === 'string')
            reader.typed(literal.value);
        }
      })(),
    );
  }
}

function readTemplate(template: string): TemplateReader {
  const { errors, nodes } = parseTemplate(template, 'template.html');
  const reader = new TemplateReader();
  tmplAstVisitAll(reader, nodes);
  reader.text.push(...(errors ?? []).map((e) => `unparsable: ${e.msg}`));
  return reader;
}

export const typedText = (template: string): string[] =>
  readTemplate(template).text;

export const unknownKeys = (template: string, keys: Set<string>): string[] =>
  readTemplate(template).keys.filter(
    (key) => !keys.has(key) && !keys.has(`${key}.other`),
  );
