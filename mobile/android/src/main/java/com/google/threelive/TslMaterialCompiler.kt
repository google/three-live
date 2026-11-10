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

package com.google.threelive

import java.util.Locale
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/** Uniform slot metadata inside a validated `extras.tsl` graph. */
data class TslUniformSlot(
  val name: String,
  val slot: Int,
  val type: String,
  val defaultVec4: FloatArray,
)

/** Single validated SSA node inside `extras.tsl`. */
class TslValidatedNode(
  val op: String,
  val type: String,
  val args: IntArray,
  val value: FloatArray? = null,
  val builtin: String? = null,
  val uniformSlot: Int = -1,
  val mask: String? = null,
)

/** Representative CPU-evaluated PBR factors for fallback rendering when `filamat` is absent. */
class TslEvaluatedFactors(
  val baseColor: FloatArray?,
  val opacity: Float?,
  val emissive: FloatArray?,
  val roughness: Float?,
  val metalness: Float?,
)

/**
 * Validated `extras.tsl` graph with structural hash, Filament `.mat` emitter & CPU eval.
 */
class TslValidatedGraph(
  val materialName: String,
  val hash: String,
  val nodes: List<TslValidatedNode>,
  val outputs: Map<String, Int>,
  val uniformSlots: List<TslUniformSlot>,
  val uniformSlotByName: Map<String, TslUniformSlot>,
  val usesTime: Boolean,
  val usesVertexPosition: Boolean,
  val usesDerivatives: Boolean,
  val fragmentReachable: BooleanArray,
  val vertexReachable: BooleanArray,
) {
  /** Allocates a fresh 68-float (`272 B`) staging buffer seeded with declared uniform defaults. */
  fun createDefaultBuffer(): FloatArray {
    val buf = FloatArray(68)
    for (u in uniformSlots) {
      val b = u.slot * 4
      buf[b] = u.defaultVec4[0]
      buf[b + 1] = u.defaultVec4[1]
      buf[b + 2] = u.defaultVec4[2]
      buf[b + 3] = u.defaultVec4[3]
    }
    return buf
  }

  /** Evaluates the fragment DAG at representative surface inputs when `filamat` is unavailable. */
  fun evaluateFallbackFactors(
    buf68: FloatArray,
    uvX: Float = 0.5f,
    uvY: Float = 0.5f,
    normalWorldX: Float = 0f,
    normalWorldY: Float = 0.70710677f,
    normalWorldZ: Float = 0.70710677f,
    viewDirX: Float = 0f,
    viewDirY: Float = 0f,
    viewDirZ: Float = 1f,
  ): TslEvaluatedFactors {
    return TslMaterialCompiler.evaluateCpu(
      this,
      buf68,
      uvX,
      uvY,
      normalWorldX,
      normalWorldY,
      normalWorldZ,
      viewDirX,
      viewDirY,
      viewDirZ,
    )
  }

  /** Generates a complete Filament `.mat` material definition for runtime `filamat` compilation. */
  fun compileToFilamentMat(
    isTransparent: Boolean = false,
    doubleSided: Boolean = false,
    baseColorFactor: FloatArray = floatArrayOf(1f, 1f, 1f, 1f),
    emissiveFactor: FloatArray = floatArrayOf(0f, 0f, 0f),
    roughnessFactor: Float = 0.5f,
    metallicFactor: Float = 0f,
  ): String {
    return TslMaterialCompiler.emitFilamentMat(
      this,
      isTransparent || outputs.containsKey("opacity"),
      doubleSided,
      baseColorFactor,
      emissiveFactor,
      roughnessFactor,
      metallicFactor,
    )
  }
}

/** Validation failure diagnostic (`TL501`..`TL504`) matching Web & Rust compilers. */
data class TslValidationFailure(val code: String, val message: String)

/**
 * Pure-Kotlin validator, Filament `.mat` emitter, and deterministic CPU fallback evaluator for
 * `extras.tsl` v1. Keeps zero Android/Filament binary dependencies so `:mobile:android`
 * JVM unit tests verify 100% cross-platform parity with Web and Rust.
 */
object TslMaterialCompiler {
  const val EXTRAS_KEY: String = "tsl"
  const val MAX_NODES: Int = 128
  const val MAX_UNIFORMS: Int = 16
  const val TIME_PERIOD_SEC: Float = 3600f

  private val SAFE_IDENT = Regex("^[A-Za-z_][A-Za-z0-9_]{0,63}$")
  private val FORBIDDEN_KEYS = setOf("__proto__", "constructor", "prototype")
  private val BUILTIN_TYPES =
    mapOf(
      "positionLocal" to "vec3",
      "positionWorld" to "vec3",
      "normalLocal" to "vec3",
      "normalWorld" to "vec3",
      "viewDirection" to "vec3",
      "uv" to "vec2",
      "vertexColor" to "vec4",
      "instanceIndex" to "float",
      "time" to "float",
    )
  private val OUTPUT_TYPES =
    mapOf(
      "color" to "vec3",
      "opacity" to "float",
      "emissive" to "vec3",
      "roughness" to "float",
      "metalness" to "float",
      "normalScale" to "float",
      "bump" to "vec3",
      "position" to "vec3",
    )
  private val UNARY_OPS =
    setOf(
      "neg",
      "abs",
      "sign",
      "floor",
      "ceil",
      "fract",
      "sqrt",
      "exp",
      "log",
      "sin",
      "cos",
      "normalize",
    )
  private val BCAST_OPS = setOf("add", "sub", "mul", "div", "mod", "pow", "atan2", "min", "max")
  private val FIXED_SIGS =
    mapOf(
      "cross" to (listOf("vec3", "vec3") to "vec3"),
      "fresnel" to (listOf("float") to "float"),
      "simplexNoise2D" to (listOf("vec2") to "float"),
      "checker" to (listOf("vec2") to "float"),
      "simplexNoise3D" to (listOf("vec3") to "float"),
      "voronoi2D" to (listOf("vec2", "float") to "float"),
      "triplanar" to (listOf("vec3", "float") to "float"),
      "hueShift" to (listOf("vec3", "float") to "vec3"),
      "bumpFromHeight" to (listOf("float", "float") to "vec3"),
    )

  /** GLSL-compatible `mod(a, b) = a - d * floor(a / d)` with zero-divisor guard. */
  fun safeMod(a: Float, b: Float): Float {
    val d = if (abs(b) < 1e-6f) (if (b < 0f) -1e-6f else 1e-6f) else b
    return a - d * floor(a / d)
  }

  fun typeArity(type: String): Int =
    when (type) {
      "float" -> 1
      "vec2" -> 2
      "vec3" -> 3
      "vec4" -> 4
      else -> 0
    }

  private fun typeFromArity(arity: Int): String? =
    when (arity) {
      1 -> "float"
      2 -> "vec2"
      3 -> "vec3"
      4 -> "vec4"
      else -> null
    }

