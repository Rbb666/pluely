// Run with: rtk proxy node scripts/test-auto-speech.cjs
// Execute the actual component handlers with simulated hooks, microphone, VAD and requests.
// This test never opens a real microphone or contacts an ASR/LLM service.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 20; i++)
    await Promise.resolve(); };
const code = ts.transpileModule(fs.readFileSync('src/pages/app/components/completion/AutoSpeechVad.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function harness() {
    let slots = [], slot = 0, effects = [], tree, props, sttCalls = [], submits = [], instances = [], contexts = [], active = [], cancelled = 0, tracks = [];
    const state = { stt: deferred(), reply: deferred(), model: null };
    const jsx = (type, props) => ({ type, props });
    const react = { useRef: v => { const i = slot++; return slots[i] || (slots[i] = { current: v }); }, useState: v => { const i = slot++; if (!(i in slots))
            slots[i] = v; return [slots[i], x => { slots[i] = typeof x === 'function' ? x(slots[i]) : x; }]; }, useCallback: (fn) => { slot++; return fn; }, useEffect: fn => { slot++; effects.push(fn); } };
    class AudioContext {
        constructor() { this.state = 'running'; this.closed = 0; contexts.push(this); }
        async resume() { }
        async close() { this.state = 'closed'; this.closed++; }
        createMediaStreamSource() { return { disconnect() { } }; }
    }
    const newStream = () => { const listeners = {}; const track = { enabled: true, stopped: 0, stop() { this.stopped++; }, addEventListener(n, fn) { listeners[n] = fn; }, end() { listeners.ended?.(); } }; tracks.push(track); return { getTracks: () => [track], getAudioTracks: () => [track] }; };
    const exports = {};
    const app = { selectedSttProvider: { provider: 'mock', variables: {} }, selectedAIProvider: { provider: 'mock' }, selectedAudioDevices: { input: { id: 'mock', name: 'mock' } }, allSttProviders: [{ id: 'mock' }] };
    vm.runInNewContext(code, { exports, AudioContext, AbortController, Float32Array, setTimeout, clearTimeout, require: name => {
            if (name === 'react')
                return react;
            if (name === 'react/jsx-runtime')
                return { jsx, jsxs: jsx };
            if (name === '@ricky0123/vad-web')
                return { AudioNodeVAD: { new: async (ctx, options) => { const item = { options, starts: 0, pauses: 0, destroys: 0, start() { this.starts++; }, pause() { this.pauses++; }, destroy() { this.destroys++; }, receive() { } }; instances.push(item); if (state.model)
                            await state.model.promise; return item; } } };
            if (name === 'lucide-react')
                return {};
            if (name === '@/components')
                return { Button: 'button' };
            if (name === '@/contexts')
                return { useApp: () => app };
            if (name === '@/lib/functions')
                return { shouldUsePluelyAPI: async () => false, fetchSTT: args => { sttCalls.push(args); return state.stt.promise; } };
            if (name === '@/lib/microphone')
                return { openMicrophone: async () => ({ stream: newStream(), deviceName: 'mock', warning: '' }), microphoneErrorMessage: e => e.message };
            if (name === '@/lib/utils')
                return { floatArrayToWav: audio => audio };
            if (name.includes('audio-visualizer'))
                return { AudioVisualizer: 'visualizer' };
            throw Error(name);
        } });
    props = { submit: text => { submits.push(text); return state.reply.promise; }, cancel: () => cancelled++, onClose() { }, onActiveChange: a => active.push(a) };
    const render = () => { slot = 0; effects = []; tree = exports.AutoSpeechVAD(props); };
    render();
    const unmount = effects[0]();
    function button(title) { render(); let found; const visit = n => { if (!n || typeof n !== 'object')
        return; if (n.type === 'button' && n.props.title === title)
        found = n; for (const c of [].concat(n.props?.children || []))
        visit(c); }; visit(tree); assert.ok(found, title); return found.props.onClick; }
    return { state, tracks, contexts, instances, sttCalls, submits, active, props, render, unmount, mount: () => effects[0](), cancelCount: () => cancelled, start: () => button('开始麦克风自动聆听，停顿后识别并发送给 AI')(), stop: () => button('停止自动聆听，丢弃尚未断句的录音并取消当前识别或回复')() };
}
(async () => {
    const h = harness();
    assert.equal(h.tracks.length, 0, 'mount must not record');
    h.start();
    await flush();
    const vad = h.instances[0];
    assert.equal(vad.options.redemptionFrames, 32);
    assert.equal(vad.options.submitUserSpeechOnPause, false);
    assert.equal(vad.starts, 1);
    vad.options.onSpeechEnd(new Float32Array(100));
    vad.options.onSpeechEnd(new Float32Array(100));
    await flush();
    assert.equal(h.sttCalls.length, 1, 'ASR must be serialized');
    assert.equal(h.tracks[0].enabled, false);
    h.state.stt.resolve('你好');
    await flush();
    assert.deepEqual(h.submits, ['你好']);
    assert.equal(vad.starts, 1, 'do not resume before LLM finishes');
    h.state.reply.resolve();
    await flush();
    assert.equal(vad.starts, 2);
    assert.equal(h.tracks[0].enabled, true);
    let latestCalled = false;
    h.props.submit = async () => { latestCalled = true; };
    h.render();
    h.state.stt = deferred();
    vad.options.onSpeechEnd(new Float32Array(100));
    await flush();
    h.state.stt.resolve('第二句');
    await flush();
    assert.equal(latestCalled, true, 'use latest submit closure');
    h.stop();
    assert.equal(h.tracks[0].stopped, 1);
    assert.equal(h.contexts[0].closed, 1);
    assert.equal(h.cancelCount(), 0, 'completed reply must not be cancelled');
    const late = harness();
    late.start();
    await flush();
    late.instances[0].options.onSpeechEnd(new Float32Array(100));
    await flush();
    late.stop();
    assert.equal(late.sttCalls[0].signal.aborted, true);
    late.state.stt.resolve('迟到文字');
    await flush();
    assert.equal(late.submits.length, 0);
    late.instances[0].options.onSpeechEnd(new Float32Array(100));
    await flush();
    assert.equal(late.sttCalls.length, 1, 'late VAD callback ignored');
    const replying = harness();
    replying.start();
    await flush();
    replying.instances[0].options.onSpeechEnd(new Float32Array(100));
    await flush();
    replying.state.stt.resolve('取消回复');
    await flush();
    replying.stop();
    assert.equal(replying.cancelCount(), 1);
    replying.state.reply.resolve();
    await flush();
    assert.equal(replying.instances[0].starts, 1);
    const initializing = harness();
    initializing.state.model = deferred();
    initializing.start();
    await flush();
    initializing.stop();
    assert.equal(initializing.tracks[0].stopped, 1);
    initializing.state.model.resolve();
    await flush();
    assert.equal(initializing.instances[0].destroys, 1);
    assert.equal(initializing.instances[0].starts, 0);
    const disconnect = harness();
    disconnect.start();
    await flush();
    disconnect.tracks[0].end();
    await flush();
    assert.equal(disconnect.tracks[0].stopped, 1);
    assert.equal(disconnect.active.at(-1), false);
    const strict = harness();
    strict.unmount();
    strict.render();
    const strictCleanup = strict.mount();
    assert.equal(strict.tracks.length, 0);
    strict.start();
    await flush();
    strictCleanup();
    assert.equal(strict.tracks[0].stopped, 1);
    assert.equal(strict.contexts[0].closed, 1);
    assert.equal(strict.instances[0].destroys, 1);
    const failed = harness();
    failed.start();
    await flush();
    failed.instances[0].options.onSpeechEnd(new Float32Array(100));
    await flush();
    failed.state.stt.reject(new Error('ASR failed'));
    await flush();
    assert.equal(failed.submits.length, 0);
    assert.equal(failed.active.at(-1), false);
    assert.equal(failed.tracks[0].stopped, 1);
    console.log('Auto VAD lifecycle passed: explicit start, silence config, serial ASR/LLM, latest props, cancellation, stale callbacks, initialization cleanup, device disconnect, StrictMode cleanup, ASR errors.');
})().catch(e => { console.error(e); process.exitCode = 1; });
