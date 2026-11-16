/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import Foundation

/// Canonical capability identifiers shared across Web, Android, and iOS.
public enum ThreeLiveCapability: String, CaseIterable, Sendable, Equatable, Hashable {
  case scripts = "scripts"
  case network = "network"
  case remoteContent = "remote_content"
  case camera = "camera"
  case microphone = "microphone"
  case sensors = "sensors"
  case storage = "storage"
  case ai = "ai"
  case externalHandoff = "external_handoff"

  public var wireName: String { rawValue }

  public static func fromToken(_ raw: String) -> ThreeLiveCapability? {
    let norm = raw.trimmingCharacters(in: .whitespacesAndNewlines)
      .lowercased()
      .replacingOccurrences(of: "-", with: "_")
    return ThreeLiveCapability(rawValue: norm)
  }
}

/// Structured diagnostic payload emitted whenever a capability check is refused.
public struct CapabilityDeniedEvent: Sendable, Equatable {
  public let capability: ThreeLiveCapability
  public let feature: String
  public let message: String
  public let url: String?

  public init(
    capability: ThreeLiveCapability,
    feature: String,
    message: String,
    url: String? = nil
  ) {
    self.capability = capability
    self.feature = feature
    self.message = message
    self.url = url
  }
}

/// Capability-based security policy for Three-Live views, sessions, and helpers.
///
/// Sensitive capabilities default to `false`; `scripts` defaults to `true` on native views (use
/// `.none` when script execution should also be disabled).
public struct ThreeLiveCapabilities: Sendable, Equatable {
  public var scripts: Bool
  public var network: Bool
  public var remoteContent: Bool
  public var camera: Bool
  public var microphone: Bool
  public var sensors: Bool
  public var storage: Bool
  public var ai: Bool
  public var externalHandoff: Bool
  public var networkSchemes: Set<String>
  public var explicitNetworkSchemes: Bool
  public var networkOrigins: Set<String>?

  public init(
    scripts: Bool = true,
    network: Bool = false,
    remoteContent: Bool = false,
    camera: Bool = false,
    microphone: Bool = false,
    sensors: Bool = false,
    storage: Bool = false,
    ai: Bool = false,
    externalHandoff: Bool = false,
    networkSchemes: Set<String> = ThreeLiveCapabilities.defaultNetworkSchemes,
    explicitNetworkSchemes: Bool = false,
    networkOrigins: Set<String>? = nil
  ) {
    self.scripts = scripts
    self.network = network
    self.remoteContent = remoteContent
    self.camera = camera
    self.microphone = microphone
    self.sensors = sensors
    self.storage = storage
    self.ai = ai
    self.externalHandoff = externalHandoff
    self.networkSchemes = Set(
      networkSchemes.map {
        $0.trimmingCharacters(in: .whitespacesAndNewlines)
          .lowercased()
          .replacingOccurrences(of: ":", with: "")
      }.filter { !$0.isEmpty }
    )
    self.explicitNetworkSchemes = explicitNetworkSchemes
    self.networkOrigins = networkOrigins
  }

  /// Default allowed outbound schemes when `network` is enabled without an explicit list.
  public static let defaultNetworkSchemes: Set<String> = ["https", "wss"]

  private static let nonNetworkSchemes: Set<String> = [
    "data", "blob", "asset", "file", "content", "android.resource",
  ]

  /// Default native policy: `scripts = true`, all sensitive capabilities `false`.
  public static let `default` = ThreeLiveCapabilities()

  /// Strict zero-capability policy (`scripts = false` as well).
  public static let none = ThreeLiveCapabilities(scripts: false)

  /// Unambiguous shorthand alias for `ThreeLiveCapabilities.none` when passing to `Optional` parameters.
  public static let zero = none

  /// Preset for static `.glb` / `.usdz` remote viewing and AR Quick Look handoff.
  public static let viewer = ThreeLiveCapabilities(
    scripts: false,
    network: true,
    remoteContent: true,
    camera: true,
    externalHandoff: true
  )

  /// Preset enabling all capabilities, intended for trusted demos and playgrounds.
  public static let all = ThreeLiveCapabilities(
    scripts: true,
    network: true,
    remoteContent: true,
    camera: true,
    microphone: true,
    sensors: true,
    storage: true,
    ai: true,
    externalHandoff: true
  )

  private static let stateLock = NSLock()
  nonisolated(unsafe) private static var _defaultPolicy: ThreeLiveCapabilities = .default
  nonisolated(unsafe) private static var _onDenied: (@Sendable (CapabilityDeniedEvent) -> Void)?