  /** Packs a host scalar or vector into a 4-float uniform slot, or `null` if invalid/non-finite. */
  fun packUniformVec4(type: String, rawVal: Any?): FloatArray? {
    val arity = typeArity(type)
    if (arity <= 0) return null
    if (arity == 1) {
      val d =
        when (rawVal) {
          is Number -> rawVal.toDouble()
          is FloatArray -> if (rawVal.size == 1) rawVal[0].toDouble() else Double.NaN
          is List<*> ->
            if (rawVal.size == 1) (rawVal[0] as? Number)?.toDouble() ?: Double.NaN else Double.NaN
          else -> Double.NaN
        }
      if (!d.isFinite()) return null
      return floatArrayOf(d.toFloat(), 0f, 0f, 0f)
    }
    val out = FloatArray(4)
    when (rawVal) {
      is FloatArray -> {
        if (rawVal.size < arity) return null
        for (i in 0 until arity) {
          if (!rawVal[i].isFinite()) return null
          out[i] = rawVal[i]
        }
      }
      is List<*> -> {
        if (rawVal.size < arity) return null
        for (i in 0 until arity) {
          val n = (rawVal[i] as? Number)?.toDouble() ?: return null
          if (!n.isFinite()) return null
          out[i] = n.toFloat()
        }
      }
      else -> return null
    }
    return out
  }

  private fun fnv1aStr(h0: UInt, s: String): UInt {
    var h = h0
    for (ch in s) {
      h = (h xor ch.code.toUInt()) * 16777619u
    }
    return h
  }

  private fun fnv1aFloat(h0: UInt, f: Float): UInt {
    val bits = f.toRawBits().toUInt()
    return (h0 xor bits) * 16777619u
  }

