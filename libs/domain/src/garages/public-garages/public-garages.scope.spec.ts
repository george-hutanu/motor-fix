import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import * as ts from 'typescript';

// @traces 207-FR-005
// @traces 271-garage-distance-FR-012

const GARAGE_READS = new Set([
  'count',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
]);
// A read through the scope, or the one that asks only for the status to
// choose between 404 and 410.
const SCOPED = /\.\.\.publicGarages\(\)/;
const STATUS_ONLY = /select:\s*\{\s*status:\s*true\s*,?\s*\}/;

// Public handlers that read one garage for a person holding its secret, not
// a listing: an invite names the garage that sent it, approved or not. The
// brand-first list reads only the name of its last garage, by the id in the
// cursor, to find where the next page starts; it never returns it.
const NOT_LISTINGS = new Set([
  'garages/staff-invite/staff-invite.service.ts#check',
  'search/garage-search/garage-search.service.ts#after',
]);

type Sources = Map<string, string>;

const parse = (path: string, source: string) =>
  ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);

const decoratedPublic = (node: ts.HasDecorators) =>
  (ts.getDecorators(node) ?? []).some((d) =>
    /^Public\(/.test(d.expression.getText()),
  );

function classes(sources: Sources) {
  const found = new Map<string, { path: string; node: ts.ClassDeclaration }>();
  for (const [path, source] of sources) {
    const visit = (node: ts.Node) => {
      if (ts.isClassDeclaration(node) && node.name) {
        found.set(node.name.text, { node, path });
      }
      ts.forEachChild(node, visit);
    };
    visit(parse(path, source));
  }
  return found;
}

// `this.field.method(...)` and `this.method(...)` calls inside a body.
function calls(body: ts.Node) {
  const out: {
    field: string | null;
    method: string;
    node: ts.CallExpression;
  }[] = [];
  const walk = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      const target = node.expression;
      const receiver = target.expression;
      if (receiver.kind === ts.SyntaxKind.ThisKeyword) {
        out.push({ field: null, method: target.name.text, node });
      } else if (
        ts.isPropertyAccessExpression(receiver) &&
        receiver.expression.kind === ts.SyntaxKind.ThisKeyword
      ) {
        out.push({ field: receiver.name.text, method: target.name.text, node });
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(body);
  return out;
}

// A raw statement that reads the `garage` table, not `garage_brand` and kin.
const GARAGE_SOURCE = /\b(?:FROM|JOIN)\s+"?garage"?(?![\w"])/i;
const RAW_READS = new Set(['$queryRaw', '$queryRawUnsafe']);

// A raw statement passes only when it splices the public scope itself.
function scopedRaw(text: string) {
  const spliced = [...text.matchAll(/\$\{\s*([^}]+?)\s*\}/g)].map((m) => m[1]);
  return spliced.includes('publicGaragesSql');
}

// `anything.garage.findMany(...)` whose arguments skip the scope.
function unscopedPrismaRead(node: ts.Node) {
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression) ||
    !GARAGE_READS.has(node.expression.name.text) ||
    !ts.isPropertyAccessExpression(node.expression.expression) ||
    node.expression.expression.name.text !== 'garage'
  ) {
    return false;
  }
  const args = node.arguments.map((a) => a.getText()).join(',');
  return !SCOPED.test(args) && !STATUS_ONLY.test(args);
}

// A raw statement on `garage` that does not splice the scope; an unsafe raw
// statement on `garage` never passes.
function unscopedRawRead(node: ts.Node) {
  if (
    ts.isTaggedTemplateExpression(node) &&
    ts.isPropertyAccessExpression(node.tag) &&
    node.tag.name.text === '$queryRaw'
  ) {
    const text = node.template.getText();
    return GARAGE_SOURCE.test(text) && !scopedRaw(text);
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    RAW_READS.has(node.expression.name.text)
  ) {
    const text = node.arguments.map((a) => a.getText()).join(',');
    const unsafe = node.expression.name.text === '$queryRawUnsafe';
    return GARAGE_SOURCE.test(text) && (unsafe || !scopedRaw(text));
  }
  return false;
}

function unscopedGarageReads(body: ts.Node) {
  let found = false;
  const walk = (node: ts.Node) => {
    if (unscopedPrismaRead(node) || unscopedRawRead(node)) found = true;
    ts.forEachChild(node, walk);
  };
  walk(body);
  return found;
}

function fieldTypes(node: ts.ClassDeclaration) {
  const types = new Map<string, string>();
  for (const member of node.members) {
    if (!ts.isConstructorDeclaration(member)) continue;
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

// The class and method of each call a method body makes on itself or a field.
function callees(owner: ts.ClassDeclaration, className: string, body: ts.Node) {
  const fields = fieldTypes(owner);
  return calls(body).flatMap(({ field, method }) => {
    const type = field === null ? className : fields.get(field);
    return type ? [[type, method] as const] : [];
  });
}

// The handlers under `@Public()`, on the method or on its class.
function publicHandlers(node: ts.ClassDeclaration) {
  const wholeClass = decoratedPublic(node);
  return node.members
    .filter(ts.isMethodDeclaration)
    .filter((member) => wholeClass || decoratedPublic(member))
    .map((member) => member.name.getText());
}

// Every service method a `@Public()` handler reaches, as `File#method`, with
// whether it reads garages outside the scope.
function publicGarageReads(sources: Sources) {
  const all = classes(sources);
  const reads: { name: string; bypasses: boolean }[] = [];
  const seen = new Set<string>();

  const follow = (className: string, method: string) => {
    const owner = all.get(className);
    const body = owner && methodOf(owner.node, method)?.body;
    const name = `${owner?.path}#${method}`;
    if (!owner || !body || seen.has(name)) return;
    seen.add(name);
    const text = body.getText();
    if (
      /\.garage\./.test(text) ||
      (/\$queryRaw/.test(text) && GARAGE_SOURCE.test(text))
    ) {
      reads.push({ bypasses: unscopedGarageReads(body), name });
    }
    for (const [type, next] of callees(owner.node, className, body)) {
      follow(type, next);
    }
  };

  for (const [path, source] of sources) {
    if (!path.endsWith('.controller.ts')) continue;
    const visit = (node: ts.Node) => {
      if (ts.isClassDeclaration(node) && node.name) {
        const className = node.name.text;
        for (const handler of publicHandlers(node)) follow(className, handler);
      }
      ts.forEachChild(node, visit);
    };
    visit(parse(path, source));
  }
  return reads;
}

const isSource = (name: string) =>
  name.endsWith('.ts') && !/\.spec\.ts$|\.testing\.ts$/.test(name);

function domainSources(): Sources {
  const root = join(__dirname, '..', '..');
  const out: Sources = new Map();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'generated') walk(path);
      else if (entry.isFile() && isSource(entry.name)) {
        out.set(relative(root, path), readFileSync(path, 'utf8'));
      }
    }
  };
  walk(root);
  return out;
}

