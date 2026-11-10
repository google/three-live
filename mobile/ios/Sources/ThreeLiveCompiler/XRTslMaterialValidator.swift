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
import simd

/// Uniform slot metadata inside a validated `extras.tsl` graph.
public struct XRTslUniformSlot: Sendable, Equatable {
  public let name: String
  public let slot: Int
  public let type: String
  public let defaultVec4: SIMD4<Float>
}

/// Validation failure diagnostic (`TL501`..`TL504`) matching Web, Rust, and Android.
public struct XRTslValidationIssue: Error, Sendable, Equatable {
  public let code: String
  public let message: String
}

/// Validated `extras.tsl` v1 DAG with structural FNV-1a hash and deterministic CPU eval.
public struct XRTslValidatedGraph: Sendable {
  struct Node: Sendable {
    let op: String
    let type: String
    let args: [Int]
    let value: [Float]?
    let builtin: String?
    let uniformSlot: Int
    let mask: String?
  }

  public let materialName: String
  public let hash: String
  public let uniformSlots: [XRTslUniformSlot]
  public let uniformSlotByName: [String: XRTslUniformSlot]
  public let usesTime: Bool
  public let usesVertexPosition: Bool
  public let usesDerivatives: Bool
  let nodes: [Node]
  let outputs: [String: Int]
  let fragmentReachable: [Bool]
  let vertexReachable: [Bool]

  /// Allocates a 68-float (`272 B`) staging buffer seeded with declared uniform defaults.
  public func makeDefaultBuffer() -> [Float] {
    var buf = [Float](repeating: 0, count: 68)
    for u in uniformSlots {
      let b = u.slot * 4
      buf[b] = u.defaultVec4.x
      buf[b + 1] = u.defaultVec4.y
      buf[b + 2] = u.defaultVec4.z
      buf[b + 3] = u.defaultVec4.w
    }
    return buf
  }

  /// Evaluates representative PBR surface factors from `buf68` for live RealityKit updates.
  public func evaluateSurfaceFactors(buf68: [Float]) -> (
    baseColor: SIMD3<Float>?,
    opacity: Float?,
    emissive: SIMD3<Float>?,
    roughness: Float?,
    metalness: Float?
  ) {
    XRTslMaterialValidator.evaluateCpu(graph: self, buf68: buf68)
  }
}

/// Pure-Swift `extras.tsl` v1 validator & deterministic CPU evaluator.
public enum XRTslMaterialValidator {
  public static let extrasKey = "tsl"
  public static let maxNodes = 128
  public static let maxUniforms = 16
  public static let timePeriodSec: Float = 3600.0

  private static let forbiddenKeys: Set<String> = ["__proto__", "constructor", "prototype"]
  private static let builtinTypes: [String: String] = [
    "positionLocal": "vec3",
    "positionWorld": "vec3",
    "normalLocal": "vec3",
    "normalWorld": "vec3",
    "viewDirection": "vec3",
    "uv": "vec2",
    "vertexColor": "vec4",
    "instanceIndex": "float",
    "time": "float",
  ]
  private static let outputTypes: [String: String] = [
    "color": "vec3",
    "opacity": "float",
    "emissive": "vec3",
    "roughness": "float",
    "metalness": "float",
    "normalScale": "float",
    "bump": "vec3",
    "position": "vec3",
  ]
  private static let unaryOps: Set<String> = [
    "neg", "abs", "sign", "floor", "ceil", "fract",
    "sqrt", "exp", "log", "sin", "cos", "normalize",
  ]
  private static let bcastOps: Set<String> = [
    "add", "sub", "mul", "div", "mod", "pow", "atan2", "min", "max",
  ]
  private static let fixedSigs: [String: ([String], String)] = [
    "cross": (["vec3", "vec3"], "vec3"),
    "fresnel": (["float"], "float"),
    "simplexNoise2D": (["vec2"], "float"),
    "checker": (["vec2"], "float"),
    "simplexNoise3D": (["vec3"], "float"),
    "voronoi2D": (["vec2", "float"], "float"),
    "triplanar": (["vec3", "float"], "float"),
    "hueShift": (["vec3", "float"], "vec3"),
    "bumpFromHeight": (["float", "float"], "vec3"),
  ]

  public static func safeMod(_ a: Float, _ b: Float) -> Float {
    let d: Float = abs(b) < 1e-6 ? (b < 0 ? -1e-6 : 1e-6) : b
    return a - d * floor(a / d)
  }

