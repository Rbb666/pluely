// Run with: node scripts/test-gemini-proxy.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, dependencies = {}) {
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, Error, URL, TextDecoder,
    require(name) { return dependencies[name] ?? require(name); },
  });
  return exports;
}

const config = load('src/config/ai-providers.constants.ts');
const common = load('src/lib/functions/common.function.ts');
const core = { isTauri: () => true };
let nextResponse;
let request;
const nativeHttp = {
  async fetch(url, options) {
    request = { url, ...options, body: JSON.parse(options.body) };
    return nextResponse;
  },
};
const geminiProxy = load('src/lib/functions/gemini-proxy.function.ts', {
  './common.function': common,
  '@/config/ai-providers.constants': config,
  '@tauri-apps/api/core': core,
  '@tauri-apps/plugin-http': nativeHttp,
});
const { fetchAIResponse } = load('src/lib/functions/ai-response.function.ts', {
  './common.function': common,
  './gemini-proxy.function': geminiProxy,
  './pluely.api': { shouldUsePluelyAPI: async () => false },
  '../chat-constants': {},
  '@/lib': {},
  '@/config/constants': {},
  '@/config/ai-providers.constants': config,
  '@tauri-apps/api/core': core,
  '@tauri-apps/api/event': {},
  '@tauri-apps/plugin-http': nativeHttp,
});

const provider = config.GEMINI_WEB2API_AI_PROVIDER;
const params = {
  provider,
  selectedProvider: { provider: provider.id, variables: { api_key: ' test-key ', model: ' gemini-4-neon-thinking ' } },
  systemPrompt: 'System prompt',
  applyResponseSettings: false,
  userMessage: 'Follow-up',
};
const encode = (text) => new TextEncoder().encode(text);
const frame = (chunk) => `data: ${JSON.stringify(chunk)}\r\n\r\n`;
const delta = (content) => frame({ choices: [{ delta: { content } }] });

function completedStream(...parts) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encode(part));
      controller.close();
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}

async function run() {
  let controller;
  let cancelled = false;
  nextResponse = new Response(new ReadableStream({
    start(streamController) { controller = streamController; },
    cancel() { cancelled = true; },
  }), { headers: { 'Content-Type': 'text/event-stream' } });

  const saved = [
    { timestamp: 7, role: 'assistant', content: 'A valid reply' },
    { timestamp: 6, role: 'user', content: 'A valid question' },
    { timestamp: 5, role: 'assistant', content: 'API 请求失败：503 Service Unavailable' },
    { timestamp: 4, role: 'user', content: 'Failed question 2' },
    { timestamp: 3, role: 'assistant', content: 'API 请求失败：401 Unauthorized' },
    { timestamp: 2, role: 'user', content: 'Failed question 1' },
  ];
  const history = common.buildConversationHistory(Object.freeze(saved));
  const iterator = fetchAIResponse({ ...params, history })[Symbol.asyncIterator]();
  const firstFrame = encode(delta('你好'));
  const split = firstFrame.findIndex((byte) => byte > 127) + 1;
  controller.enqueue(firstFrame.slice(0, split));
  controller.enqueue(firstFrame.slice(split));
  assert.equal((await iterator.next()).value, '你好');
  assert.equal(request.url, provider.defaultEndpoint);
  assert.equal(request.body.stream, true);
  assert.equal(request.body.model, 'gemini-4-neon-thinking');
  assert.equal(request.headers.Authorization, 'Bearer test-key');
  assert.deepEqual(request.body.messages, [
    { role: 'system', content: 'System prompt' },
    { role: 'user', content: 'A valid question' },
    { role: 'assistant', content: 'A valid reply' },
    { role: 'user', content: 'Follow-up' },
  ]);
  controller.enqueue(encode(delta('！') + 'data: [DONE]\r\n\r\n'));
  assert.equal((await iterator.next()).value, '！');
  assert.equal((await iterator.next()).done, true);
  assert.equal(cancelled, true);

  for (const status of [401, 503]) {
    nextResponse = new Response('{"error":{"message":"request failed"}}', { status });
    await assert.rejects(fetchAIResponse(params)[Symbol.asyncIterator]().next(), new RegExp(String(status)));
  }

  nextResponse = completedStream(delta('Partial reply'), frame({ error: { message: 'upstream failure' } }), 'data: [DONE]\n\n');
  const failed = fetchAIResponse(params)[Symbol.asyncIterator]();
  assert.equal((await failed.next()).value, 'Partial reply');
  await assert.rejects(failed.next(), /upstream failure/);

  nextResponse = completedStream(delta('Truncated reply'));
  const truncated = fetchAIResponse(params)[Symbol.asyncIterator]();
  assert.equal((await truncated.next()).value, 'Truncated reply');
  await assert.rejects(truncated.next(), /提前结束/);

  nextResponse = completedStream(frame({ choices: [{ delta: { reasoning_content: 'Only reasoning' } }] }), 'data: [DONE]\n\n');
  await assert.rejects(fetchAIResponse(params)[Symbol.asyncIterator]().next(), /未返回回复正文/);

  const cancellation = new AbortController();
  nextResponse = completedStream(delta('First'), delta('Second'), 'data: [DONE]\n\n');
  const abortable = fetchAIResponse({ ...params, signal: cancellation.signal })[Symbol.asyncIterator]();
  assert.equal((await abortable.next()).value, 'First');
  cancellation.abort();
  assert.equal((await abortable.next()).done, true);

  console.log('Gemini proxy checks passed: streaming, model override, chronological history, failures, and cancellation.');
}

const timeout = setTimeout(() => { throw Error('Gemini proxy regression check timed out'); }, 10000);
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => clearTimeout(timeout));
