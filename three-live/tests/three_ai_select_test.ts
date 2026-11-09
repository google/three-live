// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import {getSharedRegistry, registerPlugin} from '../src/plugin';
import {aiPlugin, normalizeSelection, selectionSentence, type ThreeLiveAIProvider} from '../src/plugins/ai';
import {describeSelection, getSelection, MAX_SELECTION, setSelection} from '../src/plugins/ai-select';
import {type AIVoiceTransport} from '../src/plugins/ai-voice';
import {Scene, THREE} from '../src/three-author';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string): void {
  if (condition) {
    console.log(`   ✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`   ❌ [FAIL] ${testName}`);
    failed++;
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

getSharedRegistry().scriptRunner = {
  async execute(script: string, _sandbox: string, cb: any) {
    setTimeout(() => {
      try {
        const scene = new Scene();
        // eslint-disable-next-line no-new-func
        new Function('THREE', 'scene', 'camera', script)(THREE, scene, {});
        const glb = scene.toGLB();
        cb.onModelReady(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength));
      } catch (e) {
        cb.onError?.(e);
      }
    }, 0);
    return {terminate() {}};
  },
};

const box = (name: string, x: number, color = '0x888888') =>
  `{ const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: ${color} })); m.name = '${name}'; m.position.set(${x}, 0.5, 0); scene.add(m); }`;
const BASE = [box('Roof', 0), box('Door', 2), box('Chimney', -2)].join('\n');

function fakeElement(attrs: Record<string, string> = {}) {
  const listeners = new Map<string, Set<(e: Event) => void>>();
  const events: Array<{type: string; detail: any}> = [];
  const highlighted: string[][] = [];
  const el: any = {
    allowClientScripts: true,
    sandbox: 'worker',
    selectedMesh: null,
    viewer: {setSelectedMeshes: (names: readonly string[]) => highlighted.push([...names])},
    querySelector: (sel: string) => (sel.includes('text/three') ? {textContent: BASE} : null),
    getAttribute: (n: string) => attrs[n] ?? null,
    hasAttribute: (n: string) => n in attrs,
    addEventListener(type: string, fn: (e: Event) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (e: Event) => void) {
      listeners.get(type)?.delete(fn);
    },
    fireEvent(type: string, detail: any) {
      events.push({type, detail});
      for (const fn of [...(listeners.get(type) ?? [])]) fn({detail} as any);
    },
    dispatch(type: string, ev: any) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(ev);
    },
    executeScript: () => Promise.resolve(),
  };
  aiPlugin.onElementConnected!(el);
  return {el, events, highlighted};
}

function scripted(replies: string[]) {
  const requests: any[] = [];
  const provider: ThreeLiveAIProvider = {
    async complete(req) {
      requests.push(req.messages.map((m) => ({...m})));
      const r = replies.shift();
      if (r === undefined) throw new Error('no more replies');
      return r;
    },
  };
  return {provider, requests};
}

async function run(): Promise<void> {
  console.log('\n🎯 three-live-ai (B2b-4) Talk-to-Select');
  registerPlugin(aiPlugin);

  // ---- 4a: selection state ----
  {
    const {el, events, highlighted} = fakeElement();
    assert(Array.isArray(el.selectedMeshes) && el.selectedMeshes.length === 0, 'selectedMeshes starts empty');
    const d1 = setSelection(el, ['Roof'], {source: 'voice', query: 'the roof'});
    assert(
      d1!.mesh === 'Roof' && d1!.added.join() === 'Roof' && d1!.source === 'voice' && d1!.query === 'the roof' &&
        el.selectedMesh === 'Roof',
      'replace selects one mesh and mirrors selected-mesh',
    );
    setSelection(el, ['Door', 'Roof'], {mode: 'add'});
    assert(el.selectedMeshes.join() === 'Roof,Door' && el.selectedMesh === 'Roof', 'add keeps order and de-duplicates');
    assert(highlighted.at(-1)!.join() === 'Roof,Door', 'the viewer highlights the whole set');
    setSelection(el, ['Roof', 'Chimney'], {mode: 'toggle'});
    assert(el.selectedMeshes.join() === 'Door,Chimney' && el.selectedMesh === 'Door', 'toggle flips membership');
    setSelection(el, ['Door'], {mode: 'remove'});
    assert(el.selectedMeshes.join() === 'Chimney', 'remove drops meshes');
    assert(setSelection(el, ['Chimney']) === null, 'an unchanged selection fires nothing');
    setSelection(el, null, {mode: 'clear'});
    assert(el.selectedMeshes.length === 0 && el.selectedMesh === null, 'clear empties the selection');
    const sel = events.filter((e) => e.type === 'three-live-select');
    assert(sel.length === 5 && sel[2].detail.removed.join() === 'Roof' && sel[2].detail.added.join() === 'Chimney', 'events carry added / removed');

    el.selectedMeshes = ['A', 'B', 'A', '', 7 as any];
    assert(el.selectedMeshes.join() === 'A,B', 'the selectedMeshes setter cleans its input');
    el.selectedMesh = 'Lamp';
    assert(getSelection(el).join() === 'Lamp', 'an external selected-mesh change wins');
    setSelection(el, Array.from({length: 80}, (_, i) => `M${i}`));
    assert(el.selectedMeshes.length === MAX_SELECTION, 'selections are capped');

    setSelection(el, ['Roof', 'Door']);
    const before = highlighted.length;
    el.fireEvent('three-load', {});
    assert(highlighted.length === before + 1 && highlighted.at(-1)!.join() === 'Roof,Door', 'a reload re-applies the multi highlight');
  }

  // ---- 4a: shared prompt helpers ----
  {
    assert(normalizeSelection(['A', 'A', '', 'B']).join() === 'A,B' && normalizeSelection('A').join() === 'A', 'normalizeSelection');
    assert(selectionSentence([]) === '', 'no selection, no sentence');
    assert(selectionSentence(['Roof']) === 'The user selected the mesh named "Roof"; the instruction refers to it.\n', 'single-mesh wording is unchanged');
    assert(
      selectionSentence(['Roof', 'Door']) === 'The user selected the meshes named "Roof", "Door"; the instruction refers to them.\n',
      'multi-mesh wording',
    );
    assert(describeSelection([]) === 'The user cleared the selection.', 'describeSelection empty');
    assert(describeSelection(['A', 'B']).startsWith('The user selected 2 meshes: "A", "B".'), 'describeSelection many');
    assert(describeSelection(Array.from({length: 25}, (_, i) => `M${i}`)).includes('and 5 more'), 'describeSelection truncates');
  }

  // ---- 4a: editScene with a multi selection ----
  {
    const {el} = fakeElement();
    const blue = BASE.replace(/0x888888/g, '0x1a73e8');
    const {provider, requests} = scripted(['```js\n' + blue + '\n```']);
    el.aiProvider = provider;
    setSelection(el, ['Roof', 'Door']);
    const res = await el.editScene('make them blue');
    assert(res.applied, 'a multi-selection edit applies');
    assert(requests[0][1].content.includes('The user selected the meshes named "Roof", "Door"'), 'the prompt names every selected mesh');

    const dropped = [box('Roof', 0), box('Chimney', -2)].join('\n');
    const {provider: p2} = scripted(['```js\n' + dropped + '\n```', '```js\n' + dropped + '\n```']);
    const lost = await el.editScene('make them blue', {provider: p2});
    assert(!lost.applied && lost.error === 'The edited scene no longer contains the selected mesh "Door".', 'losing any selected mesh rejects the edit');
    const {provider: p3} = scripted(['```js\n' + dropped + '\n```']);
    assert((await el.editScene('remove the door', {provider: p3})).applied, 'removal instructions may drop selected meshes');
    const {provider: p4, requests: r4} = scripted(['```js\n' + BASE + '\n```']);
    await el.editScene('add a lamp', {provider: p4, selection: []});
    assert(!r4[0][1].content.includes('selected'), 'selection: [] edits with no selection');
  }

  // ---- 4a: tap gestures ----
  {
    const {el} = fakeElement({'ai-select-on-tap': ''});
    const tap = (name: string, opts: any = {}) => {
      el.dispatch('pointerdown', {shiftKey: !!opts.shift, ctrlKey: false, metaKey: !!opts.meta});
      el.fireEvent('meshclick', {meshName: name});
    };
    tap('Roof');
    tap('Door');
    assert(el.selectedMeshes.join() === 'Door', 'a plain tap replaces the selection');
    tap('Roof', {shift: true});
    tap('Chimney', {meta: true});
    assert(el.selectedMeshes.join() === 'Door,Roof,Chimney', 'Shift / Cmd-tap adds');
    tap('Roof', {shift: true});
    assert(el.selectedMeshes.join() === 'Door,Chimney', 'Shift-tap on a selected mesh removes it');
    tap('Door');
    assert(el.selectedMeshes.join() === 'Door', 'a plain tap on a multi selection narrows to that mesh');
    tap('Door');
    assert(el.selectedMeshes.length === 0, 'a plain tap on the only selected mesh clears');
    const realNow = Date.now;
    let t = 1000;
    Date.now = () => t;
    el.dispatch('pointerdown', {});
    t += 600;
    el.fireEvent('meshclick', {meshName: 'Roof'});
    el.dispatch('pointerdown', {});
    t += 700;
    el.fireEvent('meshclick', {meshName: 'Door'});
    Date.now = realNow;
    assert(el.selectedMeshes.join() === 'Roof,Door', 'a long press adds');
    const selects = [] as string[];
    el.addEventListener('three-live-select', (e: any) => selects.push(e.detail.source));
    tap('Chimney');
    assert(selects.join() === 'tap', 'tap changes report source: tap');
  }

  // ---- 4a: voice sessions see the multi selection ----
  {
    const {el} = fakeElement();
    el.aiProvider = scripted([]).provider;
    setSelection(el, ['Roof', 'Door']);
    const sent: any[] = [];
    const transport: AIVoiceTransport = {send: (m) => sent.push(m), close() {}};
    const session = await el.connectVoice({transport, microphone: false, playAudio: false});
    assert(
      sent.some((m) => m.item?.role === 'system' && m.item.content[0].text.startsWith('The user selected 2 meshes: "Roof", "Door".')),
      'a new session is told about every selected mesh',
    );
    setSelection(el, ['Chimney'], {mode: 'add'});
    await tick();
    assert(sent.at(-1).item.content[0].text.includes('3 meshes'), 'selection changes are forwarded');
    session.close();
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
