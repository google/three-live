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
import {
  aiPlugin,
  createAIChatProvider,
  editScene,
  extractScript,
  type ThreeLiveAIProvider,
} from '../src/plugins/ai';
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

async function rejects(p: Promise<unknown>, needle: string): Promise<boolean> {
  try {
    await p;
    return false;
  } catch (e: any) {
    return String(e?.message ?? e).includes(needle);
  }
}

// In-process stand-in for the sandbox runner: compiles with the real author
// runtime and reports a real GLB (or the thrown error).
const runnerCalls: string[] = [];
getSharedRegistry().scriptRunner = {
  async execute(script: string, _sandbox: string, cb: any) {
    runnerCalls.push(script);
    setTimeout(() => {
      try {
        const scene = new Scene();
        // eslint-disable-next-line no-new-func
        new Function('THREE', 'scene', 'camera', script)(THREE, scene, {});
        const glb = scene.toGLB();
        const buf = glb.buffer.slice(
          glb.byteOffset,
          glb.byteOffset + glb.byteLength,
        );
        if (script.includes('/*warn*/'))
          cb.onToast?.('degraded: RectAreaLight');
        cb.onModelReady(buf);
      } catch (e) {
        cb.onError?.(e);
      }
    }, 0);
    return {terminate() {}};
  },
};

const BASE = `
const roof = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 2), new THREE.MeshStandardMaterial({ color: 0x334155 }));
roof.name = 'Roof';
roof.position.y = 2;
scene.add(roof);
`;

function fakeElement(opts: {allow?: boolean; selected?: string | null} = {}) {
  const events: Array<{type: string; detail: any}> = [];
  const executed: string[] = [];
  const attrs: Record<string, string> = {};
  const el: any = {
    allowClientScripts: opts.allow ?? true,
    sandbox: 'worker',
    selectedMesh: opts.selected ?? null,
    failNextExecute: false,
    querySelector: (sel: string) =>
      sel.includes('text/three') ? {textContent: BASE} : null,
    getAttribute: (n: string) => attrs[n] ?? null,
    setAttribute: (n: string, v: string) => {
      attrs[n] = v;
    },
    fireEvent: (type: string, detail: any) => events.push({type, detail}),
    executeScript(script: string) {
      executed.push(script);
      if (el.failNextExecute) {
        el.failNextExecute = false;
        return Promise.reject(new Error('viewer limits exceeded'));
      }
      return Promise.resolve();
    },
  };
  aiPlugin.onElementConnected!(el);
  return {el, events, executed};
}

/** Provider that replays scripted replies and records requests. */
function scripted(replies: Array<string | (() => Promise<string>)>) {
  const requests: any[] = [];
  const provider: ThreeLiveAIProvider = {
    async complete(req) {
      requests.push(req.messages.map((m) => ({...m})));
      const r = replies.shift();
      if (r === undefined) throw new Error('no more replies');
      return typeof r === 'function' ? r() : r;
    },
  };
  return {provider, requests};
}

const fenced = (code: string) =>
  `Here you go:\n\`\`\`js\n${code}\n\`\`\`\nDone.`;
const WITH_LAMP = `${BASE}
const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2), new THREE.MeshStandardMaterial({ color: 0xffd166 }));
lamp.name = 'Lantern';
lamp.position.set(1, 1.6, 1);
scene.add(lamp);
`;

