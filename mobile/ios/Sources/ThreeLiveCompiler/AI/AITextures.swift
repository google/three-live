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

import Foundation

/// A pluggable image generator for AI textures (`userData.xr.material.prompt`, roadmap B5).
/// Mirrors `ThreeLiveImageProvider` on the web.
public protocol AIImageProvider: AnyObject {
  /// Sends one Images API request (`requestBody`, built by the shared core so the prompt suffix
  /// and shape match the web and CLI) and returns the response JSON.
  func generateImage(_ requestBody: [String: Any]) async throws -> Data
  /// Recorded as pack provenance.
  var name: String { get }
  var model: String? { get }
}

/// OpenAI-compatible Images endpoint (`POST /v1/images/generations`, `b64_json`): OpenAI Images,
/// Gemini / Imagen through Gemini's OpenAI-compatible endpoint, or your own proxy.
///
/// API keys never belong in an app: point `endpoint` at your own proxy, or pass short-lived
/// credentials in `headers`.
public final class AIImagesProvider: AIImageProvider, @unchecked Sendable {
  public let name = "openai-images"
  public let model: String?
  private let endpoint: URL
  private let headers: [String: String]
  private let timeout: TimeInterval
  private let session: URLSession

  /// Returns `nil` unless `endpoint` is `https://` (or `http://` to a loopback host).
  public init?(
    endpoint: String, model: String? = nil, headers: [String: String] = [:],
    timeout: TimeInterval = 180, session: URLSession = .shared
  ) {
    guard AIChatProvider.isAllowedEndpoint(endpoint), let url = URL(string: endpoint) else {
      return nil
    }
    self.endpoint = url
    self.model = model
    self.headers = headers
    self.timeout = timeout
    self.session = session
  }

  public func generateImage(_ requestBody: [String: Any]) async throws -> Data {
    var request = URLRequest(url: endpoint, timeoutInterval: timeout)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    for (k, v) in headers where !v.contains("\r") && !v.contains("\n") {
      request.setValue(v, forHTTPHeaderField: k)
    }
    request.httpBody = try JSONSerialization.data(withJSONObject: requestBody)
    let (data, response) = try await session.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
      let text = String(data: data, encoding: .utf8) ?? ""
      throw AIEditError("ai-image: HTTP \(status) from endpoint: \(text.prefix(300))")
    }
    return data
  }
}

/// One AI texture a scene asks for.
public struct AITextureRequest: Sendable, Equatable {
  public let key: String
  public let prompt: String
  public let size: Int
  public let seed: Int
  /// True when the current pack already has it.
  public let hit: Bool
  public let meshes: [String]
}

/// Result of `AITextures.generateTextures`.
public struct AITextureResult: Sendable, Equatable {
  public let generated: [String]
  public let cached: [String]
  public let failed: [String: String]
  /// The updated texture pack JSON (save it next to the scene for reproducible results).
  public let packJSON: String?
}

/// AI textures for native apps: holds the texture pack every compile uses, and generates the
/// textures a scene is missing (pack → `cacheDirectory` → `provider`). The compiler never calls
/// a provider; after `generateTextures` (or `setPack`) recompile the scene to see the new
/// textures. Key derivation, image preparation, and pack validation run in the shared Rust core,
/// so results match the web and the CLI.
public final class AITextures: @unchecked Sendable {
  private let provider: AIImageProvider?
  private let cacheDirectory: URL?
  private let core: AICore
  private let lock = NSLock()
  private var pack: String?

  /// - Parameters:
  ///   - cacheDirectory: raw provider images are cached here (`<key>.img`), e.g. a folder in
  ///     `FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)`.
  public init(
    provider: AIImageProvider? = nil, cacheDirectory: URL? = nil,
    core: AICore = NativeAICore.shared
  ) {
    self.provider = provider
    self.cacheDirectory = cacheDirectory
    self.core = core
  }

  /// The current texture pack JSON (nil = none).
  public var packJSON: String? {
    locked { pack }
  }

  /// Replaces the texture pack every compile uses (nil clears it).
  public func setPack(_ json: String?) async throws {
    let res = try await core.call(["op": "texture_pack_set", "pack": json ?? NSNull()])
    guard res["ok"] as? Bool == true else {
      throw AIEditError(res["error"] as? String ?? "texture pack rejected")
    }
    storePack(json)
  }