  /// Process-wide default capability policy consulted when no per-view policy is supplied.
  public static var defaultPolicy: ThreeLiveCapabilities {
    get {
      stateLock.lock()
      defer { stateLock.unlock() }
      return _defaultPolicy
    }
    set {
      stateLock.lock()
      _defaultPolicy = newValue
      stateLock.unlock()
    }
  }

  /// Optional process-wide callback notified whenever any capability check is denied.
  public static var onDenied: (@Sendable (CapabilityDeniedEvent) -> Void)? {
    get {
      stateLock.lock()
      defer { stateLock.unlock() }
      return _onDenied
    }
    set {
      stateLock.lock()
      _onDenied = newValue
      stateLock.unlock()
    }
  }

  /// Returns `true` when `url` uses an in-memory or local non-network scheme.
  public static func isNonNetworkURL(_ url: String) -> Bool {
    let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let colon = trimmed.firstIndex(of: ":"), colon > trimmed.startIndex else {
      return false
    }
    let scheme = String(trimmed[..<colon]).lowercased()
    return nonNetworkSchemes.contains(scheme)
  }

  /// Normalizes an origin string to `scheme://host[:port]` (stripping default ports and paths).
  public static func normalizeOrigin(_ raw: String) -> String? {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let c = URLComponents(string: trimmed),
      let scheme = c.scheme?.lowercased(), !scheme.isEmpty,
      let host = c.host?.lowercased(), !host.isEmpty
    else { return nil }
    let formattedHost = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
    let port = c.port ?? -1
    let isDefault =
      ((scheme == "https" || scheme == "wss") && port == 443)
      || ((scheme == "http" || scheme == "ws") && port == 80)
    let portSuffix = (port > 0 && !isDefault) ? ":\(port)" : ""
    return "\(scheme)://\(formattedHost)\(portSuffix)"
  }

