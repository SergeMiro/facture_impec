import { randomBytes } from 'node:crypto';
import { APICallError } from 'ai';
import { describe, expect, it } from 'vitest';
import { aiHandle } from '../ai';
import { failingModel, mockModel, textResult, toolCallResult } from '../test-model';
import { includedAi } from './env';
import { AiDisabledError, createModel } from './models';
import { byokUrlProblem } from './net';
import { probeModel } from './probe';
import { keyHint, openSecret, sealSecret } from './seal';
import { AiSettings, PROVIDERS } from './types';

const settings = (extra: Partial<AiSettings> = {}): AiSettings =>
  AiSettings.parse({
    mode: 'byok',
    provider: 'mistral',
    models: { agent: 'big', classify: 'small' },
    ...extra,
  });

describe('AiSettings', () => {
  it('needs a base URL for Azure and OpenAI-compatible endpoints only', () => {
    expect(() => settings({ provider: 'openai-compatible' })).toThrow(/baseUrl/);
    expect(() => settings({ provider: 'azure' })).toThrow(/baseUrl/);
    expect(settings({ provider: 'anthropic' }).provider).toBe('anthropic');
  });
});

describe('createModel', () => {
  it('builds a model for every provider, the role picking the model id', () => {
    for (const provider of PROVIDERS) {
      const s = settings({
        provider,
        baseUrl: 'https://llm.example.eu/v1',
        headers: { 'X-Title': 'fi' },
        apiVersion: '2025-04-01-preview',
      });
      const model = createModel({ settings: s, apiKey: 'k' }, 'classify');
      expect(typeof model === 'object' && model.modelId).toBe('small');
    }
    const compat = createModel(
      {
        settings: settings({ provider: 'openai-compatible', baseUrl: 'https://x.eu/v1' }),
        apiKey: undefined,
      },
      'agent',
    );
    expect(typeof compat === 'object' && compat.provider).toContain('openai-compatible');
  });

  it('refuses in mode off, and the handle is null then', () => {
    const off = settings({ mode: 'off' });
    expect(() => createModel({ settings: off, apiKey: 'k' }, 'agent')).toThrow(AiDisabledError);
    expect(aiHandle({ settings: off, apiKey: 'k' })).toBeNull();
    expect(aiHandle(null)).toBeNull();
    const handle = aiHandle({
      settings: settings({
        capabilities: { text: true, json: true, tools: false, checkedAt: 'x' },
      }),
      apiKey: 'k',
    });
    expect(handle?.tools).toBe(false);
    expect(handle?.modelId('agent')).toBe('big');
    expect(handle?.model('agent')).toBeTruthy();
  });
});

describe('includedAi', () => {
  it('is null without a provider, and the classify model defaults to the agent one', () => {
    expect(includedAi({})).toBeNull();
    const ai = includedAi({
      AI_PROVIDER: 'openai-compatible',
      AI_MODEL_AGENT: 'auto',
      AI_BASE_URL: 'http://127.0.0.1:47821/v1',
      AI_API_KEY: 'k',
    });
    expect(ai?.settings).toMatchObject({
      mode: 'included',
      models: { agent: 'auto', classify: 'auto' },
    });
    expect(ai?.apiKey).toBe('k');
    expect(() => includedAi({ AI_PROVIDER: 'mistral' })).toThrow();
  });
});

describe('byokUrlProblem', () => {
  it('accepts a public https endpoint', () => {
    expect(byokUrlProblem('https://api.scaleway.ai/v1')).toBeNull();
    expect(byokUrlProblem('https://[2001:db8::1]/v1')).toBeNull();
  });

  it('refuses http, credentials and anything pointing at our own network', () => {
    for (const [url, why] of [
      ['nope', 'not a URL'],
      ['http://api.example.com', 'https required'],
      ['https://u:p@api.example.com', 'credentials in URL'],
      ['https://localhost:8080', 'private host'],
      ['https://ollama.local', 'private host'],
      ['https://intranet', 'private host'],
      ['https://127.0.0.1', 'private address'],
      ['https://2130706433', 'private address'],
      ['https://10.1.2.3', 'private address'],
      ['https://172.20.0.1', 'private address'],
      ['https://192.168.1.10', 'private address'],
      ['https://169.254.169.254', 'private address'],
      ['https://100.93.182.14', 'private address'],
      ['https://0.0.0.0', 'private address'],
      ['https://[::1]', 'private address'],
      ['https://[fd00::1]', 'private address'],
      ['https://[fe80::1]', 'private address'],
      ['https://[::ffff:10.0.0.1]', 'private address'],
    ])
      expect(byokUrlProblem(url as string), url).toBe(why);
  });
});

describe('sealSecret', () => {
  const key = randomBytes(32).toString('base64');

  it('round-trips, and refuses a tampered value or another key', () => {
    const sealed = sealSecret('sk-live-1234567890', key);
    expect(sealed).not.toContain('sk-live');
    expect(openSecret(sealed, key)).toBe('sk-live-1234567890');
    const [v, iv, tag, data = ''] = sealed.split('.');
    const flipped = `${v}.${iv}.${tag}.${data.slice(0, -2)}${data.endsWith('A') ? 'B' : 'A'}${data.slice(-1)}`;
    expect(() => openSecret(flipped, key)).toThrow();
    expect(() => openSecret(sealed, randomBytes(32).toString('base64'))).toThrow();
    expect(() => openSecret('v2.a.b.c', key)).toThrow(/format/);
    expect(() => sealSecret('x', 'short')).toThrow(/32 bytes/);
  });

  it('shows only the last four characters', () => {
    expect(keyHint('sk-live-1234567890')).toBe('…7890');
    expect(keyHint('short')).toBe('…');
  });
});

describe('probeModel', () => {
  const now = () => new Date('2026-10-18T08:00:00Z');

  it('reports text, structured output and tools', async () => {
    const model = mockModel(
      textResult('OK'),
      textResult('{"city":"Paris","country":"France"}'),
      toolCallResult('echo', { word: 'facture' }),
    );
    expect(await probeModel(model, now)).toEqual({
      capabilities: { text: true, json: true, tools: true, checkedAt: '2026-10-18T08:00:00.000Z' },
    });
  });

  it('refuses a model without structured output, accepts one without tools', async () => {
    const noJson = await probeModel(
      mockModel(textResult('OK'), textResult('Paris, bien sûr')),
      now,
    );
    expect(noJson.failure).toBe('json');
    const noTools = await probeModel(
      mockModel(
        textResult('OK'),
        textResult('{"city":"Paris","country":"France"}'),
        textResult('facture'),
      ),
      now,
    );
    expect(noTools).toMatchObject({ capabilities: { tools: false, json: true } });
    expect(noTools.failure).toBeUndefined();
  });

  it('names the failure of the first call', async () => {
    const err = (statusCode: number) =>
      new APICallError({ message: 'x', url: 'https://x', requestBodyValues: {}, statusCode });
    expect((await probeModel(failingModel(err(401)), now)).failure).toBe('auth');
    expect((await probeModel(failingModel(err(404)), now)).failure).toBe('model');
    expect((await probeModel(failingModel(err(502)), now)).failure).toBe('network');
    expect((await probeModel(failingModel(new Error('ECONNREFUSED')), now)).failure).toBe(
      'network',
    );
    expect((await probeModel(mockModel(textResult('  ')), now)).failure).toBe('model');
  });
});
