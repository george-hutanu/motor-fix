// @traces 365-FR-001 365-FR-003 365-FR-013
import { ASSISTANT_ENV, assistantSettings } from './env';

const values = {
  ASSISTANT_BROKER_CLIENT_ID: 'motorfix-broker',
  ASSISTANT_BROKER_CLIENT_SECRET: 'broker-secret-value',
  ASSISTANT_BROKER_REDIRECT_URI:
    'https://id.motorfix.example/realms/motorfix-assistants/broker/motorfix/endpoint',
  ASSISTANT_ISSUER: 'https://id.motorfix.example/realms/motorfix-assistants',
  ASSISTANT_TRUSTED_DOMAINS: 'claude.ai, chatgpt.com,,localhost',
  MCP_URL: 'https://mcp.motorfix.example/mcp',
};

describe('assistantSettings', () => {
  it('reads the six assistant variables', () => {
    expect(assistantSettings({ APP_ENV: 'test', ...values })).toEqual({
      broker: {
        clientId: 'motorfix-broker',
        clientSecret: 'broker-secret-value',
        redirectUri:
          'https://id.motorfix.example/realms/motorfix-assistants/broker/motorfix/endpoint',
      },
      issuer: 'https://id.motorfix.example/realms/motorfix-assistants',
      mcpUrl: 'https://mcp.motorfix.example/mcp',
      trustedDomains: ['claude.ai', 'chatgpt.com', 'localhost'],
    });
  });

  it('lists exactly the six names', () => {
    expect([...ASSISTANT_ENV].sort()).toEqual(Object.keys(values).sort());
  });

  it.each(Object.keys(values))(
    'names %s when it is missing, without printing any value',
    (name) => {
      const source: Record<string, string | undefined> = {
        APP_ENV: 'test',
        ...values,
      };
      delete source[name];
      const run = () => assistantSettings(source);

      expect(run).toThrow(name);
      expect(run).not.toThrow(/broker-secret-value/);
    },
  );

  it.each(['MCP_URL', 'ASSISTANT_ISSUER', 'ASSISTANT_BROKER_REDIRECT_URI'])(
    'refuses %s when it is not an absolute http(s) address',
    (name) => {
      const run = () =>
        assistantSettings({ APP_ENV: 'test', ...values, [name]: 'mcp/local' });

      expect(run).toThrow(`${name} must be an absolute http(s) URL`);
      expect(run).not.toThrow(/mcp\/local/);
    },
  );
});