  /** Validates a parsed MiniJson `extras.tsl` map, returning either graph or failure. */
  fun validateDetailed(
    raw: Any?,
    materialLabel: String = "Material",
  ): Pair<TslValidatedGraph?, TslValidationFailure?> {
    val obj =
      MiniJson.asMap(raw)
        ?: return null to
          TslValidationFailure("TL501", "Invalid extras.tsl on '$materialLabel'.")
    val ver = (obj["version"] as? Number)?.toDouble()
    if (ver != 1.0) {
      return null to TslValidationFailure("TL501", "Unsupported TSL version on '$materialLabel'.")
    }

    val uniformSlots = ArrayList<TslUniformSlot>()
    val uniformByName = HashMap<String, TslUniformSlot>()
    val rawUniforms = obj["uniforms"]
    if (rawUniforms != null) {
      val uMap =
        MiniJson.asMap(rawUniforms)
          ?: return null to
            TslValidationFailure("TL501", "Invalid TSL uniforms on '$materialLabel'.")
      val uKeys = uMap.keys.sorted()
      if (uKeys.size > MAX_UNIFORMS) {
        return null to
          TslValidationFailure(
            "TL502",
            "TSL '$materialLabel' exceeds MAX_UNIFORMS ($MAX_UNIFORMS).",
          )
      }
      for ((slot, uName) in uKeys.withIndex()) {
        val uObj = MiniJson.asMap(uMap[uName])
        val uType = MiniJson.asString(uObj?.get("type"))
        val packed = if (uType != null) packUniformVec4(uType, uObj?.get("value")) else null
        if (
          uName in FORBIDDEN_KEYS || !SAFE_IDENT.matches(uName) || uType == null || packed == null
        ) {
          return null to
            TslValidationFailure("TL501", "Invalid TSL uniform '$uName' on '$materialLabel'.")
        }
        val info = TslUniformSlot(uName, slot, uType, packed)
        uniformSlots.add(info)
        uniformByName[uName] = info
      }
    }

    val rawNodes = MiniJson.asList(obj["nodes"])
    if (rawNodes.isNullOrEmpty()) {
      return null to TslValidationFailure("TL501", "Empty TSL nodes on '$materialLabel'.")
    }
    if (rawNodes.size > MAX_NODES) {
      return null to
        TslValidationFailure("TL502", "TSL '$materialLabel' exceeds MAX_NODES ($MAX_NODES).")
    }

    val nodes = ArrayList<TslValidatedNode>(rawNodes.size)
    var hash = 2166136261u
    for (u in uniformSlots) {
      hash = fnv1aStr(hash, "U:${u.slot}:${u.type};")
    }

    for (idx in rawNodes.indices) {
      val nObj =
        MiniJson.asMap(rawNodes[idx])
          ?: return null to
            TslValidationFailure("TL501", "Invalid TSL node $idx on '$materialLabel'.")
      val op = MiniJson.asString(nObj["op"])
      val ty = MiniJson.asString(nObj["type"])
      if (op == "loop" || op == "while" || op == "for" || op == "call") {
        return null to TslValidationFailure("TL504", "Unsupported loop/call op '$op' at node $idx.")
      }
      if (op == null || ty == null || typeArity(ty) == 0) {
        return null to TslValidationFailure("TL501", "Malformed TSL node $idx on '$materialLabel'.")
      }

      val args =
        if (nObj.containsKey("args") && nObj["args"] != null) {
          val rawArgs =
            MiniJson.asList(nObj["args"])
              ?: return null to TslValidationFailure("TL501", "Invalid args at node $idx.")
          if (rawArgs.size > 4) {
            return null to TslValidationFailure("TL501", "Too many args at node $idx.")
          }
          IntArray(rawArgs.size) { k ->
            val d = (rawArgs[k] as? Number)?.toDouble() ?: Double.NaN
            val ai = d.toInt()
            if (!d.isFinite() || d != ai.toDouble() || ai < 0 || ai >= idx) {
              return null to
                TslValidationFailure("TL501", "Cyclic or out-of-order arg at node $idx.")
            }
            ai
          }
        } else {
          IntArray(0)
        }

      hash = fnv1aStr(hash, "N$idx:$op:$ty:")
      for (a in args) hash = fnv1aStr(hash, "$a,")
      val tA = args.map { nodes[it].type }

      when {
        op == "const" -> {
          val arity = typeArity(ty)
          val rv = MiniJson.asList(nObj["value"])
          if (args.isNotEmpty() || rv == null || rv.size != arity) {
            return null to TslValidationFailure("TL501", "Invalid const node $idx.")
          }
          val vals = FloatArray(arity)
          for (c in 0 until arity) {
            val d = (rv[c] as? Number)?.toDouble() ?: Double.NaN
            if (!d.isFinite())
              return null to TslValidationFailure("TL501", "Non-finite const at node $idx.")
            val f = d.toFloat()
            vals[c] = f
            hash = fnv1aFloat(hash, f)
          }
          nodes.add(TslValidatedNode(op, ty, args, value = vals))
        }
        op == "builtin" -> {
          val bName = MiniJson.asString(nObj["name"])
          if (args.isNotEmpty() || bName == null || BUILTIN_TYPES[bName] != ty) {
            return null to TslValidationFailure("TL501", "Invalid builtin at node $idx.")
          }
          hash = fnv1aStr(hash, bName)
          nodes.add(TslValidatedNode(op, ty, args, builtin = bName))
        }
        op == "uniform" -> {
          val uName = MiniJson.asString(nObj["name"])
          val uSlot = if (uName != null) uniformByName[uName] else null
          if (args.isNotEmpty() || uSlot == null || uSlot.type != ty) {
            return null to TslValidationFailure("TL501", "Invalid uniform ref at node $idx.")
          }
          hash = fnv1aStr(hash, "S${uSlot.slot}")
          nodes.add(TslValidatedNode(op, ty, args, uniformSlot = uSlot.slot))
        }
        op == "swizzle" -> {
          val mask = MiniJson.asString(nObj["mask"])
          if (
            args.size != 1 ||
              mask == null ||
              mask.isEmpty() ||
              mask.length > 4 ||
              typeFromArity(mask.length) != ty
          ) {
            return null to TslValidationFailure("TL501", "Invalid swizzle at node $idx.")
          }
          val srcAr = typeArity(tA[0])
          for (ch in mask) {
            val ci = "xyzw".indexOf(ch)
            if (ci < 0 || ci >= srcAr) {
              return null to
                TslValidationFailure("TL501", "Swizzle '.$mask' out of bounds at node $idx.")
            }
          }
          hash = fnv1aStr(hash, mask)
          nodes.add(TslValidatedNode(op, ty, args, mask = mask))
        }
        op == "construct" -> {
          val targetAr = typeArity(ty)
          val sum = tA.sumOf { typeArity(it) }
          if (args.isEmpty() || (!(args.size == 1 && tA[0] == "float") && sum != targetAr)) {
            return null to TslValidationFailure("TL501", "Invalid construct at node $idx.")
          }
          nodes.add(TslValidatedNode(op, ty, args))
        }
        op in UNARY_OPS -> {
          if (args.size != 1 || tA[0] != ty) {
            return null to TslValidationFailure("TL501", "Type mismatch on '$op' at node $idx.")
          }
          nodes.add(TslValidatedNode(op, ty, args))
        }
        op in BCAST_OPS -> {
          val resolved =
            if (args.size == 2) {
              when {
                tA[0] == tA[1] -> tA[0]
                tA[0] == "float" -> tA[1]
                tA[1] == "float" -> tA[0]
                else -> null
              }
            } else {
              null
            }
          if (resolved != ty) {
            return null to TslValidationFailure("TL501", "Type mismatch on '$op' at node $idx.")
          }
          nodes.add(TslValidatedNode(op, ty, args))
        }
        op == "step" -> {
          if (args.size != 2 || (tA[0] != tA[1] && tA[0] != "float") || ty != tA[1]) {
            return null to TslValidationFailure("TL501", "Invalid 'step' at node $idx.")
          }
          nodes.add(TslValidatedNode(op, ty, args))
        }
        op == "clamp" -> {
          val ok =
            args.size == 3 &&
              ty == tA[0] &&
              ((tA[1] == tA[0] && tA[2] == tA[0]) || (tA[1] == "float" && tA[2] == "float"))
          if (!ok) return null to TslValidationFailure("TL501", "Invalid 'clamp' at node $idx.")
          nodes.add(TslValidatedNode(op, ty, args))
        }
        op == "mix" -> {
          val ok =
            args.size == 3 && tA[0] == tA[1] && ty == tA[0] && (tA[2] == tA[0] || tA[2] == "float")
          if (!ok) return null to TslValidationFailure("TL501", "Invalid 'mix' at node $idx.")
          nodes.add(TslValidatedNode(op, ty, args))
        }
        op == "smoothstep" -> {
          val ok =
            args.size == 3 &&
              ty == tA[2] &&
              ((tA[0] == tA[2] && tA[1] == tA[2]) || (tA[0] == "float" && tA[1] == "float"))
          if (!ok)
            return null to TslValidationFailure("TL501", "Invalid 'smoothstep' at node $idx.")
          nodes.add(TslValidatedNode(op, ty, args))
        }
        op == "dot" || op == "distance" -> {
          if (args.size != 2 || tA[0] != tA[1] || ty != "float") {
            return null to TslValidationFailure("TL501", "Invalid '$op' at node $idx.")
          }
          nodes.add(TslValidatedNode(op, ty, args))
        }
        op == "length" -> {
          if (args.size != 1 || ty != "float") {
            return null to TslValidationFailure("TL501", "Invalid 'length' at node $idx.")
          }
          nodes.add(TslValidatedNode(op, ty, args))
        }
        op == "reflect" -> {
          if (args.size != 2 || tA[0] != tA[1] || tA[0] == "float" || ty != tA[0]) {
            return null to TslValidationFailure("TL501", "Invalid 'reflect' at node $idx.")
          }
          nodes.add(TslValidatedNode(op, ty, args))
        }
        FIXED_SIGS.containsKey(op) -> {
          val (expArgs, expOut) = FIXED_SIGS[op]!!
          if (
            args.size != expArgs.size ||
              ty != expOut ||
              expArgs.indices.any { tA[it] != expArgs[it] }
          ) {
            return null to TslValidationFailure("TL501", "Invalid '$op' at node $idx.")
          }
          nodes.add(TslValidatedNode(op, ty, args))
        }
        else -> return null to TslValidationFailure("TL501", "Unknown TSL op '$op' at node $idx.")
      }
    }

    val rawOutputs =
      MiniJson.asMap(obj["outputs"])
        ?: return null to TslValidationFailure("TL501", "Missing TSL outputs on '$materialLabel'.")
    val outputs = LinkedHashMap<String, Int>()
    for (key in rawOutputs.keys.sorted()) {
      val expTy =
        OUTPUT_TYPES[key]
          ?: return null to
            TslValidationFailure("TL501", "Unknown TSL socket '$key' on '$materialLabel'.")
      val rawIdx = rawOutputs[key] ?: continue
      val d = (rawIdx as? Number)?.toDouble() ?: Double.NaN
      val outIdx = d.toInt()
      if (
        !d.isFinite() ||
          d != outIdx.toDouble() ||
          outIdx < 0 ||
          outIdx >= nodes.size ||
          nodes[outIdx].type != expTy
      ) {
        return null to
          TslValidationFailure("TL501", "Invalid TSL output '$key' on '$materialLabel'.")
      }
      outputs[key] = outIdx
      hash = fnv1aStr(hash, "O:$key=$outIdx;")
    }
    if (outputs.isEmpty()) {
      return null to TslValidationFailure("TL501", "No active TSL outputs on '$materialLabel'.")
    }

    val fragReach = BooleanArray(nodes.size)
    val vertReach = BooleanArray(nodes.size)
    for ((k, outIdx) in outputs) {
      if (k == "position") vertReach[outIdx] = true else fragReach[outIdx] = true
    }
    for (i in nodes.indices.reversed()) {
      if (fragReach[i]) for (a in nodes[i].args) fragReach[a] = true
      if (vertReach[i]) for (a in nodes[i].args) vertReach[a] = true
    }

    var usesTime = false
    var usesDerivatives = false
    for (i in nodes.indices) {
      val n = nodes[i]
      if (
        vertReach[i] &&
          ((n.op == "builtin" && n.builtin == "viewDirection") ||
            n.op == "fresnel" ||
            n.op == "bumpFromHeight")
      ) {
        return null to
          TslValidationFailure(
            "TL503",
            "Fragment-only TSL op '${n.builtin ?: n.op}' used in positionNode on '$materialLabel'.",
          )
      }
      if (fragReach[i] || vertReach[i]) {
        if (n.op == "builtin" && n.builtin == "time") usesTime = true
        if (n.op == "bumpFromHeight") usesDerivatives = true
      }
    }

    val hexHash = String.format(Locale.ROOT, "%08x", hash.toInt())
    return TslValidatedGraph(
      materialName = materialLabel,
      hash = hexHash,
      nodes = nodes,
      outputs = outputs,
      uniformSlots = uniformSlots,
      uniformSlotByName = uniformByName,
      usesTime = usesTime,
      usesVertexPosition = outputs.containsKey("position"),
      usesDerivatives = usesDerivatives,
      fragmentReachable = fragReach,
      vertexReachable = vertReach,
    ) to null
  }