  private func storePack(_ json: String?) {
    locked { pack = json }
  }

  // `NSLock.withLock` needs iOS 16; the package supports iOS 15.
  private func locked<T>(_ body: () -> T) -> T {
    lock.lock()
    defer { lock.unlock() }
    return body()
  }

  /// The AI textures `script` asks for, resolved against the current pack.
  public func requests(_ script: String) async throws -> [AITextureRequest] {
    let res = try await core.call(["op": "texture_requests", "code": script])
    if let e = res["error"] as? String { throw AIEditError(e) }
    return (res["requests"] as? [[String: Any]] ?? []).compactMap { r in
      guard let key = r["key"] as? String, let spec = r["spec"] as? [String: Any] else {
        return nil
      }
      return AITextureRequest(
        key: key, prompt: spec["prompt"] as? String ?? "",
        size: (spec["size"] as? NSNumber)?.intValue ?? 512,
        seed: (spec["seed"] as? NSNumber)?.intValue ?? 1,
        hit: r["hit"] as? Bool ?? false, meshes: r["meshes"] as? [String] ?? [])
    }
  }

  /// Generates (or loads from `cacheDirectory`) the textures `script` is missing, adds them to
  /// the pack, and installs the updated pack. Recompile the scene afterwards.
  ///
  /// - Parameters:
  ///   - meshes: only textures used by these node names (empty = all).
  ///   - force: regenerate even when the pack already has a texture.
  public func generateTextures(
    _ script: String, meshes: [String] = [], force: Bool = false
  ) async throws -> AITextureResult {
    let wanted = try await requests(script).filter { r in
      (force || !r.hit) && (meshes.isEmpty || r.meshes.contains(where: meshes.contains))
    }
    var generated: [String] = []
    var cached: [String] = []
    var failed: [String: String] = [:]
    var current = packJSON
    for r in wanted {
      do {
        let spec: [String: Any] = ["prompt": r.prompt, "size": r.size, "seed": r.seed]
        let cacheFile = cacheDirectory?.appendingPathComponent("\(r.key).img")
        var fromCache = false
        let image: String
        if !force, let file = cacheFile, let bytes = try? Data(contentsOf: file) {
          fromCache = true
          image = bytes.base64EncodedString()
        } else {
          guard let p = provider else {
            throw AIEditError("generateTextures: no image provider configured.")
          }
          var reqOp: [String: Any] = ["op": "texture_image_request", "spec": spec]
          if let m = p.model { reqOp["model"] = m }
          let req = try await core.call(reqOp)
          guard let body = req["body"] as? [String: Any] else {
            throw AIEditError("invalid texture spec")
          }
          let reply = try await p.generateImage(body)
          let parsed = try await core.call([
            "op": "texture_image_parse", "body": String(decoding: reply, as: UTF8.self),
          ])
          if let e = parsed["error"] as? String { throw AIEditError(e) }
          guard let b64 = parsed["image"] as? String else { throw AIEditError("no image") }
          if let file = cacheFile, let bytes = Data(base64Encoded: b64) {
            try? FileManager.default.createDirectory(
              at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? bytes.write(to: file)
          }
          image = b64
        }
        var addOp: [String: Any] = [
          "op": "texture_pack_add", "pack": current ?? NSNull(), "spec": spec, "image": image,
        ]
        if !fromCache {
          var prov: [String: Any] = [
            "provider": provider?.name ?? "custom",
            "createdAt": ISO8601DateFormatter().string(from: Date()),
          ]
          if let m = provider?.model { prov["model"] = m }
          addOp["provenance"] = prov
        }
        let added = try await core.call(addOp)
        if let e = added["error"] as? String { throw AIEditError(e) }
        guard let packObj = added["pack"],
          let data = try? JSONSerialization.data(withJSONObject: packObj, options: [.sortedKeys])
        else { throw AIEditError("invalid pack from core") }
        current = String(decoding: data, as: UTF8.self)
        if fromCache { cached.append(r.key) } else { generated.append(r.key) }
      } catch {
        failed[r.key] = (error as? AIEditError)?.message ?? error.localizedDescription
      }
    }
    if !generated.isEmpty || !cached.isEmpty { try await setPack(current) }
    return AITextureResult(
      generated: generated, cached: cached, failed: failed, packJSON: packJSON)
  }
}
