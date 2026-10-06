// The API operations a PR changes, and calling them on the tester's private,
// seeded API: signed in as a seeded account of the role the path names, path
// parameters taken from the parent collection, bodies built from the OpenAPI
// schema. What cannot be called is named with the reason, never left out.
import { endpointFinding } from "./findings.mjs";

const METHODS = ["get", "post", "put", "patch", "delete"];
const ROLES = ["admin", "garage", "mechanic", "receptionist", "driver"];

/** The accounts libs/domain/src/seed.ts adds outside production, one per role. */
export const SEEDED = {
  admin: "admin@example.test",
  driver: "sofer@example.test",
  garage: "service@example.test",
  mechanic: "mecanic@example.test",
  receptionist: "receptie@example.test",
};

/** The seed's own test password, or the one it was given. */
export const seedPassword = (env = process.env) => env.SEED_PASSWORD || "parola-de-test";

const signsOut = (path) => /sign-out/.test(path);
const signOutsLast = (list) => [...list.filter((e) => !signsOut(e.path)), ...list.filter((e) => signsOut(e.path))];

/** JSON with object keys sorted, so a reordered document compares equal. */
const canonical = (value) => JSON.stringify(value, (_, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));

/** Every operation at the head that is new or differs from the base, sign-outs last. */
export function changedEndpoints(baseDoc, headDoc) {
  const before = baseDoc?.paths ?? {};
  return signOutsLast(
    Object.entries(headDoc?.paths ?? {}).flatMap(([path, ops]) =>
      METHODS.filter((m) => ops[m] && canonical(before[path]?.[m]) !== canonical(ops[m])).map((m) => ({ method: m.toUpperCase(), path, op: ops[m] })),
    ),
  );
}

/** The role to call a secured operation as: the one a path segment names, otherwise the driver; null when it is open. */
export function roleFor(path, op) {
  if (!op?.security?.length) return null;
  return path.split("/").find((s) => ROLES.includes(s)) ?? "driver";
}

function resolve(schema, doc) {
  let s = schema ?? {};
  // A bound, not a visited set: a reference that only names itself must still end.
  for (let hops = 0; s.$ref && hops < 16; hops++) s = s.$ref.split("/").slice(1).reduce((node, key) => node?.[key], doc) ?? {};
  return s.$ref ? {} : s;
}

/** A value the schema accepts: its example or default, else one built from its type, honouring the bounds. */
export function exampleValue(schema, doc, depth = 0) {
  const s = resolve(schema, doc);
  if (s.example !== undefined) return s.example;
  if (s.default !== undefined) return s.default;
  if (s.enum?.length) return s.enum[0];
  const branch = s.oneOf ?? s.anyOf ?? s.allOf;
  if (depth > 6) return null;
  if (branch?.length) return exampleValue(branch[0], doc, depth + 1);
  switch (s.type ?? (s.properties ? "object" : undefined)) {
    case "object":
      return Object.fromEntries((s.required ?? []).map((k) => [k, exampleValue(s.properties?.[k], doc, depth + 1)]));
    case "array":
      return Array.from({ length: s.minItems ?? 0 }, () => exampleValue(s.items, doc, depth + 1));
    case "integer":
    case "number":
      return s.minimum ?? 1;
    case "boolean":
      return true;
    case "string": {
      const byFormat = { email: "pr-tester@example.test", uuid: "00000000-0000-4000-8000-000000000000", "date-time": new Date().toISOString(), date: new Date().toISOString().slice(0, 10), uri: "https://example.test/" }[s.format];
      const text = byFormat ?? "test";
      return text.padEnd(s.minLength ?? 0, "x");
    }
    default:
      return null;
  }
}

/** The first item's value for a path parameter: the field of that name, else its id. */
export function firstId(json, param, depth = 0) {
  const list = Array.isArray(json) ? json : (json?.items ?? json?.data ?? Object.values(json ?? {}).find(Array.isArray));
  if (!Array.isArray(list)) return depth < 1 && json && typeof json === "object" ? (Object.values(json).map((v) => firstId(v, param, depth + 1)).find((id) => id != null) ?? null) : null;
  const item = list[0];
  if (!item || typeof item !== "object") return null;
  const own = (key) => (Object.hasOwn(item, key) ? item[key] : undefined);
  return own(param) ?? own("id") ?? null;
}

export async function signIn(apiURL, role, password) {
  const res = await fetch(`${apiURL}/api/v1/auth/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: SEEDED[role], password, remember: false }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`could not sign in as ${role} (${SEEDED[role]}): HTTP ${res.status}`);
  const refresh = /mf_refresh=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
  const token = (await res.json().catch(() => null))?.accessToken;
  if (typeof token !== "string" || !token) throw new Error(`could not sign in as ${role} (${SEEDED[role]}): HTTP ${res.status} with no access token`);
  return { token, refresh };
}

/**
 * Call each changed operation once. Returns the findings (each 5xx, see
 * endpointFinding), the calls made with their answers, and the operations
 * skipped with the reason.
 */
export async function callEndpoints({ apiURL, endpoints, doc, password = seedPassword() }) {
  const sessions = new Map();
  const session = (role) => {
    if (!sessions.has(role)) sessions.set(role, signIn(apiURL, role, password).catch((error) => ({ error })));
    return sessions.get(role);
  };
  const findings = [];
  const called = [];
  const skipped = [];

  for (const { method, path, op } of signOutsLast(endpoints)) {
    const name = `${method} ${path}`;
    try {
      const role = roleFor(path, op);
      const auth = path.startsWith("/api/v1/auth/") ? "driver" : role;
      const signed = auth ? await session(auth) : null;
      if (role && signed.error) throw signed.error;
      const headers = {};
      if (role) headers.authorization = `Bearer ${signed.token}`;
      if (auth && signed.refresh) headers.cookie = `mf_refresh=${signed.refresh}`;

      let url = path;
      for (const [, param] of path.matchAll(/\{([^}]+)\}/g)) {
        const collection = url.slice(0, url.indexOf(`/{${param}}`));
        const res = await fetch(apiURL + collection, { headers, signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`GET ${collection} answered ${res.status}, so there is no {${param}} to call it with`);
        const id = firstId(await res.json().catch(() => null), param);
        if (id == null) throw new Error(`no item in GET ${collection} to take {${param}} from`);
        url = url.replace(`{${param}}`, encodeURIComponent(id));
      }
      const query = (op.parameters ?? []).filter((p) => p.in === "query" && p.required).map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(exampleValue(p.schema, doc))}`);
      if (query.length) url += `?${query.join("&")}`;

      let body;
      if (op.requestBody) {
        const content = op.requestBody.content ?? {};
        if (content["application/json"]) {
          body = JSON.stringify(exampleValue(content["application/json"].schema, doc));
          headers["content-type"] = "application/json";
        } else if (op.requestBody.required) throw new Error(`its body is ${Object.keys(content).join(", ") || "of no type"}, not JSON`);
      }

      const res = await fetch(apiURL + url, { method, headers, body, signal: AbortSignal.timeout(15000) }).catch((error) => ({ status: 599, text: async () => error.message }));
      const text = await res.text();
      called.push(`${method} ${url} → ${res.status}`);
      const finding = endpointFinding({ method, path: url, status: res.status, body: text, responses: op.responses });
      if (finding) findings.push(finding);
    } catch (error) {
      skipped.push(`${name}: ${String(error.message).split("\n")[0]}`);
    }
  }
  return { findings, called, skipped };
}