  /** Convenience validator returning `TslValidatedGraph?` (`null` on invalid graph). */
  fun validate(raw: Any?, materialLabel: String = "Material"): TslValidatedGraph? =
    validateDetailed(raw, materialLabel).first

  // ---- Filament `.mat` Codegen (`com.google.android.filament.filamat.MaterialBuilder`) ----

  private fun fmtFloat(n: Float): String {
    if (!n.isFinite() || n == 0f) return "0.0"
    val absVal = abs(n)
    if (absVal >= 1e-4f && absVal < 1e6f) {
      val s = String.format(Locale.ROOT, "%.6f", n).trimEnd('0')
      return if (s.endsWith(".")) "${s}0" else s
    }
    return String.format(Locale.ROOT, "%.6e", n)
  }

  internal fun emitFilamentMat(
    graph: TslValidatedGraph,
    isTransparent: Boolean,
    doubleSided: Boolean,
    baseColor: FloatArray,
    emissive: FloatArray,
    roughness: Float,
    metallic: Float,
  ): String {
    val paramDecls = ArrayList<String>()
    for (slot in 0 until MAX_UNIFORMS) {
      paramDecls.add("        { type : float4, name : uTslP$slot }")
    }
    paramDecls.add("        { type : float, name : uTslTime }")

    val blending = if (isTransparent) "fade" else "opaque"
    val culling = if (doubleSided) "none" else "back"
    val anyReach =
      BooleanArray(graph.nodes.size) { graph.fragmentReachable[it] || graph.vertexReachable[it] }
    val helpers = emitGlslHelpers(graph.nodes, anyReach, graph.usesTime)

    val sb = StringBuilder(4096)
    sb.append("material {\n")
    sb.append("    name : ThreeLiveTsl_").append(graph.hash).append(",\n")
    sb.append("    shadingModel : lit,\n")
    sb.append("    blending : ").append(blending).append(",\n")
    sb.append("    culling : ").append(culling).append(",\n")
    if (doubleSided) sb.append("    doubleSided : true,\n")
    sb.append("    requires : [ uv0, color ],\n")
    sb.append("    parameters : [\n")
    sb.append(paramDecls.joinToString(",\n")).append("\n")
    sb.append("    ]\n")
    sb.append("}\n\n")

    if (graph.usesVertexPosition && graph.outputs["position"] != null) {
      val vHelpers = emitGlslHelpers(graph.nodes, graph.vertexReachable, graph.usesTime, false)
      val vBody = emitGlslNodes(graph.nodes, graph.vertexReachable)
      val pOut = graph.outputs["position"]!!
      sb.append("vertex {\n")
      if (vHelpers.isNotEmpty()) sb.append(vHelpers).append("\n")
      sb.append("    void materialVertex(inout MaterialVertexInputs material) {\n")
      sb.append("        mat4 _m = getWorldFromModelMatrix();\n")
      sb.append("        vec3 _tslPL = getPosition().xyz;\n")
      sb.append("        vec3 _tslPW = (_m * vec4(_tslPL, 1.0)).xyz;\n")
      sb.append("        vec3 _tslNL = vec3(0.0, 1.0, 0.0);\n")
      sb.append("        vec3 _tslNW = vec3(0.0, 1.0, 0.0);\n")
      sb.append("        vec3 _tslVD = vec3(0.0, 0.0, 1.0);\n")
      sb.append("        vec2 _tslUV = material.uv0;\n")
      sb.append("        vec4 _tslVC = material.color;\n")
      sb.append("        float _tslII = 0.0;\n")
      sb.append(vBody)
      sb
        .append("        material.worldPosition.xyz = (_m * vec4(_t")
        .append(pOut)
        .append(", 1.0)).xyz;\n")
      sb.append("    }\n")
      sb.append("}\n\n")
    }

    sb.append("fragment {\n")
    if (helpers.isNotEmpty()) sb.append(helpers).append("\n")
    sb.append("    void material(inout MaterialInputs material) {\n")
    sb.append("        prepareMaterial(material);\n")
    if (graph.fragmentReachable.any { it }) {
      sb.append("        vec3 _tslPW = getWorldPosition();\n")
      sb.append("        vec3 _tslPL = _tslPW;\n")
      sb.append("        vec3 _tslNW = shading_normal;\n")
      sb.append("        vec3 _tslNL = _tslNW;\n")
      sb.append("        vec3 _tslVD = shading_view;\n")
      sb.append("        vec2 _tslUV = getUV0();\n")
      sb.append("        vec4 _tslVC = getColor();\n")
      sb.append("        float _tslII = 0.0;\n")
      sb.append(emitGlslNodes(graph.nodes, graph.fragmentReachable))
    }
    emitMaterialOutputs(sb, graph, baseColor, emissive, roughness, metallic)
    sb.append("    }\n")
    sb.append("}\n")
    return sb.toString()
  }

  private fun emitMaterialOutputs(
    sb: StringBuilder,
    graph: TslValidatedGraph,
    baseColor: FloatArray,
    emissive: FloatArray,
    roughness: Float,
    metallic: Float,
  ) {
    val colExpr =
      graph.outputs["color"]?.let { "max(_t$it, vec3(0.0))" }
        ?: "vec3(${fmtFloat(baseColor.getOrElse(0) { 1f })}, ${fmtFloat(baseColor.getOrElse(1) { 1f })}, ${fmtFloat(baseColor.getOrElse(2) { 1f })})"
    val opExpr =
      graph.outputs["opacity"]?.let { "clamp(_t$it, 0.0, 1.0)" }
        ?: fmtFloat(baseColor.getOrElse(3) { 1f }.coerceIn(0f, 1f))
    sb.append("        float _tslAlpha = ").append(opExpr).append(";\n")
    sb
      .append("        material.baseColor = vec4((")
      .append(colExpr)
      .append(") * _tslAlpha, _tslAlpha);\n")
    val rghExpr =
      graph.outputs["roughness"]?.let { "clamp(_t$it, 0.04, 1.0)" }
        ?: fmtFloat(roughness.coerceIn(0.04f, 1f))
    val metExpr =
      graph.outputs["metalness"]?.let { "clamp(_t$it, 0.0, 1.0)" }
        ?: fmtFloat(metallic.coerceIn(0f, 1f))
    sb.append("        material.roughness = ").append(rghExpr).append(";\n")
    sb.append("        material.metallic = ").append(metExpr).append(";\n")
    if (graph.outputs["emissive"] != null) {
      sb
        .append("        material.emissive = vec4(max(_t")
        .append(graph.outputs["emissive"])
        .append(", vec3(0.0)), 0.0);\n")
    } else if (emissive.any { it > 0f }) {
      sb
        .append("        material.emissive = vec4(")
        .append(fmtFloat(emissive.getOrElse(0) { 0f }))
        .append(", ")
        .append(fmtFloat(emissive.getOrElse(1) { 0f }))
        .append(", ")
        .append(fmtFloat(emissive.getOrElse(2) { 0f }))
        .append(", 0.0);\n")
    }
  }

