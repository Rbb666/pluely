const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const transpile = (file) => ts.transpileModule(fs.readFileSync(file,'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 }
}).outputText;
const helpers = {};
vm.runInNewContext(transpile('src/lib/protected-input.ts'), { exports: helpers });
assert.equal(helpers.deleteAtSelection('中文😀',4,4,true).value,'中文');
assert.equal(helpers.deleteAtSelection('😀中文',0,0,false).value,'中文');
assert.equal(helpers.replaceSelection('你好',0,1,'我').value,'我好');
assert.equal(helpers.replaceSelection('',0,0,'中\n文').value,'中 文');

function harness(query) {
  const slots=[], effects=[];
  let index=0, dirty=true, tree;
  const changed=(a,b)=>!a||a.length!==b.length||a.some((v,i)=>!Object.is(v,b[i]));
  const react = {
    useState(init) { const i=index++; if(!slots[i])slots[i]={value:typeof init==='function'?init():init}; return [slots[i].value,(value)=>{const next=typeof value==='function'?value(slots[i].value):value;if(!Object.is(next,slots[i].value)){slots[i].value=next;dirty=true;}}]; },
    useRef(value) { const i=index++; return (slots[i] ||= {current:value}); },
    useEffect(fn,deps) { const i=index++;const old=slots[i];if(changed(old?.deps,deps)){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});} },
  };
  react.useLayoutEffect=react.useEffect;
  const jsx=(type,props)=>({type,props});
  const exports={};
  vm.runInNewContext(transpile('src/components/ProtectedPinyinInput.tsx'), {
    exports,
    require(name) {
      if(name==='react')return react;
      if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};
      if(name==='./ui/input')return {Input:'input'};
      if(name==='./ui/button')return {Button:'button'};
      if(name==='@/lib/pinyin-engine')return {queryPinyin:query};
      if(name==='@/lib/protected-input')return helpers;
      throw Error(name);
    },
    navigator:{clipboard:{writeText:async()=>{},readText:async()=>''}},
  });
  let submits=0,open=false,composing=false;
  const props={value:'',onChange(value){props.value=value;dirty=true;},onSubmit(){submits++;},onCandidatesOpenChange(value){open=value;},onCompositionActiveChange(value){composing=value;}};
  const node={value:'',selectionStart:0,selectionEnd:0,setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},focus(){},blur(){}};
  const all=(element=tree)=>element? [element,...(Array.isArray(element.props?.children)?element.props.children:[element.props?.children]).filter(v=>typeof v==='object'&&v).flatMap(v=>Array.isArray(v)?v.flatMap(e=>all(e)):all(v))]:[];
  function flush(){let n=0;while(dirty||effects.length){if(++n>40)throw Error('render loop');if(dirty){dirty=false;index=0;tree=exports.ProtectedPinyinInput(props);const input=all().find(e=>e.type==='input');node.value=props.value;input.props.ref(node);}while(effects.length)effects.shift()();}}
  function input(){return all().find(e=>e.type==='input');}
  function keyboardEvent(handler,key,overrides={}){flush();const e={key,nativeEvent:{isComposing:false,keyCode:0},preventDefault(){this.defaultPrevented=true;},stopPropagation(){},...overrides};input().props[handler](e);flush();return e;}
  const key=(value,overrides)=>keyboardEvent('onKeyDown',value,overrides);
  const keyUp=(value,overrides)=>keyboardEvent('onKeyUp',value,overrides);
  const settle=async()=>{await Promise.resolve();await Promise.resolve();flush();};
  flush();
  return {props,node,key,keyUp,settle,flush,all,input,rerender(){dirty=true;flush();},focus(){input().props.onFocus();flush();},get composing(){return composing;},get submits(){return submits;},get open(){return open;}};
}