  public static func typeArity(_ type: String) -> Int {
    switch type {
    case "float": return 1
    case "vec2": return 2
    case "vec3": return 3
    case "vec4": return 4
    default: return 0
    }
  }

  private static func typeFromArity(_ arity: Int) -> String? {
    switch arity {
    case 1: return "float"
    case 2: return "vec2"
    case 3: return "vec3"
    case 4: return "vec4"
    default: return nil
    }
  }

  private static func isSafeIdent(_ s: String) -> Bool {
    guard let first = s.unicodeScalars.first, s.unicodeScalars.count <= 64 else { return false }
    let isStart =
      (first.value >= 65 && first.value <= 90)
      || (first.value >= 97 && first.value <= 122)
      || first.value == 95
    guard isStart else { return false }
    for sc in s.unicodeScalars.dropFirst() {
      let v = sc.value
      let ok =
        (v >= 65 && v <= 90) || (v >= 97 && v <= 122) || (v >= 48 && v <= 57) || v == 95
      if !ok { return false }
    }
    return true
  }

  public static func packUniformVec4(type: String, raw: Any?) -> SIMD4<Float>? {
    let arity = typeArity(type)
    guard arity > 0 else { return nil }
    if arity == 1 {
      if let d = XRJSON.number(raw), d.isFinite {
        return SIMD4<Float>(Float(d), 0, 0, 0)
      }
      if let arr = raw as? [Float], arr.count == 1, arr[0].isFinite {
        return SIMD4<Float>(arr[0], 0, 0, 0)
      }
      if let arr = XRJSON.array(raw), arr.count == 1, let d = XRJSON.number(arr[0]), d.isFinite {
        return SIMD4<Float>(Float(d), 0, 0, 0)
      }
      return nil
    }
    if let arr = raw as? [Float] {
      guard arr.count >= arity else { return nil }
      var out = SIMD4<Float>(repeating: 0)
      for i in 0..<arity {
        guard arr[i].isFinite else { return nil }
        out[i] = arr[i]
      }
      return out
    }
    guard let arr = XRJSON.array(raw), arr.count >= arity else { return nil }
    var out = SIMD4<Float>(repeating: 0)
    for i in 0..<arity {
      guard let d = XRJSON.number(arr[i]), d.isFinite else { return nil }
      out[i] = Float(d)
    }
    return out
  }

  private static func fnv1aStr(_ h0: UInt32, _ s: String) -> UInt32 {
    var h = h0
    for codeUnit in s.utf16 {
      h = (h ^ UInt32(codeUnit)) &* 16_777_619
    }
    return h
  }

  private static func fnv1aFloat(_ h0: UInt32, _ f: Float) -> UInt32 {
    return (h0 ^ f.bitPattern) &* 16_777_619
  }

