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
  applySceneEdit,
  createAIChatProvider,
  editScene,
  extractScript,
  maskDataUris,
  undoEdit,
  unmaskDataUris,
} from './plugins/ai';

import {
  hideSelectionChips,
  showSelectionChips,
} from './plugins/ai-select-chips';
import {
  AIVoiceSession,
  connectVoice,
  createWebSpeechRecognizer,
  describeEditResult,
  describeVoiceSelection,
  geminiLiveAdapter,
  realtimeAdapter,
  selectByVoice,
  selectNamesByVoice,
  setSelectOnTap,
  speakableName,
  startVoiceEdit,
} from './plugins/ai-voice';
export type {
  AIImageInput,
  AISpatialCamera,
  AISpatialObject,
  AISpatialPlane,
  AISpatialPriors,
  CompileFromImageOptions,
} from './plugins/ai-image';
export type {
  AIModelSelection,
  AISelectionEventDetail,
  AISelectionMode,
  AISelectionSource,
  AISelectProvider,
} from './plugins/ai-select';
export type {AISelectChipsState} from './plugins/ai-select-chips';
export type {
  SelectCamera,
  SelectConfidence,
  SelectIndexEntry,
  SelectMatch,
  SelectRawEntry,
  VoiceCommand,
} from './plugins/ai-select-match';

import {
  buildImageMessages,
  buildImageUserText,
  buildVisualRefinementPrompt,
  buildVisualTurnMessages,
  compileFromImage,
  detectImageMime,
  formatSpatialPriors,
  IMAGE_SYSTEM_PROMPT,
  imageRepairMessage,
  isAllowedImageUrl,
  MAX_VISUAL_TURNS,
  normalizeImageInput,
  renderComparisonSheetDataUrl,
} from './plugins/ai-image';
import {
  describeSelection,
  getSelection,
  parseSelectReply,
  resolveSelection,
  resolveSelectionWithModel,
  sceneSelectEntries,
  selectCamera,
  selectMessages,
  setSelection,
} from './plugins/ai-select';
import {
  buildSelectIndex,
  matchSelection,
  parseVoiceCommand,
} from './plugins/ai-select-match';

import {
  browserImageCodec,
  createAIImageProvider,
  indexedDbTextureCache,
  parseTexturePack,
  prepareAlbedo,
  serializeTexturePack,
  TEXTURE_PROMPT_SUFFIX,
  textureRequests,
} from './plugins/ai-texture';

registerPlugin(aiPlugin);

export type {
  AIImageProviderOptions,
  AITextureSpec,
  GenerateTexturesOptions,
  GenerateTexturesResult,
  TextureCache,
  TextureCacheRecord,
  TextureImageCodec,
  TextureMiss,
  TexturePackEntry,
  TexturePackJSON,
  ThreeLiveImageProvider,
} from './plugins/ai-texture';

export type {
  AIChatContentPart,
  AIChatMessage,
  AIChatProviderOptions,
  EditSceneOptions,
  EditSceneResult,
  ThreeLiveAIProvider,
} from './plugins/ai';
export type {
  AISelectionEventDetail,
  AISelectionMode,
  AISelectionSource,
} from './plugins/ai-select';
export type {
  AIAudioSink,
  AIMicrophoneSource,
  AISpeechRecognizer,
  AIVoiceAdapter,
  AIVoiceEditOptions,
  AIVoiceEditResult,
  AIVoiceEventDetail,
  AIVoiceProviderName,
  AIVoiceSelection,
  AIVoiceSessionOptions,
  AIVoiceState,
  AIVoiceTransport,
} from './plugins/ai-voice';
export {
  aiPlugin,
  AIVoiceSession,
  applySceneEdit,
  browserImageCodec,
  buildImageMessages,
  buildImageUserText,
  buildSelectIndex,
  buildVisualRefinementPrompt,
  buildVisualTurnMessages,
  compileFromImage,
  connectVoice,
  createAIChatProvider,
  createAIImageProvider,
  createWebSpeechRecognizer,
  describeEditResult,
  describeSelection,
  describeVoiceSelection,
  detectImageMime,
  editScene,
  extractScript,
  formatSpatialPriors,
  geminiLiveAdapter,
  getSelection,
  hideSelectionChips,
  IMAGE_SYSTEM_PROMPT,
  imageRepairMessage,
  indexedDbTextureCache,
  isAllowedImageUrl,
  maskDataUris,
  matchSelection,
  MAX_VISUAL_TURNS,
  normalizeImageInput,
  parseSelectReply,
  parseTexturePack,
  parseVoiceCommand,
  prepareAlbedo,
  realtimeAdapter,
  renderComparisonSheetDataUrl,
  resolveSelection,
  resolveSelectionWithModel,
  sceneSelectEntries,
  selectByVoice,
  selectCamera,
  selectMessages,
  selectNamesByVoice,
  serializeTexturePack,
  setSelection,
  setSelectOnTap,
  showSelectionChips,
  speakableName,
  startVoiceEdit,
  TEXTURE_PROMPT_SUFFIX,
  textureRequests,
  undoEdit,
  unmaskDataUris,
};