describe('the public garages scope', () => {
  it('names a public handler whose service reads garages without the scope', () => {
    const sources: Sources = new Map([
      [
        'search/search.controller.ts',
        `@Controller('search')
         export class SearchController {
           constructor(private readonly search: SearchService) {}
           @Public() @Get() find() { return this.search.near(); }
         }`,
      ],
      [
        'search/search.service.ts',
        `export class SearchService {
           constructor(private readonly prisma: PrismaClient) {}
           near() { return this.load(); }
           private load() { return this.prisma.garage.findMany({ where: { name: 'x' } }); }
           scoped() { return this.prisma.garage.findMany({ where: { ...publicGarages() } }); }
         }`,
      ],
    ]);

    expect(publicGarageReads(sources)).toEqual([
      { bypasses: true, name: 'search/search.service.ts#load' },
    ]);
  });

  it('passes a public handler whose service reads garages through the scope', () => {
    const sources: Sources = new Map([
      [
        'map/map.controller.ts',
        `@Public() @Controller('map')
         export class MapController {
           constructor(private readonly map: MapService) {}
           @Get() pins() { return this.map.pins(); }
         }`,
      ],
      [
        'map/map.service.ts',
        `export class MapService {
           constructor(private readonly prisma: PrismaClient) {}
           pins() { return this.prisma.garage.findMany({ where: { ...publicGarages(), city: 'B' } }); }
         }`,
      ],
    ]);

    expect(publicGarageReads(sources)).toEqual([
      { bypasses: false, name: 'map/map.service.ts#pins' },
    ]);
  });

  it('names a public handler whose raw query reads garages without the scope', () => {
    const sources: Sources = new Map([
      [
        'pins/pins.controller.ts',
        `@Controller('pins')
         export class PinsController {
           constructor(private readonly pins: PinsService) {}
           @Public() @Get() list() { return this.pins.near(); }
           @Public() @Get('raw') raw() { return this.pins.unsafe(); }
         }`,
      ],
      [
        'pins/pins.service.ts',
        `export class PinsService {
           constructor(private readonly prisma: PrismaClient) {}
           near() {
             return this.prisma.$queryRaw\`SELECT id FROM garage WHERE latitude IS NOT NULL\`;
           }
           unsafe() {
             return this.prisma.$queryRawUnsafe(\`SELECT id FROM garage WHERE \${publicGaragesSql}\`);
           }
         }`,
      ],
    ]);

    expect(publicGarageReads(sources)).toEqual([
      { bypasses: true, name: 'pins/pins.service.ts#near' },
      { bypasses: true, name: 'pins/pins.service.ts#unsafe' },
    ]);
  });

  it('passes a public handler whose raw query reads garages through the scope', () => {
    const sources: Sources = new Map([
      [
        'pins/pins.controller.ts',
        `@Public() @Controller('pins')
         export class PinsController {
           constructor(private readonly pins: PinsService) {}
           @Get() scoped() { return this.pins.scoped(); }
           @Get('area') area() { return this.pins.inArea(); }
           @Get('brands') brands() { return this.pins.brands(); }
         }`,
      ],
      [
        'pins/pins.service.ts',
        `export class PinsService {
           constructor(private readonly prisma: PrismaClient) {}
           scoped() {
             return this.prisma.$queryRaw\`SELECT id FROM garage WHERE \${publicGaragesSql}\`;
           }
           inArea(area: Area) {
             const sql = areaSql(area);
             return this.prisma.$queryRaw\`SELECT id, \${sql.distance} FROM garage WHERE \${publicGaragesSql} AND \${within(sql)}\`;
           }
           brands() {
             return this.prisma.$queryRaw\`SELECT id FROM brand\`;
           }
         }`,
      ],
    ]);

    expect(publicGarageReads(sources)).toEqual([
      { bypasses: false, name: 'pins/pins.service.ts#scoped' },
      { bypasses: false, name: 'pins/pins.service.ts#inArea' },
    ]);
  });

  it('names a raw query that splices the area without the scope', () => {
    const sources: Sources = new Map([
      [
        'pins/pins.controller.ts',
        `@Public() @Controller('pins')
         export class PinsController {
           constructor(private readonly pins: PinsService) {}
           @Get() area() { return this.pins.inArea(); }
           @Get('where') where() { return this.pins.byWhere(); }
         }`,
      ],
      [
        'pins/pins.service.ts',
        `export class PinsService {
           constructor(private readonly prisma: PrismaClient) {}
           inArea(area: Area) {
             const sql = areaSql(area);
             return this.prisma.$queryRaw\`SELECT id FROM garage WHERE \${within(sql)}\`;
           }
           byWhere(area: Area) {
             return this.prisma.$queryRaw\`SELECT id FROM "garage" WHERE \${areaSql(area).where}\`;
           }
         }`,
      ],
    ]);

    expect(publicGarageReads(sources)).toEqual([
      { bypasses: true, name: 'pins/pins.service.ts#inArea' },
      { bypasses: true, name: 'pins/pins.service.ts#byWhere' },
    ]);
  });

  it('names a raw query that splices another value called where', () => {
    const sources: Sources = new Map([
      [
        'pins/pins.controller.ts',
        `@Public() @Controller('pins')
         export class PinsController {
           constructor(private readonly pins: PinsService) {}
           @Get() list() { return this.pins.near(); }
         }`,
      ],
      [
        'pins/pins.service.ts',
        `export class PinsService {
           constructor(private readonly prisma: PrismaClient) {}
           near() {
             const filter = { where: Prisma.sql\`TRUE\` };
             return this.prisma.$queryRaw\`SELECT id FROM garage g JOIN garage_brand b ON TRUE WHERE \${filter.where}\`;
           }
         }`,
      ],
    ]);

    expect(publicGarageReads(sources)).toEqual([
      { bypasses: true, name: 'pins/pins.service.ts#near' },
    ]);
  });

  it('finds the public garage read in the domain library, and no read that skips the scope', () => {
    const reads = publicGarageReads(domainSources());

    expect(reads.map((r) => r.name)).toContain(
      'garages/public-garages/public-garages.ts#read',
    );
    expect(
      reads
        .filter((r) => r.bypasses && !NOT_LISTINGS.has(r.name))
        .map((r) => r.name),
    ).toEqual([]);
  });
});