  public static func validateDetailed(
    _ raw: Any?,
    materialLabel: String = "Material"
  ) -> Result<XRTslValidatedGraph, XRTslValidationIssue> {
    guard let obj = XRJSON.object(raw) else {
      return .failure(
        XRTslValidationIssue(
          code: "TL501", message: "Invalid extras.tsl on '\(materialLabel)'."))
    }
    guard XRJSON.number(obj["version"]) == 1.0 else {
      return .failure(
        XRTslValidationIssue(
          code: "TL501", message: "Unsupported TSL version on '\(materialLabel)'."))
    }

    var uniformSlots: [XRTslUniformSlot] = []
    var uniformByName: [String: XRTslUniformSlot] = [:]
    if let rawU = obj["uniforms"], !(rawU is NSNull) {
      guard let uMap = XRJSON.object(rawU) else {
        return .failure(
          XRTslValidationIssue(
            code: "TL501", message: "Invalid TSL uniforms on '\(materialLabel)'."))
      }
      let uKeys = uMap.keys.sorted()
      if uKeys.count > maxUniforms {
        return .failure(
          XRTslValidationIssue(
            code: "TL502", message: "TSL '\(materialLabel)' exceeds MAX_UNIFORMS (\(maxUniforms)).")
        )
      }
      for (slot, uName) in uKeys.enumerated() {
        guard
          !forbiddenKeys.contains(uName),
          isSafeIdent(uName),
          let uObj = XRJSON.object(uMap[uName]),
          let uType = XRJSON.string(uObj["type"]),
          let packed = packUniformVec4(type: uType, raw: uObj["value"])
        else {
          return .failure(
            XRTslValidationIssue(
              code: "TL501", message: "Invalid TSL uniform '\(uName)' on '\(materialLabel)'."))
        }
        let info = XRTslUniformSlot(name: uName, slot: slot, type: uType, defaultVec4: packed)
        uniformSlots.append(info)
        uniformByName[uName] = info
      }
    }

    guard let rawNodes = XRJSON.array(obj["nodes"]), !rawNodes.isEmpty else {
      return .failure(
        XRTslValidationIssue(code: "TL501", message: "Empty TSL nodes on '\(materialLabel)'."))
    }
    if rawNodes.count > maxNodes {
      return .failure(
        XRTslValidationIssue(
          code: "TL502", message: "TSL '\(materialLabel)' exceeds MAX_NODES (\(maxNodes))."))
    }

    var nodes: [XRTslValidatedGraph.Node] = []
    nodes.reserveCapacity(rawNodes.count)
    var hash: UInt32 = 2_166_136_261
    for u in uniformSlots {
      hash = fnv1aStr(hash, "U:\(u.slot):\(u.type);")
    }

    for (idx, rn) in rawNodes.enumerated() {
      guard let nObj = XRJSON.object(rn) else {
        return .failure(
          XRTslValidationIssue(
            code: "TL501", message: "Invalid TSL node \(idx) on '\(materialLabel)'."))
      }
      let opRaw = XRJSON.string(nObj["op"])
      if opRaw == "loop" || opRaw == "while" || opRaw == "for" || opRaw == "call" {
        return .failure(
          XRTslValidationIssue(
            code: "TL504", message: "Unsupported loop/call op '\(opRaw ?? "")' at node \(idx)."))
      }
      guard let op = opRaw, let ty = XRJSON.string(nObj["type"]), typeArity(ty) > 0 else {
        return .failure(
          XRTslValidationIssue(
            code: "TL501", message: "Malformed TSL node \(idx) on '\(materialLabel)'."))
      }

      var args: [Int] = []
      if let rawArgsVal = nObj["args"], !(rawArgsVal is NSNull) {
        guard let rawArgs = XRJSON.array(rawArgsVal), rawArgs.count <= 4 else {
          return .failure(
            XRTslValidationIssue(code: "TL501", message: "Invalid args at node \(idx)."))
        }
        for a in rawArgs {
          guard let d = XRJSON.number(a), let ai = Int(exactly: d), ai >= 0, ai < idx else {
            return .failure(
              XRTslValidationIssue(
                code: "TL501", message: "Cyclic or out-of-order arg at node \(idx)."))
          }
          args.append(ai)
        }
      }

      hash = fnv1aStr(hash, "N\(idx):\(op):\(ty):")
      for a in args { hash = fnv1aStr(hash, "\(a),") }
      let tA = args.map { nodes[$0].type }

      if op == "const" {
        let arity = typeArity(ty)
        guard args.isEmpty, let rv = XRJSON.array(nObj["value"]), rv.count == arity else {
          return .failure(
            XRTslValidationIssue(code: "TL501", message: "Invalid const node \(idx)."))
        }
        var vals: [Float] = []
        for c in 0..<arity {
          guard let d = XRJSON.number(rv[c]), d.isFinite else {
            return .failure(
              XRTslValidationIssue(code: "TL501", message: "Non-finite const at node \(idx)."))
          }
          let f = Float(d)
          vals.append(f)
          hash = fnv1aFloat(hash, f)
        }
        nodes.append(
          .init(op: op, type: ty, args: [], value: vals, builtin: nil, uniformSlot: -1, mask: nil))
      } else if op == "builtin" {
        guard args.isEmpty, let bName = XRJSON.string(nObj["name"]), builtinTypes[bName] == ty
        else {
          return .failure(
            XRTslValidationIssue(code: "TL501", message: "Invalid builtin at node \(idx)."))
        }
        hash = fnv1aStr(hash, bName)
        nodes.append(
          .init(op: op, type: ty, args: [], value: nil, builtin: bName, uniformSlot: -1, mask: nil))
      } else if op == "uniform" {
        guard
          args.isEmpty,
          let uName = XRJSON.string(nObj["name"]),
          let uSlot = uniformByName[uName],
          uSlot.type == ty
        else {
          return .failure(
            XRTslValidationIssue(code: "TL501", message: "Invalid uniform ref at node \(idx)."))
        }
        hash = fnv1aStr(hash, "S\(uSlot.slot)")
        nodes.append(
          .init(
            op: op, type: ty, args: [], value: nil, builtin: nil, uniformSlot: uSlot.slot, mask: nil
          ))
      } else if op == "swizzle" {
        guard
          args.count == 1,
          let mask = XRJSON.string(nObj["mask"]),
          !mask.isEmpty,
          mask.count <= 4,
          typeFromArity(mask.count) == ty
        else {
          return .failure(
            XRTslValidationIssue(code: "TL501", message: "Invalid swizzle at node \(idx)."))
        }
        let srcAr = typeArity(tA[0])
        let comps = Array("xyzw")
        for ch in mask {
          guard let ci = comps.firstIndex(of: ch), ci < srcAr else {
            return .failure(
              XRTslValidationIssue(
                code: "TL501", message: "Swizzle '.\(mask)' out of bounds at node \(idx)."))
          }
        }
        hash = fnv1aStr(hash, mask)
        nodes.append(
          .init(op: op, type: ty, args: args, value: nil, builtin: nil, uniformSlot: -1, mask: mask)
        )
      } else if op == "construct" {
        let targetAr = typeArity(ty)
        let sum = tA.reduce(0) { $0 + typeArity($1) }
        guard !args.isEmpty && ((args.count == 1 && tA[0] == "float") || sum == targetAr) else {
          return .failure(
            XRTslValidationIssue(code: "TL501", message: "Invalid construct at node \(idx)."))
        }
        nodes.append(
          .init(op: op, type: ty, args: args, value: nil, builtin: nil, uniformSlot: -1, mask: nil))
      } else if unaryOps.contains(op) {
        guard args.count == 1 && tA[0] == ty else {
          return .failure(
            XRTslValidationIssue(code: "TL501", message: "Type mismatch on '\(op)' at node \(idx).")
          )
        }
        nodes.append(
          .init(op: op, type: ty, args: args, value: nil, builtin: nil, uniformSlot: -1, mask: nil))
      } else if bcastOps.contains(op) {
        let resolved: String? =
          args.count == 2
          ? (tA[0] == tA[1] ? tA[0] : (tA[0] == "float" ? tA[1] : (tA[1] == "float" ? tA[0] : nil)))
          : nil
        guard resolved == ty else {
          return .failure(
            XRTslValidationIssue(code: "TL501", message: "Type mismatch on '\(op)' at node \(idx).")
          )
        }
        nodes.append(
          .init(op: op, type: ty, args: args, value: nil, builtin: nil, uniformSlot: -1, mask: nil))
      } else if op == "step" {
        guard args.count == 2 && (tA[0] == tA[1] || tA[0] == "float") && ty == tA[1] else {
          return .failure(
            XRTslValidationIssue(code: "TL501", message: "Invalid 'step' at node \(idx)."))
        }
        nodes.append(
          .init(op: op, type: ty, args: args, value: nil, builtin: nil, uniformSlot: -1, mask: nil))
      } else if op == "clamp" {
        let ok =
          args.count == 3 && ty == tA[0]
          && ((tA[1] == tA[0] && tA[2] == tA[0]) || (tA[1] == "float" && tA[2] == "float"))
        guard ok else {
          return .failure(
            XRTslValidationIssue(code: "TL501", message: "Invalid 'clamp' at node \(idx)."))
        }
        nodes.append(
          .init(op: op, type: ty, args: args, value: nil, builtin: nil, uniformSlot: -1, mask: nil))
      } else if op == "mix" {
        let ok =
          args.count == 3 && tA[0] == tA[1] && ty == tA[0] && (tA[2] == tA[0] || tA[2] == "float")
        guard ok else {
          return .failure(
            XRTslValidationIssue(code: "TL501", message: "Invalid 'mix' at node \(idx)."))
        }
        nodes.append(
          .init(op: op, type: ty, args: args, value: nil, builtin: nil, uniformSlot: -1, mask: nil))
      } else if op == "smoothstep" {
        let ok =
          args.count == 3 && ty == tA[2]
          && ((tA[0] == tA[2] && tA[1] == tA[2]) || (tA[0] == "float" && tA[1] == "float"))
        guard ok else {
          return .failure(
            XRTslValidationIssue(code: "TL501", message: "Invalid 'smoothstep' at node \(idx)."))
        }
        nodes.append(
          .init(op: op, type: ty, args: args, value: nil, builtin: nil, uniformSlot: -1, mask: nil))
      } else if op == "dot" || op == "distance" {
        guard args.count == 2 && tA[0] == tA[1] && ty == "float" else {
          return .failure(
            XRTslValidationIssue(code: "TL501", message: "Invalid '\(op)' at node \(idx)."))
        }
        nodes.append(
          .init(op: op, type: ty, args: args, value: nil, builtin: nil, uniformSlot: -1, mask: nil))
      } else if op == "length" {
        guard args.count == 1 && ty == "float" else {
          return .failure(
            XRTslValidationIssue(code: "TL501", message: "Invalid 'length' at node \(idx)."))
        }
        nodes.append(
          .init(op: op, type: ty, args: args, value: nil, builtin: nil, uniformSlot: -1, mask: nil))
      } else if op == "reflect" {
        guard args.count == 2 && tA[0] == tA[1] && tA[0] != "float" && ty == tA[0] else {
          return .failure(
            XRTslValidationIssue(code: "TL501", message: "Invalid 'reflect' at node \(idx)."))
        }
        nodes.append(
          .init(op: op, type: ty, args: args, value: nil, builtin: nil, uniformSlot: -1, mask: nil))
      } else if let (expArgs, expOut) = fixedSigs[op] {
        let argsMatch =
          args.count == expArgs.count && ty == expOut
          && zip(tA, expArgs).allSatisfy { $0 == $1 }
        guard argsMatch else {
          return .failure(
            XRTslValidationIssue(code: "TL501", message: "Invalid '\(op)' at node \(idx)."))
        }
        nodes.append(
          .init(op: op, type: ty, args: args, value: nil, builtin: nil, uniformSlot: -1, mask: nil))
      } else {
        return .failure(
          XRTslValidationIssue(code: "TL501", message: "Unknown TSL op '\(op)' at node \(idx)."))
      }
    }

    guard let outObj = XRJSON.object(obj["outputs"]) else {
      return .failure(
        XRTslValidationIssue(code: "TL501", message: "Missing TSL outputs on '\(materialLabel)'."))
    }
    var outputs: [String: Int] = [:]
    for key in outObj.keys.sorted() {
      guard let expTy = outputTypes[key] else {
        return .failure(
          XRTslValidationIssue(
            code: "TL501", message: "Unknown TSL socket '\(key)' on '\(materialLabel)'."))
      }
      guard let rawIdx = outObj[key], !(rawIdx is NSNull) else { continue }
      guard
        let d = XRJSON.number(rawIdx),
        let outIdx = Int(exactly: d),
        outIdx >= 0,
        outIdx < nodes.count,
        nodes[outIdx].type == expTy
      else {
        return .failure(
          XRTslValidationIssue(
            code: "TL501", message: "Invalid TSL output '\(key)' on '\(materialLabel)'."))
      }
      outputs[key] = outIdx
      hash = fnv1aStr(hash, "O:\(key)=\(outIdx);")
    }
    guard !outputs.isEmpty else {
      return .failure(
        XRTslValidationIssue(code: "TL501", message: "No active TSL outputs on '\(materialLabel)'.")
      )
    }

    var fragReach = [Bool](repeating: false, count: nodes.count)
    var vertReach = [Bool](repeating: false, count: nodes.count)
    for (k, outIdx) in outputs {
      if k == "position" { vertReach[outIdx] = true } else { fragReach[outIdx] = true }
    }
    for i in stride(from: nodes.count - 1, through: 0, by: -1) {
      if fragReach[i] { for a in nodes[i].args { fragReach[a] = true } }
      if vertReach[i] { for a in nodes[i].args { vertReach[a] = true } }
    }

    var usesTime = false
    var usesDerivatives = false
    for i in 0..<nodes.count {
      let n = nodes[i]
      if vertReach[i]
        && ((n.op == "builtin" && n.builtin == "viewDirection")
          || n.op == "fresnel" || n.op == "bumpFromHeight")
      {
        return .failure(
          XRTslValidationIssue(
            code: "TL503",
            message:
              "Fragment-only TSL op '\(n.builtin ?? n.op)' used in positionNode on '\(materialLabel)'."
          )
        )
      }
      if fragReach[i] || vertReach[i] {
        if n.op == "builtin" && n.builtin == "time" { usesTime = true }
        if n.op == "bumpFromHeight" { usesDerivatives = true }
      }
    }

    return .success(
      XRTslValidatedGraph(
        materialName: materialLabel,
        hash: String(format: "%08x", hash),
        uniformSlots: uniformSlots,
        uniformSlotByName: uniformByName,
        usesTime: usesTime,
        usesVertexPosition: outputs["position"] != nil,
        usesDerivatives: usesDerivatives,
        nodes: nodes,
        outputs: outputs,
        fragmentReachable: fragReach,
        vertexReachable: vertReach
      )
    )
  }