  private fun emitGlslHelpers(
    nodes: List<TslValidatedNode>,
    reachable: BooleanArray,
    usesTime: Boolean,
    isFragment: Boolean = true,
  ): String {
    val ops = HashSet<String>()
    for (i in nodes.indices) if (reachable[i]) ops.add(nodes[i].op)
    val needMod = usesTime || "mod" in ops || "checker" in ops
    val needDiv = "div" in ops || "smoothstep" in ops
    val needClamp = "clamp" in ops || "smoothstep" in ops
    val needPow = "pow" in ops || "fresnel" in ops || "triplanar" in ops
    val needNorm =
      "normalize" in ops || "fresnel" in ops || "triplanar" in ops || "bumpFromHeight" in ops
    val needNoise2 = "simplexNoise2D" in ops || "triplanar" in ops
    val needNoise3 = "simplexNoise3D" in ops
    val needVoronoi = "voronoi2D" in ops

    val out = ArrayList<String>()
    fun vecOver2(fn: String) {
      out.add("    vec2 $fn(vec2 a,vec2 b){return vec2($fn(a.x,b.x),$fn(a.y,b.y));}")
      out.add("    vec3 $fn(vec3 a,vec3 b){return vec3($fn(a.x,b.x),$fn(a.y,b.y),$fn(a.z,b.z));}")
      out.add(
        "    vec4 $fn(vec4 a,vec4 b){return vec4($fn(a.x,b.x),$fn(a.y,b.y),$fn(a.z,b.z),$fn(a.w,b.w));}"
      )
    }
    fun vecOver3(fn: String) {
      out.add("    vec2 $fn(vec2 a,vec2 b,vec2 c){return vec2($fn(a.x,b.x,c.x),$fn(a.y,b.y,c.y));}")
      out.add(
        "    vec3 $fn(vec3 a,vec3 b,vec3 c){return vec3($fn(a.x,b.x,c.x),$fn(a.y,b.y,c.y),$fn(a.z,b.z,c.z));}"
      )
      out.add(
        "    vec4 $fn(vec4 a,vec4 b,vec4 c){return vec4($fn(a.x,b.x,c.x),$fn(a.y,b.y,c.y),$fn(a.z,b.z,c.z),$fn(a.w,b.w,c.w));}"
      )
    }

    if (needDiv) {
      out.add("    float _tslDiv(float a,float b){return a/(abs(b)<1e-6?(b<0.0?-1e-6:1e-6):b);}")
      vecOver2("_tslDiv")
    }
    if (needMod) {
      out.add(
        "    float _tslMod(float a,float b){float d=abs(b)<1e-6?(b<0.0?-1e-6:1e-6):b;return a-d*floor(a/d);}"
      )
      vecOver2("_tslMod")
    }
    if (needPow) {
      out.add(
        "    float _tslPow(float a,float b){float e=clamp(b,-64.0,64.0);return abs(e)<1e-8?1.0:(a<=0.0?0.0:pow(max(a,1e-8),e));}"
      )
      vecOver2("_tslPow")
    }
    if (needClamp) {
      out.add("    float _tslClamp(float a,float b,float c){return clamp(a,min(b,c),max(b,c));}")
      vecOver3("_tslClamp")
    }
    if ("smoothstep" in ops) {
      out.add(
        "    float _tslSmooth(float a,float b,float c){float t=_tslClamp(_tslDiv(c-a,b-a),0.0,1.0);return t*t*(3.0-2.0*t);}"
      )
      vecOver3("_tslSmooth")
    }
    if ("atan2" in ops) {
      out.add(
        "    float _tslAtan2(float a,float b){return(abs(a)<1e-8&&abs(b)<1e-8)?0.0:atan(a,b);}"
      )
      vecOver2("_tslAtan2")
    }
    if (needNorm) {
      out.add("    float _tslNorm(float v){return abs(v)>1e-6?sign(v):0.0;}")
      for (ty in listOf("vec2", "vec3", "vec4")) {
        out.add("    $ty _tslNorm($ty v){float l=length(v);return l>1e-6?v/l:$ty(0.0);}")
      }
    }
    if (needNoise2 || needNoise3 || needVoronoi) {
      out.add("    float _tslM289(float x){return x-floor(x*(1.0/289.0))*289.0;}")
      out.add("    float _tslPerm(float x){return _tslM289((x*34.0+10.0)*x);}")
    }
    if (needNoise2) {
      out.add(
        "    float _tslSNoise2(vec2 v){const float c0=0.21132487,c1=0.3660254,c2=-0.57735026,c3=0.024390243;float s=(v.x+v.y)*c1,ix=floor(v.x+s),iy=floor(v.y+s),t=(ix+iy)*c0,x0=v.x-ix+t,y0=v.y-iy+t,i1x=x0>y0?1.0:0.0,i1y=1.0-i1x,x1=x0+c0-i1x,y1=y0+c0-i1y,x2=x0+c2,y2=y0+c2;ix=_tslM289(ix);iy=_tslM289(iy);float p0=_tslPerm(_tslPerm(iy)+ix),p1=_tslPerm(_tslPerm(iy+i1y)+ix+i1x),p2=_tslPerm(_tslPerm(iy+1.0)+ix+1.0);vec3 m=max(0.5-vec3(x0*x0+y0*y0,x1*x1+y1*y1,x2*x2+y2*y2),0.0);m=m*m;m=m*m;vec3 gx=2.0*fract(vec3(p0,p1,p2)*c3)-1.0,hy=abs(gx)-0.5,ox=gx-floor(gx+0.5);m*=1.7928429-0.85373473*(ox*ox+hy*hy);return clamp(0.5+65.0*dot(m,ox*vec3(x0,x1,x2)+hy*vec3(y0,y1,y2)),0.0,1.0);}"
      )
    }
    if (needNoise3) {
      out.add(
        "    float _tslSNoise3(vec3 v){const float c0=0.16666667,c1=0.33333334,ns=0.14285715;float s=(v.x+v.y+v.z)*c1,i0=floor(v.x+s),i1=floor(v.y+s),i2=floor(v.z+s),t=(i0+i1+i2)*c0;vec3 p0=v-vec3(i0,i1,i2)+t,g=step(p0.yzx,p0.xyz),l=1.0-g.zxy,a1=min(g,l),a2=max(g,l),p1=p0-a1+c0,p2=p0-a2+c1,p3=p0-0.5;i0=_tslM289(i0);i1=_tslM289(i1);i2=_tslM289(i2);vec4 hs=vec4(_tslPerm(_tslPerm(_tslPerm(i2)+i1)+i0),_tslPerm(_tslPerm(_tslPerm(i2+a1.z)+i1+a1.y)+i0+a1.x),_tslPerm(_tslPerm(_tslPerm(i2+a2.z)+i1+a2.y)+i0+a2.x),_tslPerm(_tslPerm(_tslPerm(i2+1.0)+i1+1.0)+i0+1.0));float sum=0.0;for(int k=0;k<4;k++){float pk=hs[k],j=pk-49.0*floor(pk*ns*ns),x_=floor(j*ns),y_=floor(j-7.0*x_),gx=x_*(2.0/7.0)+(1.0/7.0)-1.0,gy=y_*(2.0/7.0)+(1.0/7.0)-1.0,gz=1.0-abs(gx)-abs(gy),sz=gz<0.0?1.0:0.0;gx-=sz*(gx>=0.0?1.0:-1.0);gy-=sz*(gy>=0.0?1.0:-1.0);float inv=1.7928429-0.85373473*(gx*gx+gy*gy+gz*gz);vec3 q=k==0?p0:(k==1?p1:(k==2?p2:p3));float m=max(0.6-dot(q,q),0.0);m=m*m;m=m*m;sum+=m*inv*(gx*q.x+gy*q.y+gz*q.z);}return clamp(0.5+21.0*sum,0.0,1.0);}"
      )
    }
    if (needVoronoi) {
      out.add(
        "    float _tslVoronoi2(vec2 u,float jit){vec2 n=floor(u),fr=u-n;float jt=clamp(jit,0.0,1.0),md=8.0;for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){float qx=_tslM289(n.x+float(dx)),qy=_tslM289(n.y+float(dy)),hx=fract(_tslPerm(_tslPerm(qx)+qy)*(1.0/41.0)),hy=fract(_tslPerm(_tslPerm(qy+7.0)+qx+13.0)*(1.0/41.0));md=min(md,length(vec2(float(dx),float(dy))+0.5+(vec2(hx,hy)-0.5)*jt-fr));}return clamp(md,0.0,1.0);}"
      )
    }
    if ("checker" in ops) {
      out.add(
        "    float _tslChecker(vec2 p){return _tslMod(floor(p.x)+floor(p.y),2.0)>=1.0?1.0:0.0;}"
      )
    }
    if ("fresnel" in ops) {
      out.add(
        "    float _tslFresnel(float pw,vec3 nw,vec3 vd){return _tslPow(1.0-clamp(dot(_tslNorm(nw),_tslNorm(vd)),0.0,1.0),max(pw,1e-3));}"
      )
    }
    if ("triplanar" in ops) {
      out.add(
        "    float _tslTriplanar(vec3 p,float sh,vec3 nw){vec3 w=_tslPow(max(abs(_tslNorm(nw)),vec3(1e-4)),vec3(clamp(sh,0.5,16.0)));return(w.x*_tslSNoise2(p.yz)+w.y*_tslSNoise2(p.xz)+w.z*_tslSNoise2(p.xy))/max(w.x+w.y+w.z,1e-6);}"
      )
    }
    if ("hueShift" in ops) {
      out.add(
        "    vec3 _tslHueShift(vec3 rgb,float ang){const vec3 k=vec3(0.57735026);float c=cos(ang),s=sin(ang);return rgb*c+cross(k,rgb)*s+k*dot(k,rgb)*(1.0-c);}"
      )
    }
    if ("bumpFromHeight" in ops && isFragment) {
      out.add(
        "    vec3 _tslBump(float h,float st,vec3 nw,vec3 wp){vec3 n=_tslNorm(nw),dx=dFdx(wp),dy=dFdy(wp),r1=cross(dy,n),r2=cross(n,dx);float ad=abs(dot(dx,r1));if(ad<1e-8)return n;vec3 g=st*(dot(dx,r1)<0.0?-1.0:1.0)*(dFdx(h)*r1+dFdy(h)*r2);float gl=length(g);return _tslNorm(ad*n-g*min(1.0,0.85*ad/max(gl,1e-8)));}"
      )
    }
    return out.joinToString("\n")
  }