  /// Sanitizes a URL for diagnostics/events by stripping credentials, query strings, and hashes.
  public static func sanitizeDiagnosticURL(_ raw: String, baseURL: String? = nil) -> String {
    let full = String(raw.trimmingCharacters(in: .whitespacesAndNewlines).prefix(8192))
    if isNonNetworkURL(full), let colon = full.firstIndex(of: ":") {
      return "\(full[...colon])<local>"
    }
    let noQuery =
      full.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
      .first.map(String.init) ?? full
    let noHash =
      noQuery.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false)
      .first.map(String.init) ?? noQuery
    if let resolved = resolveURL(full, baseURL: baseURL) ?? resolveURL(noHash, baseURL: baseURL),
      var comps = URLComponents(url: resolved, resolvingAgainstBaseURL: true),
      let scheme = comps.scheme?.lowercased(),
      let host = comps.host?.lowercased(), !host.isEmpty
    {
      comps.user = nil
      comps.password = nil
      comps.query = nil
      comps.fragment = nil
      comps.scheme = scheme
      comps.host = host
      if let clean = comps.string { return String(clean.prefix(256)) }
    }
    let stripped = noHash.replacingOccurrences(
      of: #"//[^/@\s]*@"#, with: "//", options: .regularExpression
    ).replacingOccurrences(
      of: #"^([a-zA-Z][a-zA-Z0-9+.-]*://)[^/\s:@]+:[^/\s@]*"#,
      with: "$1",
      options: .regularExpression
    )
    return String(stripped.prefix(128))
  }

  /// Parses a capability policy string matching the Web `capabilities="..."` attribute syntax.
  public static func parse(_ spec: String, base: ThreeLiveCapabilities = .none)
    -> ThreeLiveCapabilities
  {
    let trimmed = spec.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return .none }
    var out = base
    var schemes = base.networkSchemes
    var explicitSchemes = base.explicitNetworkSchemes
    var origins = base.networkOrigins
    var originsSpecified = false

    for rawSub in trimmed.split(whereSeparator: { $0.isWhitespace }) {
      let raw = String(rawSub)
      if raw.isEmpty { continue }
      let neg = raw.count > 1 && raw.hasPrefix("-")
      let tok = neg ? String(raw.dropFirst()) : raw
      let value = !neg
      let atParts = tok.split(separator: "@", maxSplits: 1, omittingEmptySubsequences: false)
      let head = String(atParts[0]).lowercased()
      let originPart = atParts.count > 1 ? String(atParts[1]) : ""
      let colonParts = head.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
      let name = String(colonParts[0]).replacingOccurrences(of: "-", with: "_")
      let schemePart = colonParts.count > 1 ? String(colonParts[1]) : ""

      switch name {
      case "none":
        if value {
          out = .none
          schemes = defaultNetworkSchemes
          explicitSchemes = false
          origins = nil
          originsSpecified = false
        }
      case "all", "*":
        out.scripts = value
        out.network = value
        out.remoteContent = value
        out.camera = value
        out.microphone = value
        out.sensors = value
        out.storage = value
        out.ai = value
        out.externalHandoff = value
        schemes = defaultNetworkSchemes
        explicitSchemes = false
        origins = nil
        originsSpecified = false
      case "viewer":
        out.network = value
        out.remoteContent = value
        out.camera = value
        out.externalHandoff = value
      case "scripts":
        out.scripts = value
      case "network":
        out.network = value
        if value && !schemePart.isEmpty {
          let parsed = schemePart.split(whereSeparator: { $0 == "," || $0 == "|" })
            .map {
              $0.trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased()
                .replacingOccurrences(of: ":", with: "")
            }
            .filter { !$0.isEmpty }
          if !parsed.isEmpty {
            schemes = Set(parsed)
            explicitSchemes = true
          }
        } else if value && originPart.isEmpty {
          schemes = defaultNetworkSchemes
          explicitSchemes = false
          origins = nil
          originsSpecified = false
        }
        if value && !originPart.isEmpty {
          var set = originsSpecified ? (origins ?? Set<String>()) : Set<String>()
          originsSpecified = true
          for part in originPart.split(whereSeparator: { $0 == "," || $0 == "|" }) {
            if let norm = normalizeOrigin(String(part)) {
              set.insert(norm)
            }
          }
          origins = set
        }
      case "remote_content":
        out.remoteContent = value
      case "camera":
        out.camera = value
      case "microphone":
        out.microphone = value
      case "sensors":
        out.sensors = value
      case "storage":
        out.storage = value
      case "ai":
        out.ai = value
      case "external_handoff":
        out.externalHandoff = value
      default:
        break
      }
    }
    out.networkSchemes = schemes
    out.explicitNetworkSchemes = explicitSchemes
    out.networkOrigins = origins
    return out
  }

  /// Returns `true` when `network` permits connecting to `rawURL` (resolved against `baseURL`).
  public func isNetworkURLPermitted(_ rawURL: String? = nil, baseURL: String? = nil) -> Bool {
    guard network else { return false }
    guard let rawURL = rawURL else { return true }
    let trimmed = rawURL.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return false }
    if Self.isNonNetworkURL(trimmed) { return true }

    guard let resolved = Self.resolveURL(trimmed, baseURL: baseURL),
      let scheme = resolved.scheme?.lowercased(), !scheme.isEmpty
    else { return false }
    if Self.isNonNetworkURL("\(scheme):") { return true }
    guard let host = resolved.host?.lowercased(), !host.isEmpty else { return false }

    let loopback =
      (scheme == "http" || scheme == "ws")
      && (host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "[::1]")
    let schemeAllowed = networkSchemes.contains(scheme) || (!explicitNetworkSchemes && loopback)
    guard schemeAllowed else { return false }

    if let allowedOrigins = networkOrigins {
      let normalizedAllowed = Set(allowedOrigins.compactMap { Self.normalizeOrigin($0) })
      guard let origin = Self.normalizeOrigin(resolved.absoluteString),
        normalizedAllowed.contains(origin)
      else { return false }
    }
    return true
  }

  /// Evaluates whether this policy grants `capability` (and optional `url`).
  public func has(
    _ capability: ThreeLiveCapability,
    url: String? = nil,
    baseURL: String? = nil
  ) -> Bool {
    switch capability {
    case .scripts:
      return scripts
    case .network:
      return isNetworkURLPermitted(url, baseURL: baseURL)
    case .remoteContent:
      if let url = url, Self.isNonNetworkURL(url) { return true }
      return remoteContent && isNetworkURLPermitted(url, baseURL: baseURL)
    case .camera:
      return camera
    case .microphone:
      return microphone
    case .sensors:
      return sensors
    case .storage:
      return storage
    case .ai:
      return ai && isNetworkURLPermitted(url, baseURL: baseURL)
    case .externalHandoff:
      return externalHandoff
    }
  }

  /// Checks `capability` at a point of access. Logs a diagnostic, invokes `onDenied` and
  /// `ThreeLiveCapabilities.onDenied`, and returns `false` without throwing when refused.
  @discardableResult
  public func check(
    _ capability: ThreeLiveCapability,
    feature: String,
    url: String? = nil,
    baseURL: String? = nil,
    onDenied listener: ((CapabilityDeniedEvent) -> Void)? = nil
  ) -> Bool {
    checkInternal(
      capability, feature: feature, url: url, baseURL: baseURL, listener: listener, guardObj: nil)
  }

  fileprivate func checkInternal(
    _ capability: ThreeLiveCapability,
    feature: String,
    url: String?,
    baseURL: String?,
    listener: ((CapabilityDeniedEvent) -> Void)?,
    guardObj: CapabilityGuard?
  ) -> Bool {
    if capability == .remoteContent {
      if let url = url, Self.isNonNetworkURL(url) { return true }
      if !remoteContent {
        Self.reportDenial(
          .remoteContent, feature: feature, url: url, baseURL: baseURL, listener: listener,
          guardObj: guardObj)
        return false
      }
      if !isNetworkURLPermitted(url, baseURL: baseURL) {
        Self.reportDenial(
          .network, feature: feature, url: url, baseURL: baseURL, listener: listener,
          guardObj: guardObj)
        return false
      }
      return true
    }
    if capability == .ai {
      if !ai {
        Self.reportDenial(
          .ai, feature: feature, url: url, baseURL: baseURL, listener: listener, guardObj: guardObj)
        return false
      }
      if !isNetworkURLPermitted(url, baseURL: baseURL) {
        Self.reportDenial(
          .network, feature: feature, url: url, baseURL: baseURL, listener: listener,
          guardObj: guardObj)
        return false
      }
      return true
    }
    if !has(capability, url: url, baseURL: baseURL) {
      Self.reportDenial(
        capability, feature: feature, url: url, baseURL: baseURL, listener: listener,
        guardObj: guardObj)
      return false
    }
    return true
  }

  private static func resolveURL(_ rawURL: String, baseURL: String?) -> URL? {
    if rawURL.hasPrefix("//") { return nil }
    if let candidate = URL(string: rawURL), candidate.scheme != nil {
      return candidate
    }
    if let baseStr = baseURL?.trimmingCharacters(in: .whitespacesAndNewlines),
      !baseStr.isEmpty,
      let base = URL(string: baseStr)
    {
      return URL(string: rawURL, relativeTo: base)?.absoluteURL
    }
    return nil
  }

  private static func reportDenial(
    _ capability: ThreeLiveCapability,
    feature: String,
    url: String?,
    baseURL: String?,
    listener: ((CapabilityDeniedEvent) -> Void)?,
    guardObj: CapabilityGuard?
  ) {
    let safeURL = url.map { sanitizeDiagnosticURL($0, baseURL: baseURL) }
    if let guardObj = guardObj {
      let key = "\(capability.wireName):\(feature):\(safeURL ?? "")"
      if !guardObj.markSeen(key) { return }
    }
    let urlSuffix = safeURL.map { " (\($0))" } ?? ""
    let message =
      "[Three-Live] Capability '\(capability.wireName)' denied for \(feature)\(urlSuffix). "
      + "Grant '\(capability.wireName)' in ThreeLiveCapabilities to enable."
    let event = CapabilityDeniedEvent(
      capability: capability, feature: feature, message: message, url: safeURL)
    print("W/ThreeLiveCapabilities: \(message)")
    onDenied?(event)
    listener?(event)
  }
}

/// Per-instance capability evaluator that deduplicates repeated frame-loop denial diagnostics.
final class CapabilityGuard: @unchecked Sendable {
  private let lock = NSLock()
  private var seen = Set<String>()

  func reset() {
    lock.lock()
    seen.removeAll()
    lock.unlock()
  }

  fileprivate func markSeen(_ key: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return seen.insert(key).inserted
  }

  func check(
    policy: ThreeLiveCapabilities,
    capability: ThreeLiveCapability,
    feature: String,
    url: String? = nil,
    baseURL: String? = nil,
    dedup: Bool = false,
    onDenied listener: ((CapabilityDeniedEvent) -> Void)? = nil
  ) -> Bool {
    policy.checkInternal(
      capability,
      feature: feature,
      url: url,
      baseURL: baseURL,
      listener: listener,
      guardObj: dedup ? self : nil
    )
  }
}