  public static func validate(_ raw: Any?, materialLabel: String = "Material")
    -> XRTslValidatedGraph?
  {
    if case .success(let g) = validateDetailed(raw, materialLabel: materialLabel) { return g }
    return nil
  }

  static func evaluateCpu(
    graph: XRTslValidatedGraph,
    buf68: [Float]
  ) -> (
    baseColor: SIMD3<Float>?,
    opacity: Float?,
    emissive: SIMD3<Float>?,
    roughness: Float?,
    metalness: Float?
  ) {
    var regs = [SIMD4<Float>](repeating: .zero, count: graph.nodes.count)
    let timeVal = safeMod(buf68.count > 64 ? buf68[64] : 0, timePeriodSec)
    let nw = SIMD3<Float>(0, 0.70710677, 0.70710677)
    let vd = SIMD3<Float>(0, 0, 1)

    func comp(_ idx: Int, _ c: Int, _ srcTy: String) -> Float {
      srcTy == "float" ? regs[idx][0] : regs[idx][c]
    }

    for i in 0..<graph.nodes.count where graph.fragmentReachable[i] {
      let n = graph.nodes[i]
      let ar = typeArity(n.type)
      let a0 = n.args.first ?? 0
      let a1 = n.args.count > 1 ? n.args[1] : 0
      let a2 = n.args.count > 2 ? n.args[2] : 0
      let t0 = n.args.isEmpty ? "float" : graph.nodes[a0].type
      let t1 = n.args.count > 1 ? graph.nodes[a1].type : "float"
      let t2 = n.args.count > 2 ? graph.nodes[a2].type : "float"
      var dst = SIMD4<Float>.zero

      switch n.op {
      case "const":
        if let vals = n.value {
          for c in 0..<min(vals.count, 4) { dst[c] = vals[c] }
        }
      case "builtin":
        switch n.builtin {
        case "uv":
          dst.x = 0.5
          dst.y = 0.5
        case "normalWorld", "normalLocal":
          dst = SIMD4<Float>(nw.x, nw.y, nw.z, 0)
        case "viewDirection":
          dst = SIMD4<Float>(vd.x, vd.y, vd.z, 0)
        case "vertexColor":
          dst = SIMD4<Float>(1, 1, 1, 1)
        case "time":
          dst.x = timeVal
        default: break
        }
      case "uniform":
        let b = n.uniformSlot * 4
        if b + 3 < buf68.count {
          for c in 0..<ar { dst[c] = buf68[b + c] }
        }
      case "swizzle":
        if let mask = n.mask {
          let comps = Array("xyzw")
          for (c, ch) in mask.enumerated() {
            let sc = comps.firstIndex(of: ch) ?? 0
            dst[c] = t0 == "float" ? regs[a0][0] : regs[a0][sc]
          }
        }
      case "construct":
        if n.args.count == 1 && t0 == "float" {
          for c in 0..<ar { dst[c] = regs[a0][0] }
        } else {
          var k = 0
          for ai in n.args {
            let aAr = typeArity(graph.nodes[ai].type)
            for c in 0..<aAr where k < ar {
              dst[k] = regs[ai][c]
              k += 1
            }
          }
        }
      case "neg": for c in 0..<ar { dst[c] = -regs[a0][c] }
      case "abs": for c in 0..<ar { dst[c] = abs(regs[a0][c]) }
      case "sign": for c in 0..<ar { dst[c] = regs[a0][c] > 0 ? 1 : (regs[a0][c] < 0 ? -1 : 0) }
      case "floor": for c in 0..<ar { dst[c] = floor(regs[a0][c]) }
      case "ceil": for c in 0..<ar { dst[c] = ceil(regs[a0][c]) }
      case "fract": for c in 0..<ar { dst[c] = regs[a0][c] - floor(regs[a0][c]) }
      case "sqrt": for c in 0..<ar { dst[c] = sqrt(max(regs[a0][c], 0)) }
      case "exp": for c in 0..<ar { dst[c] = exp(min(max(regs[a0][c], -80), 80)) }
      case "log": for c in 0..<ar { dst[c] = log(max(regs[a0][c], 1e-8)) }
      case "sin": for c in 0..<ar { dst[c] = sin(regs[a0][c]) }
      case "cos": for c in 0..<ar { dst[c] = cos(regs[a0][c]) }
      case "normalize":
        var l2: Float = 0
        for c in 0..<ar { l2 += regs[a0][c] * regs[a0][c] }
        let l = sqrt(l2)
        if l > 1e-6 { for c in 0..<ar { dst[c] = regs[a0][c] / l } }
      case "add": for c in 0..<ar { dst[c] = comp(a0, c, t0) + comp(a1, c, t1) }
      case "sub": for c in 0..<ar { dst[c] = comp(a0, c, t0) - comp(a1, c, t1) }
      case "mul": for c in 0..<ar { dst[c] = comp(a0, c, t0) * comp(a1, c, t1) }
      case "div":
        for c in 0..<ar {
          let den = comp(a1, c, t1)
          let sd: Float = abs(den) < 1e-6 ? (den < 0 ? -1e-6 : 1e-6) : den
          dst[c] = comp(a0, c, t0) / sd
        }
      case "mod": for c in 0..<ar { dst[c] = safeMod(comp(a0, c, t0), comp(a1, c, t1)) }
      case "pow":
        for c in 0..<ar {
          let b = comp(a0, c, t0)
          let e = min(max(comp(a1, c, t1), -64), 64)
          dst[c] = abs(e) < 1e-8 ? 1 : (b <= 0 ? 0 : pow(max(b, 1e-8), e))
        }
      case "atan2":
        for c in 0..<ar {
          let y = comp(a0, c, t0)
          let x = comp(a1, c, t1)
          dst[c] = (abs(y) < 1e-8 && abs(x) < 1e-8) ? 0 : atan2(y, x)
        }
      case "min": for c in 0..<ar { dst[c] = min(comp(a0, c, t0), comp(a1, c, t1)) }
      case "max": for c in 0..<ar { dst[c] = max(comp(a0, c, t0), comp(a1, c, t1)) }
      case "step": for c in 0..<ar { dst[c] = comp(a1, c, t1) < comp(a0, c, t0) ? 0 : 1 }
      case "clamp":
        for c in 0..<ar {
          let lo = min(comp(a1, c, t1), comp(a2, c, t2))
          let hi = max(comp(a1, c, t1), comp(a2, c, t2))
          dst[c] = min(max(comp(a0, c, t0), lo), hi)
        }
      case "mix":
        for c in 0..<ar {
          let x = regs[a0][c]
          let y = regs[a1][c]
          let w = comp(a2, c, t2)
          dst[c] = x + (y - x) * w
        }
      case "smoothstep":
        for c in 0..<ar {
          let e0 = comp(a0, c, t0)
          let e1 = comp(a1, c, t1)
          let x = comp(a2, c, t2)
          let d = e1 - e0
          let sd: Float = abs(d) < 1e-6 ? (d < 0 ? -1e-6 : 1e-6) : d
          let t = min(max((x - e0) / sd, 0), 1)
          dst[c] = t * t * (3 - 2 * t)
        }
      case "dot":
        let sAr = typeArity(t0)
        var s: Float = 0
        for c in 0..<sAr { s += regs[a0][c] * regs[a1][c] }
        dst.x = s
      case "length":
        let sAr = typeArity(t0)
        var s: Float = 0
        for c in 0..<sAr { s += regs[a0][c] * regs[a0][c] }
        dst.x = sqrt(s)
      case "distance":
        let sAr = typeArity(t0)
        var s: Float = 0
        for c in 0..<sAr {
          let d = regs[a0][c] - regs[a1][c]
          s += d * d
        }
        dst.x = sqrt(s)
      case "cross":
        let a = SIMD3<Float>(regs[a0].x, regs[a0].y, regs[a0].z)
        let b = SIMD3<Float>(regs[a1].x, regs[a1].y, regs[a1].z)
        let cr = simd_cross(a, b)
        dst = SIMD4<Float>(cr.x, cr.y, cr.z, 0)
      case "reflect":
        var dp: Float = 0
        for c in 0..<ar { dp += regs[a1][c] * regs[a0][c] }
        for c in 0..<ar { dst[c] = regs[a0][c] - 2 * dp * regs[a1][c] }
      case "fresnel":
        let ndv = min(max(simd_dot(nw, vd), 0), 1)
        dst.x = pow(max(1 - ndv, 1e-8), min(max(regs[a0].x, 1e-3), 64))
      case "checker":
        dst.x = safeMod(floor(regs[a0].x) + floor(regs[a0].y), 2) >= 1 ? 1 : 0
      case "simplexNoise2D":
        dst.x = simplexNoise2D(regs[a0].x, regs[a0].y)
      case "simplexNoise3D", "triplanar":
        dst.x = simplexNoise2D(regs[a0].x + regs[a0].z * 0.37, regs[a0].y)
      case "voronoi2D":
        dst.x = simplexNoise2D(regs[a0].x, regs[a0].y)
      case "hueShift":
        let ang = regs[a1].x
        let ca = cos(ang)
        let sa = sin(ang)
        let k: Float = 0.57735026
        let rx = regs[a0].x
        let ry = regs[a0].y
        let rz = regs[a0].z
        let d = k * (rx + ry + rz) * (1 - ca)
        dst = SIMD4<Float>(
          rx * ca + k * (rz - ry) * sa + d,
          ry * ca + k * (rx - rz) * sa + d,
          rz * ca + k * (ry - rx) * sa + d,
          0
        )
      default: break
      }
      regs[i] = dst
    }

    let col = graph.outputs["color"].map { o in
      SIMD3<Float>(max(regs[o].x, 0), max(regs[o].y, 0), max(regs[o].z, 0))
    }
    let op = graph.outputs["opacity"].map { o in min(max(regs[o].x, 0), 1) }
    let em = graph.outputs["emissive"].map { o in
      SIMD3<Float>(max(regs[o].x, 0), max(regs[o].y, 0), max(regs[o].z, 0))
    }
    let rgh = graph.outputs["roughness"].map { o in min(max(regs[o].x, 0.04), 1) }
    let met = graph.outputs["metalness"].map { o in min(max(regs[o].x, 0), 1) }
    return (col, op, em, rgh, met)
  }