  private fun emitGlslNodes(nodes: List<TslValidatedNode>, reachable: BooleanArray): String {
    val sb = StringBuilder()
    fun splat(ty: String, e: String) = if (ty == "float") e else "$ty($e)"
    fun bc(e: String, st: String, dt: String) = if (st == dt) e else "$dt($e)"
    val bVars =
      mapOf(
        "positionLocal" to "_tslPL",
        "positionWorld" to "_tslPW",
        "normalLocal" to "_tslNL",
        "normalWorld" to "_tslNW",
        "viewDirection" to "_tslVD",
        "uv" to "_tslUV",
        "vertexColor" to "_tslVC",
        "instanceIndex" to "_tslII",
      )

    for (i in nodes.indices) {
      if (!reachable[i]) continue
      val n = nodes[i]
      val ty = n.type
      val a0 = if (n.args.isNotEmpty()) "_t${n.args[0]}" else ""
      val a1 = if (n.args.size > 1) "_t${n.args[1]}" else ""
      val a2 = if (n.args.size > 2) "_t${n.args[2]}" else ""
      val t0 = if (n.args.isNotEmpty()) nodes[n.args[0]].type else "float"
      val t1 = if (n.args.size > 1) nodes[n.args[1]].type else "float"
      val t2 = if (n.args.size > 2) nodes[n.args[2]].type else "float"
      val expr =
        when (n.op) {
          "const" -> {
            val vs = (n.value ?: floatArrayOf(0f)).map { fmtFloat(it) }
            if (ty == "float") vs[0] else "$ty(${vs.joinToString(",")})"
          }
          "builtin" ->
            if (n.builtin == "time") {
              "_tslMod(materialParams.uTslTime,${fmtFloat(TIME_PERIOD_SEC)})"
            } else {
              bVars[n.builtin] ?: "0.0"
            }
          "uniform" -> {
            val s = "materialParams.uTslP${n.uniformSlot}"
            val ar = typeArity(ty)
            if (ar == 4) s else "$s.${"xyz".substring(0, ar)}"
          }
          "swizzle" -> if (t0 == "float") splat(ty, a0) else "$a0.${n.mask}"
          "construct" -> if (ty == "float") a0 else "$ty(${n.args.joinToString(",") { "_t$it" }})"
          "neg" -> "(-$a0)"
          "abs",
          "sign",
          "floor",
          "ceil",
          "fract",
          "sin",
          "cos" -> "${n.op}($a0)"
          "sqrt" -> "sqrt(max($a0,${splat(ty, "0.0")}))"
          "exp" -> "exp(clamp($a0,${splat(ty, "-80.0")},${splat(ty, "80.0")}))"
          "log" -> "log(max($a0,${splat(ty, "1.0e-8")}))"
          "normalize" -> "_tslNorm($a0)"
          "add" -> "(${bc(a0, t0, ty)}+${bc(a1, t1, ty)})"
          "sub" -> "(${bc(a0, t0, ty)}-${bc(a1, t1, ty)})"
          "mul" -> "(${bc(a0, t0, ty)}*${bc(a1, t1, ty)})"
          "div" -> "_tslDiv(${bc(a0, t0, ty)},${bc(a1, t1, ty)})"
          "mod" -> "_tslMod(${bc(a0, t0, ty)},${bc(a1, t1, ty)})"
          "pow" -> "_tslPow(${bc(a0, t0, ty)},${bc(a1, t1, ty)})"
          "atan2" -> "_tslAtan2(${bc(a0, t0, ty)},${bc(a1, t1, ty)})"
          "min",
          "max",
          "step" -> "${n.op}(${bc(a0, t0, ty)},${bc(a1, t1, ty)})"
          "clamp" -> "_tslClamp(${bc(a0, t0, ty)},${bc(a1, t1, ty)},${bc(a2, t2, ty)})"
          "mix" -> "mix($a0,$a1,${bc(a2, t2, ty)})"
          "smoothstep" -> "_tslSmooth(${bc(a0, t0, ty)},${bc(a1, t1, ty)},${bc(a2, t2, ty)})"
          "dot" -> if (t0 == "float") "($a0*$a1)" else "dot($a0,$a1)"
          "length" -> if (t0 == "float") "abs($a0)" else "length($a0)"
          "distance" -> if (t0 == "float") "abs($a0-$a1)" else "distance($a0,$a1)"
          "cross",
          "reflect" -> "${n.op}($a0,$a1)"
          "fresnel" -> "_tslFresnel($a0,_tslNW,_tslVD)"
          "simplexNoise2D" -> "_tslSNoise2($a0)"
          "simplexNoise3D" -> "_tslSNoise3($a0)"
          "voronoi2D" -> "_tslVoronoi2($a0,$a1)"
          "checker" -> "_tslChecker($a0)"
          "triplanar" -> "_tslTriplanar($a0,$a1,_tslNW)"
          "hueShift" -> "_tslHueShift($a0,$a1)"
          "bumpFromHeight" -> "_tslBump($a0,$a1,_tslNW,_tslPW)"
          else -> splat(ty, "0.0")
        }
      sb
        .append("        ")
        .append(ty)
        .append(" _t")
        .append(i)
        .append(" = ")
        .append(expr)
        .append(";\n")
    }
    return sb.toString()
  }

