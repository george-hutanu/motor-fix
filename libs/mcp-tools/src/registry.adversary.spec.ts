import { caller, context, fixtureTools } from './fixtures.testing';
import { callTool, visibleTools } from './registry';

describe('the tool registry under hostile calls', () => {
  const run = (
    name: string,
    args: unknown,
    who = caller({ roles: ['driver'] }),
  ) => callTool(fixtureTools, who, context(), name, args);

  it.each([
    '',
    ' ',
    '__proto__',
    'constructor',
    'toString',
    '../get_my_account',
    'GET_MY_ACCOUNT',
    'get_my_account\u0000',
  ])('answers not_found for the tool name %j', async (name) => {
    const result = await run(name, {});

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: 'not_found' });
  });

  it.each(['text', 5, [1]])(
    'answers validation for arguments %j on a tool with no input',
    async (args) => {
      const listed = await visibleTools(
        fixtureTools,
        caller({ roles: ['driver'] }),
        context(),
      );
      expect(listed.length).toBeGreaterThan(0);

      const result = await run((listed[0] as { name: string }).name, args);

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ code: 'validation' });
    },
  );

  it('answers not_found for a tool the roles hide', async () => {
    const who = caller({ roles: ['driver'] });
    const listed = await visibleTools(fixtureTools, who, context());
    const hidden = fixtureTools.find(
      (t) => !listed.some((l) => l.name === t.name),
    );

    expect(hidden).toBeDefined();
    const result = await run((hidden as { name: string }).name, {}, who);
    expect(result.structuredContent).toMatchObject({ code: 'not_found' });
  });

  it('shows no acting tool to a caller with only the read scope', async () => {
    const listed = await visibleTools(
      fixtureTools,
      caller({ roles: ['driver', 'garage', 'admin'] }, ['motorfix.read']),
      context(),
    );

    const acting = new Set(
      fixtureTools.filter((t) => t.acts).map((t) => t.name),
    );
    expect(listed.filter((t) => acting.has(t.name))).toEqual([]);
  });

  it('lists nothing for a caller with no scopes at all', async () => {
    const listed = await visibleTools(
      fixtureTools,
      caller({ roles: ['driver', 'garage', 'admin'] }, []),
      context(),
    );

    expect(listed).toEqual([]);
  });

  it('answers the same twice for the same call', async () => {
    const who = caller({ roles: ['garage'] });
    const first = await run('show_latest_review', {}, who);
    const second = await run('show_latest_review', {}, who);

    expect(second).toEqual(first);
  });
});