(async()=>{
  const ui=harness(async p=>p==='nihao'?[{text:'你好',consumed:5}]:p==='ni'?[{text:'你',consumed:2}]:[]);
  ui.focus();
  assert.equal(ui.input().props.readOnly,true);
  for(const c of 'nihao')ui.key(c);
  await ui.settle();
  assert.ok(ui.all().some(e=>e.props?.['aria-label']==='候选 1：你好'));
  ui.key('Enter');
  assert.equal(ui.props.value,'你好');assert.equal(ui.submits,0);
  assert.equal(ui.composing,false);
  ui.key('Enter',{repeat:true});assert.equal(ui.submits,0,'holding Enter after selection must not send');
  ui.key('Enter');assert.equal(ui.submits,1);assert.equal(ui.open,false);
  ui.input().props.onFocus();ui.flush();assert.equal(ui.open,false,'completion auto-focus must not hide the AI reply');
  ui.key('n');assert.equal(ui.open,true);assert.equal(ui.composing,true);
  ui.key('Escape');
  ui.key('x',{nativeEvent:{isComposing:true,keyCode:229}});
  assert.equal(ui.props.value,'你好');assert.ok(ui.all().some(e=>e.props?.role==='alert'));
  assert.equal(ui.input().props.disabled,true);
  ui.input().props.onBlur();ui.flush();assert.equal(ui.open,true,'IME warning must remain visible after blur');
  ui.key('a');ui.key('Enter');assert.equal(ui.submits,1);assert.equal(ui.composing,false);
  const retry=ui.all().find(e=>e.props?.title==='确认已切换到英文输入状态，再恢复应用内拼音选字');
  assert.ok(retry);retry.props.onClick();ui.flush();assert.equal(ui.input().props.disabled,false);
  ui.key('n');assert.equal(ui.composing,true);
  ui.props.disabled=true;ui.rerender();assert.equal(ui.open,false);

  let resolveOld;
  const race=harness(p=>p==='n'?new Promise(resolve=>resolveOld=resolve):Promise.resolve([{text:'你',consumed:2}]));
  race.focus();race.key('n');race.key('i');await race.settle();
  resolveOld([{text:'嗯',consumed:1}]);await race.settle();
  race.key('1');assert.equal(race.props.value,'你');

  const partial=harness(async p=>p==='nihao'?[{text:'你',consumed:2}]:p==='hao'?[{text:'好',consumed:3}]:[]);
  partial.focus();for(const c of 'nihao')partial.key(c);await partial.settle();
  partial.key(' ');await partial.settle();partial.key(' ');assert.equal(partial.props.value,'你好');
  let prevented=false;partial.input().props.onContextMenu({preventDefault(){prevented=true;}});assert.equal(prevented,true);

  const shortcut = harness(async (pinyin) => pinyin === 'ni' ? [{ text: '你', consumed: 2 }] : []);
  shortcut.focus();
  const mode = () => shortcut.input().props['aria-label'];
  const left = { code: 'ShiftLeft' };
  const right = { code: 'ShiftRight' };
  const pinyinMode = '应用内拼音输入';
  const englishMode = '应用内英文输入';

  shortcut.key('Shift', left);
  shortcut.key('Shift', { ...left, repeat: true });
  assert.equal(mode(), pinyinMode, 'Shift keydown and autorepeat must not switch modes');
  assert.equal(shortcut.keyUp('Shift', left).defaultPrevented, true);
  assert.equal(mode(), englishMode, 'a left Shift tap must switch to English exactly once');

  shortcut.key('Shift', left);
  shortcut.key('A', { shiftKey: true });
  shortcut.keyUp('A', { shiftKey: true });
  shortcut.keyUp('Shift', left);
  assert.equal(shortcut.props.value, 'A');
  assert.equal(mode(), englishMode, 'typing a capital letter must not switch modes');

  shortcut.key('Shift', left);
  const selectionKey = shortcut.key('ArrowLeft', { shiftKey: true });
  shortcut.keyUp('Shift', left);
  assert.equal(selectionKey.defaultPrevented, undefined, 'Shift+Arrow must retain native selection');
  assert.equal(mode(), englishMode);

  shortcut.key('Shift', { ...right, ctrlKey: true });
  shortcut.keyUp('Control');
  shortcut.keyUp('Shift', right);
  assert.equal(mode(), englishMode, 'Ctrl+Shift must not switch modes when Ctrl is released first');

  shortcut.key('Shift', left);
  shortcut.key('Shift', right);
  shortcut.keyUp('Shift', right);
  shortcut.keyUp('Shift', left);
  assert.equal(mode(), englishMode, 'using both Shift keys must not switch modes');

  shortcut.key('Shift', left);
  shortcut.input().props.onBlur();
  shortcut.focus();
  shortcut.keyUp('Shift', left);
  assert.equal(mode(), englishMode, 'a Shift tap must not survive loss of focus');

  shortcut.key('Shift', left);
  shortcut.all().find((element) => element.props?.onPointerDown).props.onPointerDown();
  shortcut.keyUp('Shift', left);
  assert.equal(mode(), englishMode, 'Shift+click must not switch modes');

  shortcut.key('Shift', right);
  shortcut.keyUp('Shift', right);
  assert.equal(mode(), pinyinMode, 'right Shift must switch back to pinyin');
  shortcut.key('n');
  shortcut.key('i');
  await shortcut.settle();
  assert.equal(shortcut.composing, true);
  shortcut.key('Shift', left);
  shortcut.keyUp('Shift', left);
  assert.equal(shortcut.props.value, 'Ani', 'switching mid-composition must preserve the typed pinyin');
  assert.equal(shortcut.composing, false);
  assert.equal(mode(), englishMode);

  console.log('Protected pinyin checks passed: Shift mode switching, shortcut and selection handling, composition, IME rejection, editing, and focus.');
})().catch(error=>{console.error(error);process.exitCode=1;});