  private static func m289(_ x: Float) -> Float { x - floor(x * (1.0 / 289.0)) * 289.0 }
  private static func perm(_ x: Float) -> Float { m289((x * 34.0 + 10.0) * x) }

  public static func simplexNoise2D(_ vx: Float, _ vy: Float) -> Float {
    let c0: Float = 0.21132487
    let c1: Float = 0.3660254
    let c2: Float = -0.57735026
    let c3: Float = 0.024390243
    let s = (vx + vy) * c1
    var ix = floor(vx + s)
    var iy = floor(vy + s)
    let t = (ix + iy) * c0
    let x0 = vx - ix + t
    let y0 = vy - iy + t
    let i1x: Float = x0 > y0 ? 1.0 : 0.0
    let i1y: Float = 1.0 - i1x
    let x1 = x0 + c0 - i1x
    let y1 = y0 + c0 - i1y
    let x2 = x0 + c2
    let y2 = y0 + c2
    ix = m289(ix)
    iy = m289(iy)
    let ps = [
      perm(perm(iy) + ix),
      perm(perm(iy + i1y) + ix + i1x),
      perm(perm(iy + 1.0) + ix + 1.0),
    ]
    let xs = [x0, x1, x2]
    let ys = [y0, y1, y2]
    var dotSum: Float = 0
    for k in 0..<3 {
      var m = max(0.5 - (xs[k] * xs[k] + ys[k] * ys[k]), 0)
      m *= m
      m *= m
      let gx = 2.0 * ((ps[k] * c3) - floor(ps[k] * c3)) - 1.0
      let hy = abs(gx) - 0.5
      let ox = gx - floor(gx + 0.5)
      m *= 1.7928429 - 0.85373473 * (ox * ox + hy * hy)
      dotSum += m * (ox * xs[k] + hy * ys[k])
    }
    return min(max(0.5 + 65.0 * dotSum, 0), 1)
  }
}