  // ---- Deterministic CPU Fallback Evaluator (when `filamat-android` is absent) ----

  private fun m289(x: Float): Float = x - floor(x * (1f / 289f)) * 289f

  private fun perm(x: Float): Float = m289((x * 34f + 10f) * x)

  fun simplexNoise2D(vx: Float, vy: Float): Float {
    val c0 = 0.21132487f
    val c1 = 0.3660254f
    val c2 = -0.57735026f
    val c3 = 0.024390243f
    val s = (vx + vy) * c1
    var ix = floor(vx + s)
    var iy = floor(vy + s)
    val t = (ix + iy) * c0
    val x0 = vx - ix + t
    val y0 = vy - iy + t
    val i1x = if (x0 > y0) 1f else 0f
    val i1y = 1f - i1x
    val x1 = x0 + c0 - i1x
    val y1 = y0 + c0 - i1y
    val x2 = x0 + c2
    val y2 = y0 + c2
    ix = m289(ix)
    iy = m289(iy)
    val p0 = perm(perm(iy) + ix)
    val p1 = perm(perm(iy + i1y) + ix + i1x)
    val p2 = perm(perm(iy + 1f) + ix + 1f)
    val ps = floatArrayOf(p0, p1, p2)
    val xs = floatArrayOf(x0, x1, x2)
    val ys = floatArrayOf(y0, y1, y2)
    var dotSum = 0f
    for (k in 0..2) {
      var m = max(0.5f - (xs[k] * xs[k] + ys[k] * ys[k]), 0f)
      m *= m
      m *= m
      val gx = 2f * ((ps[k] * c3) - floor(ps[k] * c3)) - 1f
      val hy = abs(gx) - 0.5f
      val ox = gx - floor(gx + 0.5f)
      m *= 1.7928429f - 0.85373473f * (ox * ox + hy * hy)
      dotSum += m * (ox * xs[k] + hy * ys[k])
    }
    return (0.5f + 65f * dotSum).coerceIn(0f, 1f)
  }

