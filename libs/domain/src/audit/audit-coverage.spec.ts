import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import * as ts from 'typescript';

const MODEL_WRITES = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'delete',
  'deleteMany',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
]);
const RAW_WRITES = new Set(['$executeRaw', '$executeRawUnsafe']);

const isThisAudit = (node: ts.Expression) =>
  ts.isPropertyAccessExpression(node) &&
  node.expression.kind === ts.SyntaxKind.ThisKeyword &&
  node.name.text === 'audit';

function callee(node: ts.Node) {
  if (ts.isCallExpression(node)) return node.expression;
  if (ts.isTaggedTemplateExpression(node)) return node.tag;
  return null;
}

const isWrite = (target: ts.PropertyAccessExpression) =>
  RAW_WRITES.has(target.name.text) ||
  (MODEL_WRITES.has(target.name.text) &&
    ts.isPropertyAccessExpression(target.expression));

// A method "writes" when it calls a Prisma write on a model (`tx.account.create`)
// or runs raw SQL; it is covered when it also calls the writer through `this.audit`.
function facts(body: ts.Node) {
  const found = { audits: false, writes: false };
  const walk = (node: ts.Node) => {
    const target = callee(node);
    if (target && ts.isPropertyAccessExpression(target)) {
      found.writes ||= isWrite(target);
      found.audits ||= isThisAudit(target.expression);
    }
    ts.forEachChild(node, walk);
  };
  walk(body);
  return found;
}

function scan(source: string) {
  const file = ts.createSourceFile(
    'x.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const methods: { name: string; writes: boolean; audits: boolean }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isClassDeclaration(node) && node.name) {
      const owner = node.name.text;
      for (const member of node.members.filter(ts.isMethodDeclaration)) {
        if (!member.body) continue;
        methods.push({
          ...facts(member.body),
          name: `${owner}.${member.name.getText(file)}`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return methods;
}

const uncovered = (source: string) =>
  scan(source)
    .filter((m) => m.writes && !m.audits)
    .map((m) => m.name);

const root = join(__dirname, '..');

function serviceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'generated' ? [] : serviceFiles(path);
    }
    return entry.name.endsWith('.service.ts') ? [path] : [];
  });
}

const writer = join(__dirname, 'audit.service.ts');

describe('every write use case in the domain library calls the audit writer', () => {
  const files = serviceFiles(root).filter((path) => path !== writer);

  it('finds the use cases that write', () => {
    const writing = files.flatMap((path) =>
      scan(readFileSync(path, 'utf8'))
        .filter((m) => m.writes)
        .map((m) => m.name),
    );
    expect(writing).toEqual(
      expect.arrayContaining([
        'AccountsService.createAccount',
        'AccountsService.grantRole',
      ]),
    );
  });

  it.each(
    files.map((path) => [relative(root, path), path]),
  )('%s writes nothing without an audit entry', (_name, path) => {
    const missing = uncovered(readFileSync(path, 'utf8')).map(
      (method) => `${relative(root, path)}#${method}`,
    );
    expect(missing).toEqual([]);
  });
});

describe('the check itself', () => {
  it('names a method that writes through a transaction without an entry', () => {
    expect(
      uncovered(`
        class PricesService {
          async change(tx, id, range) {
            await tx.garagePrice.update({ where: { id }, data: range });
          }
        }`),
    ).toEqual(['PricesService.change']);
  });

  it('names a method that runs raw SQL without an entry', () => {
    expect(
      uncovered(`
        class JobsService {
          async close() {
            await this.prisma.$executeRaw\`UPDATE job SET status = 'done'\`;
          }
        }`),
    ).toEqual(['JobsService.close']);
  });

  it('accepts a method that writes and records the change', () => {
    expect(
      uncovered(`
        class PricesService {
          async change(tx, id, before, after) {
            await tx.garagePrice.update({ where: { id }, data: after });
            await this.audit.recordChanges(tx, {}, before, after);
          }
        }`),
    ).toEqual([]);
  });

  it('ignores reads', () => {
    expect(
      uncovered(`
        class GaragesService {
          find(id) {
            return this.prisma.garage.findUnique({ where: { id } });
          }
        }`),
    ).toEqual([]);
  });
});
