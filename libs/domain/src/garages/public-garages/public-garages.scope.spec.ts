import { type Dirent, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

import * as ts from 'typescript';

// @traces 207-FR-005 1183-FR-007 1183-FR-008

type Sources = Map<string, string>;

const HTTP = /^(Get|Post|Put|Patch|Delete|All|Sse)\(/;
const STAFF = /^'(garage|admin)\./;
const PRISMA_READS = new Set([
  'count',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
]);
const SQL_TAGS = /(\$queryRaw|\$executeRaw|Prisma\.sql|\bsql)$/;
const SQL_CALLS = new Set(['$queryRawUnsafe', '$executeRawUnsafe']);
const GARAGE_TABLE = /\b(FROM|JOIN)\s+garage\b/i;
const SCOPED_PRISMA = /\.\.\.publicGarages\(\)/;
const SCOPED_SQL = /^publicGaragesSql\(/;
// A body that refuses everyone but a garage's staff or an operator: what it
// reads, and what it calls, is staff work, whichever handler led there.
const STAFF_GATE =
  /\b(assertGarage|assertGarageOwner)\(|\brequireCapability\([^,]+,\s*'(garage|admin)\.|ANSWERING\.has\(actor\.role\)|actor\.role !== '(garage|admin)'/;

// Reads a non-staff entry point reaches that may skip the scope, each with
// why it must see a garage the public listing hides.
const EXCEPTIONS: Record<string, string> = {
  'cars/saved-garages/saved-garages.service.ts#list':
    'a driver keeps the garages they saved after one is hidden, marked unavailable by the scope as a column',
  'garages/staff-invite/staff-invite.service.ts#check':
    'an invite names the garage that sent it, approved or not, to the person holding its secret',
  'garages/staff-invite/staff-invite.service.ts#joined':
    'the owners of the garage a new member joined hear its name, approved or not',
  'quotes/quote-requests/quote-requests.service.ts#assertRouted':
    'reads the garages a driver picked only to refuse the request, naming why a hidden one cannot take it; it sends to none of them',
  'search/garage-search/garage-search.service.ts#after':
    'reads only the name of the last garage of a page, by the id in the cursor, to find where the next starts; it never returns it',
};

// ─── sources ────────────────────────────────────────────────────────────────

const parse = (path: string, source: string) =>
  ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);

const isSource = (name: string) =>
  name.endsWith('.ts') && !/\.spec\.ts$|\.testing\.ts$|\.d\.ts$/.test(name);

// Every source file a request can run, keyed by its path from the
// repository root.
function sources(): Sources {
  const repo = join(__dirname, '..', '..', '..', '..', '..');
  const roots = [
    join(repo, 'libs', 'domain', 'src'),
    join(repo, 'libs', 'mcp-tools', 'src'),
    ...readdirSync(join(repo, 'apps'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(repo, 'apps', entry.name, 'src')),
  ];
  const out: Sources = new Map();
  for (const root of roots) collect(repo, root, out);
  return out;
}

function collect(repo: string, dir: string, out: Sources) {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'generated') {
      collect(repo, path, out);
    } else if (entry.isFile() && isSource(entry.name)) {
      out.set(relative(repo, path), readFileSync(path, 'utf8'));
    }
  }
}

interface Program {
  parsed: Map<string, ts.SourceFile>;
  classes: Map<string, { path: string; node: ts.ClassDeclaration }>;
  functions: Map<string, Map<string, ts.Node>>;
  imports: Map<string, Map<string, string>>;
  context: Map<string, string>;
}

// The parsed program: classes and top-level functions by name, each file's
// relative imports, and the assistant tools' context shape.
function index(files: Sources): Program {
  const program: Program = {
    classes: new Map(),
    context: new Map(),
    functions: new Map(),
    imports: new Map(),
    parsed: new Map(),
  };
  for (const [path, source] of files) {
    const file = parse(path, source);
    program.parsed.set(path, file);
    program.functions.set(path, new Map());
    program.imports.set(path, new Map());
    for (const statement of file.statements) {
      record(program, path, statement);
    }
  }
  return program;
}

function record(program: Program, path: string, statement: ts.Statement) {
  if (ts.isClassDeclaration(statement) && statement.name) {
    program.classes.set(statement.name.text, { node: statement, path });
  } else if (ts.isImportDeclaration(statement)) {
    recordImport(program, path, statement);
  } else if (
    ts.isInterfaceDeclaration(statement) &&
    statement.name.text === 'ToolContext'
  ) {
    contextTypes(statement.members, '', program.context);
  } else {
    recordFunctions(program.functions.get(path), statement);
  }
}

// A top-level function, or a constant holding one, by its name.
function recordFunctions(
  own: Map<string, ts.Node> | undefined,
  statement: ts.Statement,
) {
  if (ts.isFunctionDeclaration(statement) && statement.name) {
    own?.set(statement.name.text, statement);
  } else if (ts.isVariableStatement(statement)) {
    for (const d of statement.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer) {
        own?.set(d.name.text, d.initializer);
      }
    }
  }
}

function recordImport(
  program: Program,
  path: string,
  statement: ts.ImportDeclaration,
) {
  const from = statement.moduleSpecifier;
  const bindings = statement.importClause?.namedBindings;
  if (!ts.isStringLiteral(from) || !from.text.startsWith('.')) return;
  if (!bindings || !ts.isNamedImports(bindings)) return;
  const target = normalize(join(dirname(path), `${from.text}.ts`));
  for (const element of bindings.elements) {
    program.imports.get(path)?.set(element.name.text, target);
  }
}

// `garage.figures` → `GarageFiguresService` from `Pick<GarageFiguresService, …>`.
function contextTypes(
  members: ts.NodeArray<ts.TypeElement>,
  prefix: string,
  out: Map<string, string>,
) {
  for (const member of members) {
    if (!ts.isPropertySignature(member) || !member.type) continue;
    const name = `${prefix}${member.name.getText()}`;
    const type = member.type;
    if (ts.isTypeLiteralNode(type)) contextTypes(type.members, `${name}.`, out);
    else if (ts.isTypeReferenceNode(type)) {
      const picked =
        type.typeName.getText() === 'Pick' && type.typeArguments?.[0];
      out.set(name, (picked || type).getText().replace(/<.*$/, ''));
    }
  }
}

// ─── entry points ───────────────────────────────────────────────────────────

const decoratorTexts = (node: ts.HasDecorators) =>
  (ts.getDecorators(node) ?? []).map((d) => d.expression.getText());

const requiresOf = (node: ts.HasDecorators) =>
  decoratorTexts(node)
    .map((text) => /^Requires\((.*)\)$/.exec(text)?.[1])
    .find((capability) => capability !== undefined);

const assigned = (node: ts.ObjectLiteralExpression, name: string) =>
  node.properties.find(
    (p): p is ts.PropertyAssignment =>
      ts.isPropertyAssignment(p) && p.name.getText() === name,
  )?.initializer;

const handlerOf = (node: ts.ObjectLiteralExpression) =>
  node.properties.find((p) => p.name?.getText() === 'handler');

interface Entry {
  name: string;
  path: string;
  body: ts.Node;
  owner?: string;
}

// Controller handlers a visitor or driver reaches (the method's `@Requires`
// over its class's, staff capabilities excluded) and assistant tools whose
// capability is absent or a driver's.
function entryPoints(program: Program): Entry[] {
  const out: Entry[] = [];
  for (const [path, file] of program.parsed) {
    if (path.endsWith('.controller.ts')) {
      for (const statement of file.statements) {
        if (ts.isClassDeclaration(statement)) {
          out.push(...handlers(path, statement));
        }
      }
    }
    out.push(...tools(path, file));
  }
  return out;
}

function handlers(path: string, node: ts.ClassDeclaration): Entry[] {
  const own = requiresOf(node);
  return node.members
    .filter(ts.isMethodDeclaration)
    .filter((m) => m.body && decoratorTexts(m).some((t) => HTTP.test(t)))
    .filter((m) => !STAFF.test(requiresOf(m) ?? own ?? ''))
    .map((m) => ({
      body: m.body as ts.Block,
      name: m.name.getText(),
      owner: node.name?.text,
      path,
    }));
}

function tools(path: string, file: ts.SourceFile): Entry[] {
  const out: Entry[] = [];
  const visit = (node: ts.Node) => {
    const tool =
      ts.isCallExpression(node) &&
      node.expression.getText() === 'defineTool' &&
      node.arguments[0];
    if (tool && ts.isObjectLiteralExpression(tool)) {
      const handler = handlerOf(tool);
      const capability = assigned(tool, 'capability')?.getText() ?? '';
      if (handler && !STAFF.test(capability)) {
        const name = assigned(tool, 'name')?.getText().replace(/'/g, '');
        out.push({ body: handler, name: name ?? 'tool', path });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

// ─── garage reads ───────────────────────────────────────────────────────────

interface Read {
  kind: 'prisma' | 'sql';
  line: number;
  scoped: boolean;
}

const lineOf = (node: ts.Node) =>
  node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;

function templateText(template: ts.TemplateLiteral) {
  if (ts.isNoSubstitutionTemplateLiteral(template)) {
    return { scoped: false, text: template.text };
  }
  return {
    scoped: template.templateSpans.some((span) =>
      SCOPED_SQL.test(span.expression.getText()),
    ),
    text: [
      template.head.text,
      ...template.templateSpans.map((s) => s.literal.text),
    ].join(' ? '),
  };
}

// A raw SQL template that names the garage table.
function sqlTemplateRead(node: ts.TaggedTemplateExpression): Read | undefined {
  if (!SQL_TAGS.test(node.tag.getText())) return undefined;
  const { scoped, text } = templateText(node.template);
  return GARAGE_TABLE.test(text)
    ? { kind: 'sql', line: lineOf(node), scoped }
    : undefined;
}

// A Prisma read of `garage`, or an unsafe raw call naming the garage table.
function callRead(node: ts.CallExpression): Read | undefined {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  const method = callee.name.text;
  if (SQL_CALLS.has(method)) {
    const sql = node.arguments[0]?.getText() ?? '';
    return GARAGE_TABLE.test(sql)
      ? { kind: 'sql', line: lineOf(node), scoped: false }
      : undefined;
  }
  const model = callee.expression;
  const onGarage =
    ts.isPropertyAccessExpression(model) && model.name.text === 'garage';
  if (!(PRISMA_READS.has(method) && onGarage)) return undefined;
  const args = node.arguments.map((a) => a.getText()).join(',');
  return {
    kind: 'prisma',
    line: lineOf(node),
    scoped: SCOPED_PRISMA.test(args),
  };
}

function readAt(node: ts.Node): Read | undefined {
  if (ts.isTaggedTemplateExpression(node)) return sqlTemplateRead(node);
  return ts.isCallExpression(node) ? callRead(node) : undefined;
}

// The garage reads written in one body.
function garageReads(body: ts.Node): Read[] {
  const out: Read[] = [];
  const walk = (node: ts.Node) => {
    const read = readAt(node);
    if (read) out.push(read);
    ts.forEachChild(node, walk);
  };
  walk(body);
  return out;
}

// ─── the walk ───────────────────────────────────────────────────────────────

function fieldTypes(node: ts.ClassDeclaration) {
  const types = new Map<string, string>();
  for (const member of node.members.filter(ts.isConstructorDeclaration)) {
    for (const param of member.parameters) {
      if (param.type && ts.isTypeReferenceNode(param.type)) {
        types.set(param.name.getText(), param.type.typeName.getText());
      }
    }
  }
  return types;
}

const methodOf = (node: ts.ClassDeclaration, name: string) =>
  node.members
    .filter(ts.isMethodDeclaration)
    .find((m) => m.name.getText() === name && m.body);

interface Step {
  at: string;
  path: string;
  body: ts.Node;
  owner?: string;
}

// The class whose method a `receiver.method()` call runs: this class, the
// type of `this.field`, or a tool context's `ctx.a.b`.
function receiverType(
  program: Program,
  receiver: ts.Expression,
  owner: string | undefined,
) {
  if (receiver.kind === ts.SyntaxKind.ThisKeyword) return owner;
  if (/^ctx\./.test(receiver.getText())) {
    return program.context.get(receiver.getText().slice(4));
  }
  const home = owner ? program.classes.get(owner)?.node : undefined;
  if (
    home &&
    ts.isPropertyAccessExpression(receiver) &&
    receiver.expression.kind === ts.SyntaxKind.ThisKeyword
  ) {
    return fieldTypes(home).get(receiver.name.text);
  }
  return undefined;
}

// Where one call leads: a method of a known class, or a plain function of
// this file or a relatively imported one.
function stepOf(
  program: Program,
  call: ts.CallExpression,
  from: Step,
): Step | undefined {
  const callee = call.expression;
  if (ts.isPropertyAccessExpression(callee)) {
    return methodStep(program, callee, from);
  }
  return ts.isIdentifier(callee)
    ? functionStep(program, callee.text, from)
    : undefined;
}

function methodStep(
  program: Program,
  callee: ts.PropertyAccessExpression,
  from: Step,
): Step | undefined {
  const type = receiverType(program, callee.expression, from.owner);
  const target = type ? program.classes.get(type) : undefined;
  const body = target && methodOf(target.node, callee.name.text)?.body;
  if (!(target && body)) return undefined;
  const at = `${target.path}#${callee.name.text}`;
  return { at, body, owner: type, path: target.path };
}

function functionStep(
  program: Program,
  name: string,
  from: Step,
): Step | undefined {
  const home = program.functions.get(from.path)?.has(name)
    ? from.path
    : program.imports.get(from.path)?.get(name);
  const body = home ? program.functions.get(home)?.get(name) : undefined;
  return home && body ? { at: `${home}#${name}`, body, path: home } : undefined;
}

interface Found extends Read {
  at: string;
  entry: string;
}

// Every garage read an entry point reaches through `this.x()`,
// `this.field.x()`, a tool's `ctx.a.b.x()`, and plain functions of its own
// file or a relatively imported one, named `file#function`. A body that lets
// only staff through ends the walk there.
function walk(program: Program, entries: Entry[]): Found[] {
  const found: Found[] = [];
  const seen = new Set<string>();
  const visit = (step: Step, entry: string) => {
    if (seen.has(step.at)) return;
    seen.add(step.at);
    if (gated(program, step, 0)) return;
    for (const read of garageReads(step.body)) {
      found.push({ ...read, at: step.at, entry });
    }
    const each = (node: ts.Node) => {
      const next = ts.isCallExpression(node) && stepOf(program, node, step);
      if (next) visit(next, entry);
      ts.forEachChild(node, each);
    };
    each(step.body);
  };
  for (const entry of entries) {
    const at = `${entry.path}#${entry.name}`;
    visit({ ...entry, at }, at);
  }
  return found;
}

// Whether a body refuses all but staff before it reads anything: a staff
// check that runs on every path, itself or through a helper of its class it
// calls (`this.ownInvite()` → `this.assertOwner()`), as a statement of the
// body ahead of any that reads a garage or calls on to code that may. A check
// inside a branch, a short-circuit or a callback leaves the other path open,
// so the walk goes on past it (FR-007: only a staff gate on the path excludes
// a read).
function gated(program: Program, step: Step, depth: number): boolean {
  const body = step.body;
  const statements = ts.isBlock(body) ? [...body.statements] : [body];
  for (const statement of statements) {
    if (staffStatement(program, step, statement, depth)) return true;
    if (reaches(program, step, statement)) return false;
  }
  return false;
}

// A guard `if (<staff role test>) throw …` with no else, or a statement whose
// staff check is called unconditionally.
function staffStatement(
  program: Program,
  step: Step,
  statement: ts.Node,
  depth: number,
): boolean {
  if (ts.isIfStatement(statement)) {
    return (
      !statement.elseStatement &&
      throws(statement.thenStatement) &&
      STAFF_GATE.test(statement.expression.getText()) &&
      !/&&|\?\?/.test(statement.expression.getText())
    );
  }
  let found = false;
  const visit = (node: ts.Node) => {
    if (found || opensPath(node)) return;
    if (ts.isCallExpression(node) && staffCall(program, step, node, depth)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(statement);
  return found;
}

const throws = (node: ts.Statement): boolean =>
  ts.isThrowStatement(node) ||
  (ts.isBlock(node) &&
    node.statements.length === 1 &&
    ts.isThrowStatement(node.statements[0]));

// A node below which code runs on some paths only.
const opensPath = (node: ts.Node) =>
  ts.isIfStatement(node) ||
  ts.isConditionalExpression(node) ||
  ts.isFunctionLike(node) ||
  ts.isIterationStatement(node, false) ||
  ts.isSwitchStatement(node) ||
  ts.isTryStatement(node) ||
  ts.isCatchClause(node) ||
  (ts.isBinaryExpression(node) &&
    [
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
    ].includes(node.operatorToken.kind)) ||
  ((ts.isCallExpression(node) || ts.isPropertyAccessExpression(node)) &&
    node.questionDotToken !== undefined);

function staffCall(
  program: Program,
  step: Step,
  call: ts.CallExpression,
  depth: number,
): boolean {
  const text = call.getText();
  if (/^(assertGarage|assertGarageOwner)\(/.test(text)) return true;
  if (/^requireCapability\([^,]+,\s*'(garage|admin)\./.test(text)) return true;
  const callee = call.expression;
  const node = step.owner ? program.classes.get(step.owner)?.node : undefined;
  if (
    !node ||
    depth > 2 ||
    !ts.isPropertyAccessExpression(callee) ||
    callee.expression.kind !== ts.SyntaxKind.ThisKeyword
  ) {
    return false;
  }
  const helper = methodOf(node, callee.name.text)?.body;
  return (
    helper !== undefined &&
    gated(
      program,
      { ...step, at: `${step.path}#${callee.name.text}`, body: helper },
      depth + 1,
    )
  );
}

// Whether a statement reads a garage or calls code the walk can follow,
// outside what it throws.
const reaches = (program: Program, step: Step, statement: ts.Node) => {
  if (garageReads(statement).length > 0) return true;
  let found = false;
  const visit = (node: ts.Node) => {
    // What a throw builds runs on the refusing path only.
    if (found || ts.isThrowStatement(node)) return;
    if (ts.isCallExpression(node) && stepOf(program, node, step)) found = true;
    else ts.forEachChild(node, visit);
  };
  visit(statement);
  return found;
};

// The failures: an unscoped read not excepted, by `file:line`, and an
// exception the walk no longer reaches.
function verdict(files: Sources, exceptions: Record<string, string>) {
  const program = index(files);
  const reads = walk(program, entryPoints(program));
  const short = (at: string) => at.replace(/^libs\/domain\/src\//, '');
  const bypasses = reads
    .filter((read) => !read.scoped && !(short(read.at) in exceptions))
    .map(
      (read) =>
        `${read.at.split('#')[0]}:${read.line} (${short(read.at)}, from ${read.entry})`,
    );
  const reached = new Set(reads.map((read) => short(read.at)));
  const stale = Object.keys(exceptions).filter((name) => !reached.has(name));
  return { bypasses: [...new Set(bypasses)].sort(), reads, stale };
}

// ─── the checks ─────────────────────────────────────────────────────────────

const driverHandler = `
  @Controller('requests')
  export class RequestsController {
    constructor(private readonly requests: RequestsService) {}
    @Requires('driver.requests') @Post() send() { return this.requests.send(); }
  }`;

describe('the public garages scope, on fixtures', () => {
  it('names an unscoped read in a service a driver handler reaches through a plain function', () => {
    const files: Sources = new Map([
      ['libs/domain/src/quotes/requests.controller.ts', driverHandler],
      [
        'libs/domain/src/quotes/requests.service.ts',
        `import { route } from './route';
         export class RequestsService {
           constructor(private readonly prisma: PrismaClient) {}
           send() { return route(this.prisma); }
         }`,
      ],
      [
        'libs/domain/src/quotes/route.ts',
        `export function route(prisma) {
           return prisma.garage.findMany({ where: { id: 'x' } });
         }`,
      ],
    ]);

    expect(verdict(files, {}).bypasses).toEqual([
      'libs/domain/src/quotes/route.ts:2 (quotes/route.ts#route, from libs/domain/src/quotes/requests.controller.ts#send)',
    ]);
  });

  it('names an unscoped raw SQL read of the garage table a public handler reaches', () => {
    const files: Sources = new Map([
      [
        'libs/domain/src/map/map.controller.ts',
        `@Controller('map')
         export class MapController {
           constructor(private readonly map: MapService) {}
           @Public() @Get() pins() { return this.map.pins(); }
         }`,
      ],
      [
        'libs/domain/src/map/map.service.ts',
        `export class MapService {
           constructor(private readonly prisma: PrismaClient) {}
           pins() {
             return this.prisma.$queryRaw\`SELECT id FROM garage WHERE city = 'B'\`;
           }
           scoped() {
             return this.prisma.$queryRaw\`SELECT id FROM garage g WHERE \${publicGaragesSql('g')}\`;
           }
         }`,
      ],
    ]);

    expect(verdict(files, {}).bypasses).toEqual([
      'libs/domain/src/map/map.service.ts:4 (map/map.service.ts#pins, from libs/domain/src/map/map.controller.ts#pins)',
    ]);
  });

  it('passes reads through either form of the scope, and leaves other tables alone', () => {
    const files: Sources = new Map([
      [
        'libs/domain/src/map/map.controller.ts',
        `@Controller('map')
         export class MapController {
           constructor(private readonly map: MapService) {}
           @Get() pins() { return this.map.pins(); }
         }`,
      ],
      [
        'libs/domain/src/map/map.service.ts',
        `export class MapService {
           constructor(private readonly prisma: PrismaClient) {}
           pins() {
             this.prisma.garage.findMany({ where: { ...publicGarages(), city: 'B' } });
             this.prisma.$queryRaw\`SELECT 1 FROM garage_brand WHERE brand_id = 'x'\`;
             return this.prisma.$queryRaw\`SELECT id FROM garage g WHERE \${publicGaragesSql('g')}\`;
           }
         }`,
      ],
    ]);

    const { bypasses, reads } = verdict(files, {});

    expect(bypasses).toEqual([]);
    expect(reads.map((r) => [r.kind, r.scoped])).toEqual([
      ['prisma', true],
      ['sql', true],
    ]);
  });

  it('leaves staff handlers and staff tools out, the method’s capability over its class’s', () => {
    const unscoped = `export class Office {
        constructor(private readonly prisma: PrismaClient) {}
        load() { return this.prisma.garage.findMany({}); }
      }`;
    const files: Sources = new Map([
      [
        'libs/domain/src/office/office.controller.ts',
        `@Controller('office')
         export class OfficeController {
           constructor(private readonly office: Office) {}
           @Requires('garage.profile') @Get() mine() { return this.office.load(); }
           @Requires('admin.garages') @Get('all') all() { return this.office.load(); }
         }`,
      ],
      [
        'libs/domain/src/office/driver.controller.ts',
        `@Requires('garage.profile') @Controller('mixed')
         export class MixedController {
           constructor(private readonly office: Office) {}
           @Requires('driver.cars') @Get() mine() { return this.office.load(); }
         }`,
      ],
      ['libs/domain/src/office/office.ts', unscoped],
      [
        'libs/mcp-tools/src/tools/stats.ts',
        `export const stats = defineTool({
           capability: 'garage.requests',
           name: 'stats',
           async handler(actor, input, ctx) { return ctx.garage.office.load(); },
         });`,
      ],
      [
        'libs/mcp-tools/src/registry.ts',
        `export interface ToolContext { garage: { office: Pick<Office, 'load'> } }`,
      ],
    ]);

    expect(verdict(files, {}).bypasses).toEqual([
      'libs/domain/src/office/office.ts:3 (office/office.ts#load, from libs/domain/src/office/driver.controller.ts#mine)',
    ]);
  });

  it('stops at a body that lets only staff through, itself or through a helper of its class', () => {
    const files: Sources = new Map([
      [
        'libs/domain/src/desk/desk.controller.ts',
        `@Controller('desk')
         export class DeskController {
           constructor(private readonly desk: Desk) {}
           @Get('a') a() { return this.desk.direct(); }
           @Get('b') b() { return this.desk.helped(); }
           @Get('c') c() { return this.desk.open(); }
         }`,
      ],
      [
        'libs/domain/src/desk/desk.ts',
        `export class Desk {
           constructor(private readonly prisma: PrismaClient) {}
           direct(actor) {
             assertGarage(actor, 'g');
             return this.prisma.garage.findMany({});
           }
           helped(actor) {
             this.garageOf(actor);
             return this.prisma.garage.findMany({});
           }
           open() { return this.prisma.garage.findMany({}); }
           private garageOf(actor) { requireCapability(actor, 'garage.requests'); }
         }`,
      ],
    ]);

    expect(verdict(files, {}).bypasses).toEqual([
      'libs/domain/src/desk/desk.ts:11 (desk/desk.ts#open, from libs/domain/src/desk/desk.controller.ts#c)',
    ]);
  });

  it('walks on past a staff check that does not run on every path', () => {
    const files: Sources = new Map([
      [
        'libs/domain/src/desk/desk.controller.ts',
        `@Controller('desk')
         export class DeskController {
           constructor(private readonly desk: Desk) {}
           @Get('a') a() { return this.desk.branch(); }
           @Get('b') b() { return this.desk.short(); }
           @Get('c') c() { return this.desk.late(); }
           @Get('d') d() { return this.desk.helped(); }
           @Get('e') e() { return this.desk.thrown(); }
         }`,
      ],
      [
        'libs/domain/src/desk/desk.ts',
        `export class Desk {
           constructor(private readonly prisma: PrismaClient) {}
           branch(actor) {
             if (actor.role === 'garage') assertGarage(actor, 'g');
             return this.prisma.garage.findMany({});
           }
           short(actor) {
             actor.garageId && assertGarage(actor, 'g');
             return this.prisma.garage.findMany({});
           }
           late(actor) {
             const all = this.prisma.garage.findMany({});
             assertGarage(actor, 'g');
             return all;
           }
           helped(actor) {
             if (actor.garageId) this.garageOf(actor);
             return this.prisma.garage.findMany({});
           }
           thrown(actor) {
             if (actor.role !== 'garage') throw new ForbiddenException();
             return this.prisma.garage.findMany({});
           }
           private garageOf(actor) { requireCapability(actor, 'garage.requests'); }
         }`,
      ],
    ]);

    expect(verdict(files, {}).bypasses).toEqual([
      'libs/domain/src/desk/desk.ts:12 (desk/desk.ts#late, from libs/domain/src/desk/desk.controller.ts#c)',
      'libs/domain/src/desk/desk.ts:18 (desk/desk.ts#helped, from libs/domain/src/desk/desk.controller.ts#d)',
      'libs/domain/src/desk/desk.ts:5 (desk/desk.ts#branch, from libs/domain/src/desk/desk.controller.ts#a)',
      'libs/domain/src/desk/desk.ts:9 (desk/desk.ts#short, from libs/domain/src/desk/desk.controller.ts#b)',
    ]);
  });

  it('walks an assistant tool with no capability into its context', () => {
    const files: Sources = new Map([
      [
        'libs/mcp-tools/src/tools/near.ts',
        `export const near = defineTool({
           name: 'near',
           async handler(actor, input, ctx) { return ctx.garage.office.load(); },
         });`,
      ],
      [
        'libs/mcp-tools/src/registry.ts',
        `export interface ToolContext { garage: { office: Pick<Office, 'load'> } }`,
      ],
      [
        'libs/domain/src/office/office.ts',
        `export class Office {
           constructor(private readonly prisma: PrismaClient) {}
           load() { return this.prisma.garage.findMany({}); }
         }`,
      ],
    ]);

    expect(verdict(files, {}).bypasses).toEqual([
      'libs/domain/src/office/office.ts:3 (office/office.ts#load, from libs/mcp-tools/src/tools/near.ts#near)',
    ]);
  });

  it('names an exception the walk no longer reaches', () => {
    expect(
      verdict(new Map(), { 'gone/gone.service.ts#read': 'no longer here' })
        .stale,
    ).toEqual(['gone/gone.service.ts#read']);
  });
});

describe('the public garages scope, on the tree', () => {
  const files = sources();
  const result = verdict(files, EXCEPTIONS);

  it('reaches the profile read and finds no non-staff read that skips the scope', () => {
    expect(result.reads.map((r) => r.at)).toContain(
      'libs/domain/src/garages/public-garages/public-garages.ts#read',
    );
    expect(result.bypasses).toEqual([]);
  });

  it('still reaches every listed exception', () => {
    expect(result.stale).toEqual([]);
  });

  // The guard reads `@Requires` from the handler only, so a class-level one
  // would protect nothing at run time while this spec counted it.
  it('finds no controller class carrying @Requires', () => {
    const classLevel = [...index(files).classes.values()]
      .filter(
        ({ node, path }) => path.endsWith('.controller.ts') && requiresOf(node),
      )
      .map(({ path }) => path);
    expect(classLevel).toEqual([]);
  });
});
