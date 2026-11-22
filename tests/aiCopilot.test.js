import test from 'node:test';
import assert from 'node:assert/strict';
import { getLLMConfig, resolveInstruments } from '../aiAnalyst.js';

test('definition questions about stop loss do not resolve a random company', async () => {
  const results = await resolveInstruments('What is a stop loss and how do I set one?');
  assert.deepEqual(results.map((item) => item.symbol), []);
});

test('explicit symbols still resolve for grounded questions', async () => {
  const results = await resolveInstruments('Analyze TCS');
  assert.equal(results[0]?.symbol, 'TCS');
});

test('gemini config defaults to a model Google currently serves', () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousModel = process.env.GEMINI_MODEL;
  const previousLLMKey = process.env.LLM_API_KEY;
  const previousOpenAIKey = process.env.OPENAI_API_KEY;
  try {
    process.env.GEMINI_API_KEY = 'test-key';
    delete process.env.GEMINI_MODEL;
    delete process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const config = getLLMConfig();
    assert.equal(config.provider, 'gemini');
    assert.equal(config.model, 'gemini-3.5-flash-lite');
  } finally {
    const restore = (name, value) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore('GEMINI_API_KEY', previousKey);
    restore('GEMINI_MODEL', previousModel);
    restore('LLM_API_KEY', previousLLMKey);
    restore('OPENAI_API_KEY', previousOpenAIKey);
  }
});

test('placeholder keys are ignored so the copilot falls back to computed answers', () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousLLMKey = process.env.LLM_API_KEY;
  const previousOpenAIKey = process.env.OPENAI_API_KEY;
  const previousModel = process.env.GEMINI_MODEL;
  try {
    process.env.GEMINI_API_KEY = 'your_gemini_api_key_here';
    delete process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_MODEL;
    assert.equal(getLLMConfig(), null);
  } finally {
    const restore = (name, value) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore('GEMINI_API_KEY', previousKey);
    restore('GEMINI_MODEL', previousModel);
    restore('LLM_API_KEY', previousLLMKey);
    restore('OPENAI_API_KEY', previousOpenAIKey);
  }
});
