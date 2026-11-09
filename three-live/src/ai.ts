/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Bring-your-own-LLM scene editing plugin bundle for
 * `<three-live>` / `<xr-live>` (three-live-ai.min.js).
 */

import {registerPlugin} from './plugin';
import {
  aiPlugin,
  createAIChatProvider,
  editScene,
  extractScript,
  undoEdit,
} from './plugins/ai';

import {
  AIVoiceSession,
  connectVoice,
  createWebSpeechRecognizer,
  describeEditResult,
  geminiLiveAdapter,
  describeVoiceSelection,
  realtimeAdapter,
  selectByVoice,
  setSelectOnTap,
  speakableName,
  startVoiceEdit,
} from './plugins/ai-voice';
export type {
  AISelectionEventDetail,
  AISelectionMode,
  AISelectionSource,
} from './plugins/ai-select';

import {
  describeSelection,
  getSelection,
  resolveSelection,
  sceneSelectEntries,
  selectCamera,
  setSelection,
} from './plugins/ai-select';
import {buildSelectIndex, matchSelection, parseVoiceCommand} from './plugins/ai-select-match';
export type {
  SelectCamera,
  SelectConfidence,
  SelectIndexEntry,
  SelectMatch,
  SelectRawEntry,
  VoiceCommand,
} from './plugins/ai-select-match';

registerPlugin(aiPlugin);

export {
  AIVoiceSession,
  aiPlugin,
  connectVoice,
  createAIChatProvider,
  createWebSpeechRecognizer,
  describeEditResult,
  buildSelectIndex,
  describeSelection,
  describeVoiceSelection,
  editScene,
  getSelection,
  matchSelection,
  parseVoiceCommand,
  resolveSelection,
  sceneSelectEntries,
  selectByVoice,
  selectCamera,
  setSelection,
  speakableName,
  extractScript,
  geminiLiveAdapter,
  realtimeAdapter,
  setSelectOnTap,
  startVoiceEdit,
  undoEdit,
};
export type {
  AIChatMessage,
  AIChatProviderOptions,
  EditSceneOptions,
  EditSceneResult,
  ThreeLiveAIProvider,
} from './plugins/ai';
export type {
  AIAudioSink,
  AIMicrophoneSource,
  AISpeechRecognizer,
  AIVoiceAdapter,
  AIVoiceSelection,
  AIVoiceEditOptions,
  AIVoiceEditResult,
  AIVoiceEventDetail,
  AIVoiceProviderName,
  AIVoiceSessionOptions,
  AIVoiceState,
  AIVoiceTransport,
} from './plugins/ai-voice';
export type {
  AISelectionEventDetail,
  AISelectionMode,
  AISelectionSource,
} from './plugins/ai-select';
