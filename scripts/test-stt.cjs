// Run with: rtk proxy node scripts/test-stt.cjs
// Exercise the real request/response adapter with simulated HTTP; no audio leaves this machine.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const curlModule = require('@bany/curl-to-json');
const curl = curlModule.default || curlModule;

function loadTranscriber({ result = { text: '你好' }, hosted = false, hostedResult, raw = false } = {}) {
  let request;
  const commonExports = {};
  const commonCode = ts.transpileModule(fs.readFileSync('src/lib/functions/common.function.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(commonCode, { exports: commonExports });
  const mockFetch = async (url, init) => {
    request = { url, ...init };
    init.signal?.throwIfAborted();
    return new Response(raw ? result : JSON.stringify(result), { status: 200 });
  };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('src/lib/functions/stt.function.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    exports, Blob, FormData, Response, URLSearchParams, Error, fetch: mockFetch,
    require: (name) => {
      if (name === './common.function') return { ...commonExports, blobToBase64: async () => 'synthetic-audio' };
      if (name === '@bany/curl-to-json') return curl;
      if (name === '@tauri-apps/plugin-http') return { fetch: mockFetch };
      if (name === '@tauri-apps/api/core') return { invoke: async () => hostedResult };
      if (name === './pluely.api') return { shouldUsePluelyAPI: async () => hosted };
      throw new Error(`Unexpected module: ${name}`);
    },
  });
  return { transcribe: exports.fetchSTT, request: () => request };
}

const args = (overrides = {}) => ({
  provider: {
    id: 'test-asr', streaming: false, responseContentPath: 'text',
    curl: 'curl https://example.invalid/asr -H "content-type: multipart/form-data" -F "file={{AUDIO}}" -F "model={{MODEL}}"',
  },
  selectedProvider: { provider: 'test-asr', variables: { model: 'test-model' } },
  audio: new Blob(['synthetic audio'], { type: 'audio/wav' }),
  ...overrides,
});

(async () => {
  const basic = loadTranscriber();
  assert.equal(await basic.transcribe(args()), '你好');
  assert.equal(basic.request().method, 'POST');
  assert.equal(basic.request().body.get('model'), 'test-model');
  assert.equal(basic.request().body.get('file').name, 'audio.wav');
  assert.equal(basic.request().headers['content-type'], undefined);

  const missingConfig = loadTranscriber();
  await assert.rejects(missingConfig.transcribe(args({ selectedProvider: { provider: 'test-asr', variables: {} } })), /填写 MODEL/);
  assert.equal(missingConfig.request(), undefined);

  const asyncJobs = loadTranscriber({ result: { job: { id: 'job-123' } } });
  await assert.rejects(asyncJobs.transcribe(args({ provider: { ...args().provider, id: 'speechmatics-stt', responseContentPath: 'job.id' } })), /异步任务 ID/);
  assert.equal(asyncJobs.request(), undefined);

  const caseSensitive = loadTranscriber({ result: { DisplayText: '大小写正确' } });
  assert.equal(await caseSensitive.transcribe(args({ provider: { ...args().provider, responseContentPath: 'DisplayText' } })), '大小写正确');
  const nested = loadTranscriber({ result: { results: [{ alternatives: [{ transcript: '嵌套文字' }] }] } });
  assert.equal(await nested.transcribe(args({ provider: { ...args().provider, responseContentPath: 'results[0].alternatives[0].transcript' } })), '嵌套文字');

  for (const result of [{}, { text: '' }, { text: '  ' }, { text: 123 }]) {
    await assert.rejects(loadTranscriber({ result }).transcribe(args()), /ASR 未返回可用文字/);
  }
  assert.equal(await loadTranscriber({ result: '  纯文本结果  ', raw: true }).transcribe(args()), '纯文本结果');
  await assert.rejects(loadTranscriber({ result: '  ', raw: true }).transcribe(args()), /ASR 未返回可用文字/);
  await assert.rejects(loadTranscriber({ hosted: true, hostedResult: { success: false, error: '额度不足' } }).transcribe(args()), /额度不足/);
  await assert.rejects(loadTranscriber({ hosted: true, hostedResult: { success: true, transcription: '' } }).transcribe(args()), /ASR 未返回可用文字/);

  const alternateField = loadTranscriber();
  await alternateField.transcribe(args({
    provider: { ...args().provider, curl: 'curl -X POST https://example.invalid/asr -F "data_file=@{{AUDIO}}" -F "config={a:1}"' },
    audio: new Blob(['synthetic'], { type: 'audio/webm;codecs=opus' }),
  }));
  assert.equal(alternateField.request().body.get('data_file').name, 'audio.webm');
  assert.equal(alternateField.request().body.has('file'), false);
  assert.equal(alternateField.request().body.get('config'), '{a:1}');

  const controller = new AbortController();
  controller.abort();
  const cancelled = loadTranscriber();
  await assert.rejects(cancelled.transcribe(args({ signal: controller.signal })), /abort/i);
  assert.equal(cancelled.request(), undefined);
  console.log('ASR regression checks passed: multipart, field names, MIME, JSON paths, empty/error results, cancellation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