async function run(): Promise<void> {
  console.log('\n🤖 three-live-ai (B2a) bring-your-own-LLM scene editing');
  registerPlugin(aiPlugin);

  // extractScript
  assert(
    extractScript(fenced('scene.add(x);')) === 'scene.add(x);' &&
      extractScript('```\nplain();\n```\n```js\npreferred();\n```') ===
        'preferred();' &&
      extractScript('```javascript\ntruncated();') === 'truncated();' &&
      extractScript('scene.add(new THREE.Mesh());') ===
        'scene.add(new THREE.Mesh());' &&
      extractScript('Sorry, I cannot help with that.') === '',
    'extractScript handles js/plain/unterminated fences, raw code, and prose',
  );

  // ai-chat provider: endpoint policy, request shape, response parsing, errors
  assert(
    (await rejects(
      Promise.resolve().then(() =>
        createAIChatProvider({endpoint: 'http://example.com/v1'}),
      ),
      'https',
    )) &&
      (await rejects(
        Promise.resolve().then(() =>
          createAIChatProvider({endpoint: 'javascript:alert(1)'}),
        ),
        'https',
      )),
    'ai-chat rejects non-https remote endpoints and non-http schemes',
  );
  let seen: any = null;
  const okFetch = (async (url: string, init: any) => {
    seen = {url, init, body: JSON.parse(init.body)};
    return new Response(
      JSON.stringify({choices: [{message: {content: [{text: 'a'}, 'b']}}]}),
      {status: 200},
    );
  }) as any;
  const chat = createAIChatProvider({
    endpoint: 'http://localhost:11434/v1/chat/completions',
    model: 'llama3.1',
    headers: {Authorization: 'Bearer short-lived'},
    fetch: okFetch,
  });
  const out = await chat.complete({messages: [{role: 'user', content: 'hi'}]});
  assert(
    out === 'ab' &&
      seen.url === 'http://localhost:11434/v1/chat/completions' &&
      seen.init.method === 'POST' &&
      seen.init.headers.Authorization === 'Bearer short-lived' &&
      seen.init.headers['Content-Type'] === 'application/json' &&
      seen.body.model === 'llama3.1' &&
      seen.body.stream === false &&
      seen.body.messages[0].content === 'hi',
    'ai-chat posts {model, messages} with headers and joins content parts',
  );
  const errChat = createAIChatProvider({
    endpoint: 'https://proxy.test/chat',
    retryDelayMs: 5,
    fetch: (async () => new Response('rate limited', {status: 429})) as any,
  });
  const junkChat = createAIChatProvider({
    endpoint: 'https://proxy.test/chat',
    fetch: (async () => new Response('<html>', {status: 200})) as any,
  });
  const emptyChat = createAIChatProvider({
    endpoint: 'https://proxy.test/chat',
    fetch: (async () =>
      new Response(JSON.stringify({choices: []}), {status: 200})) as any,
  });
  assert(
    (await rejects(errChat.complete({messages: []}), 'HTTP 429')) &&
      (await rejects(junkChat.complete({messages: []}), 'non-JSON')) &&
      (await rejects(emptyChat.complete({messages: []}), 'no message content')),
    'ai-chat surfaces HTTP errors, non-JSON bodies, and empty replies',
  );
  const hangFetch = ((_u: string, init: any) =>
    new Promise((_res, rej) =>
      init.signal.addEventListener('abort', () => rej(init.signal.reason)),
    )) as any;
  const abortCtrl = new AbortController();
  const hanging = createAIChatProvider({
    endpoint: 'https://proxy.test/chat',
    fetch: hangFetch,
    timeoutMs: 1000,
  });
  const abortedP = hanging.complete({messages: [], signal: abortCtrl.signal});
  abortCtrl.abort(new Error('user cancelled'));
  assert(
    (await rejects(abortedP, 'user cancelled')) &&
      (await rejects(hanging.complete({messages: []}), 'timed out')),
    'ai-chat forwards caller aborts and enforces its timeout',
  );

  // Happy path: validated, applied, undoable, evented.
  {
    const {el, events, executed} = fakeElement({selected: 'Roof'});
    const {provider, requests} = scripted([fenced(WITH_LAMP)]);
    const res = await el.editScene('hang a lantern from the roof corner', {
      provider,
    });
    const userMsg = requests[0][1].content;
    assert(
      res.applied &&
        res.repairs === 0 &&
        res.code.includes("lamp.name = 'Lantern'") &&
        executed[executed.length - 1] === res.code &&
        el.sceneSource === res.code &&
        requests[0][0].role === 'system' &&
        userMsg.includes("roof.name = 'Roof'") &&
        userMsg.includes('selected the mesh named "Roof"') &&
        userMsg.includes('Instruction: hang a lantern') &&
        events.some((e) => e.type === 'three-live-edit-start') &&
        events.some((e) => e.type === 'three-live-edit' && e.detail.applied),
      'editScene sends source + selection, validates in the sandbox, applies, and fires events',
    );
    const undone = await el.undoEdit();
    assert(
      undone &&
        el.sceneSource === BASE &&
        executed[executed.length - 1] === BASE &&
        (await el.undoEdit()) === false,
      'undoEdit restores the previous script and reports when history is empty',
    );
  }

  // One repair turn with the exact sandbox error.
  {
    const {el} = fakeElement();
    const {provider, requests} = scripted([
      fenced(
        `${BASE}\nscene.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1), ;`,
      ),
      fenced(WITH_LAMP),
    ]);
    const res = await el.editScene('add a lantern', {provider});
    const repairMsg = requests[1][requests[1].length - 1].content;
    assert(
      res.applied &&
        res.repairs === 1 &&
        requests[1].length === 4 &&
        repairMsg.includes('rejected by the Three-Live sandbox') &&
        repairMsg.includes('SyntaxError'),
      'A failed compile triggers one repair turn carrying the sandbox error',
    );
  }

  // Persistently broken replies are rejected; the live scene is untouched.
  {
    const {el, executed} = fakeElement();
    const before = executed.length;
    const {provider} = scripted([fenced('throw new Error("nope")'), 'no code']);
    const res = await el.editScene('break it', {provider});
    assert(
      !res.applied &&
        res.repairs === 1 &&
        res.error === 'The model reply did not contain a scene script.' &&
        executed.length === before &&
        el.sceneSource === BASE,
      'Rejected edits never touch the live scene',
    );
    const {provider: p0} = scripted([fenced('throw new Error("boom")')]);
    const res0 = await el.editScene('break it', {provider: p0, maxRepairs: 0});
    assert(
      !res0.applied && res0.repairs === 0 && res0.error!.includes('boom'),
      'maxRepairs: 0 rejects after the first failure with the runtime error',
    );
  }

  // Structural checks: empty scenes and dropped selections.
  {
    const {el} = fakeElement({selected: 'Roof'});
    const {provider} = scripted([
      fenced('const x = 1;'),
      fenced('const y = 2;'),
    ]);
    const res = await el.editScene('clear', {provider});
    const noRoof = WITH_LAMP.replace("roof.name = 'Roof'", "roof.name = 'Top'");
    const {provider: p2} = scripted([fenced(noRoof), fenced(noRoof)]);
    const res2 = await el.editScene('make it taller', {provider: p2});
    const {provider: p3} = scripted([fenced(noRoof)]);
    const res3 = await el.editScene('rename the roof to Top', {provider: p3});
    assert(
      !res.applied &&
        res.error === 'The edited scene contains no meshes.' &&
        !res2.applied &&
        res2.error!.includes('no longer contains the selected mesh "Roof"') &&
        res3.applied,
      'Edits that empty the scene or silently drop the selected mesh are rejected',
    );
  }

  // Warnings from the sandbox are surfaced; dryRun never applies.
  {
    const {el, executed} = fakeElement();
    const before = executed.length;
    const {provider} = scripted([fenced(`${WITH_LAMP}\n/*warn*/`)]);
    const res = await el.editScene('preview a lantern', {
      provider,
      dryRun: true,
    });
    assert(
      res.applied &&
        executed.length === before &&
        res.warnings.includes('degraded: RectAreaLight') &&
        el.sceneSource === BASE,
      'dryRun validates without applying and returns sandbox warnings',
    );
  }

  // Load failure after a passing dry run rolls back.
  {
    const {el, executed} = fakeElement();
    el.failNextExecute = true;
    const {provider} = scripted([fenced(WITH_LAMP)]);
    const res = await el.editScene('add a lantern', {provider});
    assert(
      !res.applied &&
        res.error!.includes('failed to load') &&
        el.sceneSource === BASE &&
        executed[executed.length - 1] === BASE,
      'A load failure after validation is reported and the previous scene restored',
    );
  }

  // Guards, attribute-configured provider, and superseded calls.
  {
    const {el: locked} = fakeElement({allow: false});
    const {el} = fakeElement();
    assert(
      (await rejects(
        locked.editScene('x', {provider: scripted([]).provider}),
        'allow-client-scripts',
      )) &&
        (await rejects(el.editScene('   '), 'instruction is empty')) &&
        (await rejects(el.editScene('add a lamp'), 'no AI provider')),
      'editScene enforces allow-client-scripts, non-empty instructions, and a provider',
    );
    el.setAttribute('ai-endpoint', 'https://proxy.test/v1/chat/completions');
    el.setAttribute('ai-model', 'gemini-2.5-flash');
    let body: any = null;
    const realFetch = globalThis.fetch;
    (globalThis as any).fetch = async (_u: string, init: any) => {
      body = JSON.parse(init.body);
      return new Response(
        JSON.stringify({choices: [{message: {content: fenced(WITH_LAMP)}}]}),
        {status: 200},
      );
    };
    const viaAttrs = await el.editScene('add a lantern');
    (globalThis as any).fetch = realFetch;
    el.setAttribute('ai-provider', 'mystery');
    assert(
      viaAttrs.applied &&
        body.model === 'gemini-2.5-flash' &&
        (await rejects(el.editScene('again'), "unknown ai-provider 'mystery'")),
      'ai-endpoint / ai-model attributes configure the ai-chat provider',
    );

    const {el: busy} = fakeElement();
    let release!: (v: string) => void;
    const slow = scripted([
      () => new Promise<string>((r) => (release = r)),
      fenced(WITH_LAMP),
    ]);
    const first = busy.editScene('first', {provider: slow.provider});
    await new Promise((r) => setTimeout(r, 0));
    const second = busy.editScene('second', {provider: slow.provider});
    release(fenced(WITH_LAMP));
    assert(
      (await rejects(first, 'superseded')) && (await second).applied,
      'A newer editScene call supersedes an in-flight one',
    );
  }

  //Programmatic executeScript loads become the base for later edits.
  {
    const {el} = fakeElement();
    await el.executeScript(WITH_LAMP);
    assert(el.sceneSource === WITH_LAMP, 'executeScript updates sceneSource');
  }

  // SSE streaming (`stream: true` + `onProgress`) in createAIChatProvider.
  {
    const progressEvents: Array<{
      chars: number;
      lines: number;
      thinkingChars?: number;
      phase?: 'thinking' | 'streaming';
    }> = [];
    let streamBody: any = null;
    const sseFetch = (async (_url: string, init: any) => {
      streamBody = JSON.parse(init.body);
      const chunks = [
        ': keepalive\n',
        'data: {"choices":[{"delta":{"reasoning":"plan step 1; "}}]}\n\n',
        'data: {"choices":[{"delta":{"reasoning_content":[{"text":"step 2"}]}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"const a = 1;\\n"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":[{"text":"scene.add(x);"}]}}]}\n',
        'data: [DONE]\n\n',
      ];
      const stream = new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          for (const c of chunks) {
            await new Promise((r) => setTimeout(r, 12));
            controller.enqueue(enc.encode(c));
          }
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: {'Content-Type': 'text/event-stream'},
      });
    }) as any;
    const sseProvider = createAIChatProvider({
      endpoint:
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      model: 'gemini-flash-latest',
      stream: true,
      timeoutMs: 35,
      firstByteTimeoutMs: 35,
      onProgress: (info) => progressEvents.push(info),
      fetch: sseFetch,
    });
    const sseText = await sseProvider.complete({
      messages: [{role: 'user', content: 'edit'}],
    });
    assert(
      sseText === 'const a = 1;\nscene.add(x);' &&
        streamBody.stream === true &&
        !('reasoning_effort' in streamBody) &&
        progressEvents.length === 5 &&
        progressEvents[0].chars === 0 &&
        progressEvents[1].phase === 'thinking' &&
        progressEvents[1].thinkingChars === 13 &&
        progressEvents[1].chars === 0 &&
        progressEvents[2].phase === 'thinking' &&
        progressEvents[2].thinkingChars === 19 &&
        progressEvents[3].phase === 'streaming' &&
        progressEvents[3].thinkingChars === 19 &&
        progressEvents[4].phase === 'streaming' &&
        progressEvents[4].chars === sseText.length &&
        progressEvents[4].lines === 2,
      'createAIChatProvider omits reasoning_effort by default, keeps SSE stream alive during delta.reasoning, and fires thinking/streaming onProgress events',
    );

    // Explicit reasoningEffort is forwarded when provided by caller.
    let explicitEffortBody: any = null;
    const explicitEffortProvider = createAIChatProvider({
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: 'o3-mini',
      reasoningEffort: 'low',
      fetch: (async (_url: string, init: any) => {
        explicitEffortBody = JSON.parse(init.body);
        return new Response(
          JSON.stringify({choices: [{message: {content: 'scene.add(o3);'}}]}),
          {status: 200},
        );
      }) as any,
    });
    const explicitEffortOut = await explicitEffortProvider.complete({
      messages: [{role: 'user', content: 'edit'}],
    });
    assert(
      explicitEffortOut === 'scene.add(o3);' &&
        explicitEffortBody.reasoning_effort === 'low',
      'createAIChatProvider sends reasoning_effort when explicitly configured',
    );

    // Transient HTTP 503 retries the SAME model after retryDelayMs and succeeds.
    const retryStatusMessages: string[] = [];
    const retryModels503: string[] = [];
    let transient503Count = 0;
    const transient503Provider = createAIChatProvider({
      endpoint:
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      model: 'gemini-flash-latest',
      retryDelayMs: 10,
      onStatus: (s) => retryStatusMessages.push(s),
      fetch: (async (_url: string, init: any) => {
        const parsed = JSON.parse(init.body);
        retryModels503.push(parsed.model);
        transient503Count += 1;
        if (transient503Count === 1) {
          return new Response(
            JSON.stringify({
              error: {
                message:
                  'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.',
                status: 'UNAVAILABLE',
              },
            }),
            {status: 503},
          );
        }
        return new Response(
          JSON.stringify({
            choices: [{message: {content: 'scene.add(retriedSameModel);'}}],
          }),
          {status: 200},
        );
      }) as any,
    });
    const outRetry503 = await transient503Provider.complete({
      messages: [{role: 'user', content: 'edit'}],
    });
    assert(
      outRetry503 === 'scene.add(retriedSameModel);' &&
        retryModels503.length === 2 &&
        retryModels503[0] === 'gemini-flash-latest' &&
        retryModels503[1] === 'gemini-flash-latest' &&
        retryStatusMessages.length === 1 &&
        retryStatusMessages[0] ===
          'Endpoint busy — retrying (gemini-flash-latest)…',
      'createAIChatProvider retries the same model on transient HTTP 503 after retryDelayMs',
    );

    // Explicit fallbackModels work when configured by the caller.
    const statusMessages: string[] = [];
    const attemptedModels503: string[] = [];
    const fallback503Provider = createAIChatProvider({
      endpoint:
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      model: 'gemini-flash-latest',
      fallbackModels: ['gemini-flash-lite-latest'],
      maxRetries: 0,
      onStatus: (s) => statusMessages.push(s),
      fetch: (async (_url: string, init: any) => {
        const parsed = JSON.parse(init.body);
        attemptedModels503.push(parsed.model);
        if (parsed.model === 'gemini-flash-latest') {
          return new Response(
            JSON.stringify({
              error: {
                message: 'Service unavailable',
                status: 'UNAVAILABLE',
              },
            }),
            {status: 503},
          );
        }
        return new Response(
          JSON.stringify({
            choices: [{message: {content: 'scene.add(fallback503);'}}],
          }),
          {status: 200},
        );
      }) as any,
    });
    const out503 = await fallback503Provider.complete({
      messages: [{role: 'user', content: 'edit'}],
    });
    assert(
      out503 === 'scene.add(fallback503);' &&
        attemptedModels503.length === 2 &&
        attemptedModels503[0] === 'gemini-flash-latest' &&
        attemptedModels503[1] === 'gemini-flash-lite-latest' &&
        statusMessages.length === 1 &&
        statusMessages[0].includes('gemini-flash-latest busy') &&
        statusMessages[0].includes('gemini-flash-lite-latest'),
      'createAIChatProvider steps to explicit fallbackModels when configured',
    );

    const stallStatuses: string[] = [];
    const attemptedModelsStall: string[] = [];
    const stallFallbackProvider = createAIChatProvider({
      endpoint:
        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      model: 'gemini-flash-latest',
      fallbackModels: ['gemini-flash-lite-latest'],
      stream: true,
      firstByteTimeoutMs: 30,
      onStatus: (s) => stallStatuses.push(s),
      fetch: (async (_url: string, init: any) => {
        const parsed = JSON.parse(init.body);
        attemptedModelsStall.push(parsed.model);
        if (parsed.model === 'gemini-flash-latest') {
          const stalledStream = new ReadableStream({
            start() {
              // Stalls without emitting any SSE content delta.
            },
          });
          return new Response(stalledStream, {
            status: 200,
            headers: {'Content-Type': 'text/event-stream'},
          });
        }
        const okStream = new ReadableStream({
          start(controller) {
            const enc = new TextEncoder();
            controller.enqueue(
              enc.encode(
                'data: {"choices":[{"delta":{"content":"scene.add(unstalled);"}}]}\n\ndata: [DONE]\n\n',
              ),
            );
            controller.close();
          },
        });
        return new Response(okStream, {
          status: 200,
          headers: {'Content-Type': 'text/event-stream'},
        });
      }) as any,
    });
    const outStall = await stallFallbackProvider.complete({
      messages: [{role: 'user', content: 'edit'}],
    });
    assert(
      outStall === 'scene.add(unstalled);' &&
        attemptedModelsStall.length === 2 &&
        attemptedModelsStall[0] === 'gemini-flash-latest' &&
        attemptedModelsStall[1] === 'gemini-flash-lite-latest' &&
        stallStatuses.length === 1 &&
        stallStatuses[0].includes('gemini-flash-lite-latest'),
      'createAIChatProvider aborts a first-byte SSE queue stall and succeeds via explicit fallbackModels',
    );
  }

  // Surgical SEARCH/REPLACE and // APPEND edits + base64 Data-URI masking.
  {
    const fakePng =
      'data:image/png;base64,' +
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const baseWithUri = `${BASE}\nconst texUri = "${fakePng}";\n`;
    const {el} = fakeElement();
    const searchReplaceReply = [
      '<<<<<<< SEARCH',
      'const roof = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 2), new THREE.MeshStandardMaterial({ color: 0x334155 }));',
      '=======',
      'const roof = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 2), new THREE.MeshStandardMaterial({ color: 0xd97706 }));',
      '>>>>>>> REPLACE',
    ].join('\n');
    const {provider, requests} = scripted([searchReplaceReply]);
    const res = await el.editScene('make the roof amber', {
      provider,
      source: baseWithUri,
    });
    const sentPrompt = String(requests[0][1].content);
    assert(
      res.applied &&
        sentPrompt.includes('__TL_DATA_URI_0__') &&
        !sentPrompt.includes(fakePng) &&
        res.code.includes('0xd97706') &&
        res.code.includes(fakePng) &&
        !res.code.includes('__TL_DATA_URI_0__'),
      'editScene masks base64 data URIs in prompt, applies SEARCH/REPLACE diff, and restores data URIs in output',
    );

    const appendReply = fenced(
      [
        '// APPEND',
        'const roof = new THREE.Mesh(new THREE.SphereGeometry(0.25), new THREE.MeshStandardMaterial({ color: 0x38bdf8 }));',
        "roof.name = 'SkyOrb';",
        'roof.position.set(0, 2.5, 0);',
        'scene.add(roof);',
      ].join('\n'),
    );
    const {provider: appendProvider} = scripted([appendReply]);
    const resAppend = await el.editScene('add a sky orb above the roof', {
      provider: appendProvider,
    });
    assert(
      resAppend.applied &&
        resAppend.code.includes("roof.name = 'Roof'") &&
        resAppend.code.includes("roof.name = 'SkyOrb'"),
      'editScene supports // APPEND blocks in an isolated block scope so const declarations never collide',
    );
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
