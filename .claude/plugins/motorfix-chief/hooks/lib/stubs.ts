import { mock } from 'claude-code/testing';

// Test stand-ins for the engine nouns the mod calls: every `$` call a hook makes
// needs one, or the kit skips that hook. Used by the *.test.ts files only.

type Run = { exitCode: number; stdout: string; stderr: string };
type Options = {
  store?: Record<string, unknown>;
  agents?: { id: string; status: string; parentId?: string; type?: string }[];
  session?: string;
  env?: Record<string, string>;
  run?: (argv: readonly string[]) => Run | Promise<Run>;
};

// What a refused tool call comes back as in a test: `isError`, the reason as `text`.
export const refusal = (r) => (r?.isError ? r.text : r?.deny);

export const ok = (stdout = ''): Run => ({ exitCode: 0, stderr: '', stdout });

export function stubs(on, options: Options = {}) {
  const store = new Map(Object.entries(options.store ?? {}));
  const toasts: string[] = [];
  const runs: { argv: readonly string[]; init: unknown }[] = [];
  const sent: { to: unknown; text: string }[] = [];
  const submitted: string[] = [];
  const opened: string[] = [];
  const agents = options.agents ?? [];
  // The clock starts at 0 and moves only when the test advances it.
  const clock = mock.clock(on);
  // A call on `$` is answered `{ value }` by the hooks beneath the plugin.
  const value = (v?: unknown) => ({ value: v });
  on('store.get', (_$, e) => value(store.get(e.key)));
  on('store.set', (_$, e) => value(void store.set(e.key, e.value)));
  on('store.delete', (_$, e) => value(void store.delete(e.key)));
  on('store.keys', () => value([...store.keys()]));
  on('agent.list', () => value(agents));
  on('session.id', () => value(options.session ?? 'sess-a'));
  on('env.get', (_$, e) => value(options.env?.[e.name]));
  on('ui.toast', (_$, e) => value(void toasts.push(e.text)));
  on('session.send', (_$, e) => {
    sent.push({ text: e.text, to: e.to });
    return value({ isDelivered: true });
  });
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text);
    return { text: e.text };
  });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('session.end', () => ({ sessionId: options.session ?? 'sess-a' }));
  on('prompt.context', (_$, e) => ({ blocks: e.blocks }));
  on('ui.open', (_$, e) => {
    opened.push(e.id);
    return value({ isPlaced: true });
  });
  // The engine's own drawing, beneath the plugin: an empty box.
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}));
  on('process.run', async (_$, e) => {
    runs.push({ argv: e.argv, init: e.init });
    return value(options.run ? await options.run(e.argv) : ok());
  });
  return { agents, clock, opened, runs, sent, store, submitted, toasts };
}