  internal fun evaluateCpu(
    graph: TslValidatedGraph,
    buf68: FloatArray,
    uvX: Float,
    uvY: Float,
    nwX: Float,
    nwY: Float,
    nwZ: Float,
    vdX: Float,
    vdY: Float,
    vdZ: Float,
  ): TslEvaluatedFactors {
    val regs = Array(graph.nodes.size) { FloatArray(4) }
    val timeWrapped = safeMod(buf68.getOrElse(64) { 0f }, TIME_PERIOD_SEC)

    fun comp(idx: Int, c: Int, srcTy: String): Float =
      if (srcTy == "float") regs[idx][0] else regs[idx][c]

    for (i in graph.nodes.indices) {
      if (!graph.fragmentReachable[i]) continue
      val n = graph.nodes[i]
      val dst = regs[i]
      val ar = typeArity(n.type)
      val a0 = n.args.getOrElse(0) { 0 }
      val a1 = n.args.getOrElse(1) { 0 }
      val a2 = n.args.getOrElse(2) { 0 }
      val t0 = if (n.args.isNotEmpty()) graph.nodes[a0].type else "float"
      val t1 = if (n.args.size > 1) graph.nodes[a1].type else "float"
      val t2 = if (n.args.size > 2) graph.nodes[a2].type else "float"

      when (n.op) {
        "const" -> n.value?.copyInto(dst, 0, 0, min(n.value.size, 4))
        "builtin" ->
          when (n.builtin) {
            "uv" -> {
              dst[0] = uvX
              dst[1] = uvY
            }
            "normalWorld",
            "normalLocal" -> {
              dst[0] = nwX
              dst[1] = nwY
              dst[2] = nwZ
            }
            "viewDirection" -> {
              dst[0] = vdX
              dst[1] = vdY
              dst[2] = vdZ
            }
            "vertexColor" -> {
              dst[0] = 1f
              dst[1] = 1f
              dst[2] = 1f
              dst[3] = 1f
            }
            "time" -> dst[0] = timeWrapped
            else -> {}
          }
        "uniform" -> {
          val b = n.uniformSlot * 4
          if (b + 3 < buf68.size) {
            for (c in 0 until ar) dst[c] = buf68[b + c]
          }
        }
        "swizzle" -> {
          val mask = n.mask ?: "x"
          for (c in mask.indices) {
            val sc = "xyzw".indexOf(mask[c]).coerceAtLeast(0)
            dst[c] = if (t0 == "float") regs[a0][0] else regs[a0][sc]
          }
        }
        "construct" -> {
          if (n.args.size == 1 && t0 == "float") {
            for (c in 0 until ar) dst[c] = regs[a0][0]
          } else {
            var k = 0
            for (ai in n.args) {
              val aAr = typeArity(graph.nodes[ai].type)
              for (c in 0 until aAr) if (k < ar) dst[k++] = regs[ai][c]
            }
          }
        }
        "neg" -> for (c in 0 until ar) dst[c] = -regs[a0][c]
        "abs" -> for (c in 0 until ar) dst[c] = abs(regs[a0][c])
        "sign" ->
          for (c in 0 until ar) dst[c] =
            if (regs[a0][c] > 0f) 1f else if (regs[a0][c] < 0f) -1f else 0f
        "floor" -> for (c in 0 until ar) dst[c] = floor(regs[a0][c])
        "ceil" -> for (c in 0 until ar) dst[c] = ceil(regs[a0][c])
        "fract" -> for (c in 0 until ar) dst[c] = regs[a0][c] - floor(regs[a0][c])
        "sqrt" -> for (c in 0 until ar) dst[c] = sqrt(max(regs[a0][c], 0f))
        "exp" -> for (c in 0 until ar) dst[c] = exp(regs[a0][c].coerceIn(-80f, 80f))
        "log" -> for (c in 0 until ar) dst[c] = ln(max(regs[a0][c], 1e-8f))
        "sin" -> for (c in 0 until ar) dst[c] = sin(regs[a0][c])
        "cos" -> for (c in 0 until ar) dst[c] = cos(regs[a0][c])
        "normalize" -> {
          var l2 = 0f
          for (c in 0 until ar) l2 += regs[a0][c] * regs[a0][c]
          val l = sqrt(l2)
          if (l > 1e-6f) for (c in 0 until ar) dst[c] = regs[a0][c] / l
        }
        "add" -> for (c in 0 until ar) dst[c] = comp(a0, c, t0) + comp(a1, c, t1)
        "sub" -> for (c in 0 until ar) dst[c] = comp(a0, c, t0) - comp(a1, c, t1)
        "mul" -> for (c in 0 until ar) dst[c] = comp(a0, c, t0) * comp(a1, c, t1)
        "div" ->
          for (c in 0 until ar) {
            val den = comp(a1, c, t1)
            val sd = if (abs(den) < 1e-6f) (if (den < 0f) -1e-6f else 1e-6f) else den
            dst[c] = comp(a0, c, t0) / sd
          }
        "mod" -> for (c in 0 until ar) dst[c] = safeMod(comp(a0, c, t0), comp(a1, c, t1))
        "pow" ->
          for (c in 0 until ar) {
            val b = comp(a0, c, t0)
            val e = comp(a1, c, t1).coerceIn(-64f, 64f)
            dst[c] = if (abs(e) < 1e-8f) 1f else if (b <= 0f) 0f else max(b, 1e-8f).pow(e)
          }
        "atan2" ->
          for (c in 0 until ar) {
            val y = comp(a0, c, t0)
            val x = comp(a1, c, t1)
            dst[c] = if (abs(y) < 1e-8f && abs(x) < 1e-8f) 0f else atan2(y, x)
          }
        "min" -> for (c in 0 until ar) dst[c] = min(comp(a0, c, t0), comp(a1, c, t1))
        "max" -> for (c in 0 until ar) dst[c] = max(comp(a0, c, t0), comp(a1, c, t1))
        "step" -> for (c in 0 until ar) dst[c] = if (comp(a1, c, t1) < comp(a0, c, t0)) 0f else 1f
        "clamp" ->
          for (c in 0 until ar) {
            val lo = min(comp(a1, c, t1), comp(a2, c, t2))
            val hi = max(comp(a1, c, t1), comp(a2, c, t2))
            dst[c] = comp(a0, c, t0).coerceIn(lo, hi)
          }
        "mix" ->
          for (c in 0 until ar) {
            val x = regs[a0][c]
            val y = regs[a1][c]
            val w = comp(a2, c, t2)
            dst[c] = x + (y - x) * w
          }
        "smoothstep" ->
          for (c in 0 until ar) {
            val e0 = comp(a0, c, t0)
            val e1 = comp(a1, c, t1)
            val x = comp(a2, c, t2)
            val d = e1 - e0
            val sd = if (abs(d) < 1e-6f) (if (d < 0f) -1e-6f else 1e-6f) else d
            val t = ((x - e0) / sd).coerceIn(0f, 1f)
            dst[c] = t * t * (3f - 2f * t)
          }
        "dot" -> {
          val sAr = typeArity(t0)
          var s = 0f
          for (c in 0 until sAr) s += regs[a0][c] * regs[a1][c]
          dst[0] = s
        }
        "length" -> {
          val sAr = typeArity(t0)
          var s = 0f
          for (c in 0 until sAr) s += regs[a0][c] * regs[a0][c]
          dst[0] = sqrt(s)
        }
        "distance" -> {
          val sAr = typeArity(t0)
          var s = 0f
          for (c in 0 until sAr) {
            val d = regs[a0][c] - regs[a1][c]
            s += d * d
          }
          dst[0] = sqrt(s)
        }
        "cross" -> {
          val ax = regs[a0][0]
          val ay = regs[a0][1]
          val az = regs[a0][2]
          val bx = regs[a1][0]
          val by = regs[a1][1]
          val bz = regs[a1][2]
          dst[0] = ay * bz - az * by
          dst[1] = az * bx - ax * bz
          dst[2] = ax * by - ay * bx
        }
        "reflect" -> {
          var dp = 0f
          for (c in 0 until ar) dp += regs[a1][c] * regs[a0][c]
          for (c in 0 until ar) dst[c] = regs[a0][c] - 2f * dp * regs[a1][c]
        }
        "fresnel" -> {
          val nl = max(sqrt(nwX * nwX + nwY * nwY + nwZ * nwZ), 1e-6f)
          val vl = max(sqrt(vdX * vdX + vdY * vdY + vdZ * vdZ), 1e-6f)
          val ndv =
            ((nwX / nl) * (vdX / vl) + (nwY / nl) * (vdY / vl) + (nwZ / nl) * (vdZ / vl)).coerceIn(
              0f,
              1f,
            )
          dst[0] = max(1f - ndv, 1e-8f).pow(max(regs[a0][0], 1e-3f).coerceAtMost(64f))
        }
        "simplexNoise2D" -> dst[0] = simplexNoise2D(regs[a0][0], regs[a0][1])
        "simplexNoise3D",
        "triplanar" -> dst[0] = simplexNoise2D(regs[a0][0] + regs[a0][2] * 0.37f, regs[a0][1])
        "voronoi2D" -> dst[0] = simplexNoise2D(regs[a0][0], regs[a0][1])
        "checker" ->
          dst[0] = if (safeMod(floor(regs[a0][0]) + floor(regs[a0][1]), 2f) >= 1f) 1f else 0f
        "hueShift" -> {
          val ang = regs[a1][0]
          val ca = cos(ang)
          val sa = sin(ang)
          val k = 0.57735026f
          val rx = regs[a0][0]
          val ry = regs[a0][1]
          val rz = regs[a0][2]
          val d = k * (rx + ry + rz) * (1f - ca)
          dst[0] = rx * ca + k * (rz - ry) * sa + d
          dst[1] = ry * ca + k * (rx - rz) * sa + d
          dst[2] = rz * ca + k * (ry - rx) * sa + d
        }
        else -> {}
      }
    }

    val col =
      graph.outputs["color"]?.let { o ->
        floatArrayOf(max(regs[o][0], 0f), max(regs[o][1], 0f), max(regs[o][2], 0f))
      }
    val op = graph.outputs["opacity"]?.let { o -> regs[o][0].coerceIn(0f, 1f) }
    val em =
      graph.outputs["emissive"]?.let { o ->
        floatArrayOf(max(regs[o][0], 0f), max(regs[o][1], 0f), max(regs[o][2], 0f))
      }
    val rgh = graph.outputs["roughness"]?.let { o -> regs[o][0].coerceIn(0.04f, 1f) }
    val met = graph.outputs["metalness"]?.let { o -> regs[o][0].coerceIn(0f, 1f) }
    return TslEvaluatedFactors(col, op, em, rgh, met)
  }
}
