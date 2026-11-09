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

package com.google.threelive.filament

import android.content.Context
import com.google.android.filament.Engine
import com.google.android.filament.Material
import com.google.android.filament.MaterialInstance
import com.google.threelive.TslMaterialCompiler
import com.google.threelive.TslValidatedGraph
import java.io.File
import java.nio.ByteBuffer

/**
 * Optional runtime bridge to `com.google.android.filament:filamat-android` (`compileOnly`).
 *
 * When the host Android app includes `filamat-android`, `TslFilamatBridge` compiles validated
 * `GOOGLE_material_tsl` graphs into native `.filamat` shaders (OpenGL ES + Vulkan), caches the
 * compiled bytecode under `context.codeCacheDir` keyed by structural DAG hash, and binds uniform
 * updates (`uTslP0..uTslP15`, `uTslTime`) at 60–120 Hz without recompilation. When `filamat` is
 * absent on the classpath, [isAvailable] returns `false` and `ThreeLiveFilamentRenderer` falls back
 * cleanly to `gltfio` `UbershaderProvider` materials driven by `TslMaterialCompiler` CPU
 * evaluation.
 */
internal object TslFilamatBridge {
  private const val CACHE_VERSION = "v1"

  @Volatile private var checkedClasspath = false
  @Volatile private var filamatAvailable = false

  /** Returns `true` when `com.google.android.filament.filamat.MaterialBuilder` is on classpath. */
  fun isAvailable(): Boolean {
    if (checkedClasspath) return filamatAvailable
    synchronized(this) {
      if (checkedClasspath) return filamatAvailable
      filamatAvailable =
        try {
          val filamatCls = Class.forName("com.google.android.filament.filamat.Filamat")
          filamatCls.getMethod("init").invoke(null)
          val builderCls = Class.forName("com.google.android.filament.filamat.MaterialBuilder")
          builderCls.getMethod("init").invoke(null)
          true
        } catch (_: Throwable) {
          false
        }
      checkedClasspath = true
      return filamatAvailable
    }
  }

  /**
   * Loads cached `.filamat` bytecode from `context.codeCacheDir` or compiles `matSource` via
   * reflective `MaterialBuilder` (`MOBILE`, `ALL` target APIs, `PERFORMANCE` optimization).
   */
  fun compileOrLoadMaterial(
    context: Context,
    engine: Engine,
    graph: TslValidatedGraph,
    isTransparent: Boolean,
    doubleSided: Boolean,
    baseColor: FloatArray,
    emissive: FloatArray,
    roughness: Float,
    metallic: Float,
  ): Material? {
    if (!isAvailable()) return null
    val variantKey =
      "${graph.hash}_${if (isTransparent || graph.outputs.containsKey("opacity")) 1 else 0}_${if (doubleSided) 1 else 0}_$CACHE_VERSION"
    val cacheFile = File(context.codeCacheDir, "threelive_tsl_$variantKey.filamat")

    if (cacheFile.isFile && cacheFile.length() > 16L) {
      try {
        val bytes = cacheFile.readBytes()
        val buf = ByteBuffer.allocateDirect(bytes.size).put(bytes)
        buf.flip()
        return Material.Builder().payload(buf, buf.remaining()).build(engine)
      } catch (_: Throwable) {
        cacheFile.delete()
      }
    }

    val matSource =
      graph.compileToFilamentMat(
        isTransparent = isTransparent,
        doubleSided = doubleSided,
        baseColorFactor = baseColor,
        emissiveFactor = emissive,
        roughnessFactor = roughness,
        metallicFactor = metallic,
      )
    val compiledBytes =
      compileMatSourceReflective(matSource, "ThreeLiveTsl_${graph.hash}") ?: return null
    try {
      cacheFile.writeBytes(compiledBytes)
    } catch (_: Throwable) {
      // Ignore read-only cache failures.
    }
    return try {
      val buf = ByteBuffer.allocateDirect(compiledBytes.size).put(compiledBytes)
      buf.flip()
      Material.Builder().payload(buf, buf.remaining()).build(engine)
    } catch (_: Throwable) {
      null
    }
  }

  /** Applies the 68-float TSL staging buffer (`uTslP0..uTslP15` + `uTslTime`) onto `mi`. */
  fun bindUniformBuffer(mi: MaterialInstance, buf68: FloatArray) {
    if (buf68.size < 65) return
    val mat = mi.material
    for (slot in 0 until TslMaterialCompiler.MAX_UNIFORMS) {
      val pName = "uTslP$slot"
      if (mat.hasParameter(pName)) {
        val b = slot * 4
        mi.setParameter(pName, buf68[b], buf68[b + 1], buf68[b + 2], buf68[b + 3])
      }
    }
    if (mat.hasParameter("uTslTime")) {
      mi.setParameter("uTslTime", buf68[64])
    }
  }

  private fun compileMatSourceReflective(matSource: String, name: String): ByteArray? {
    return try {
      val builderCls = Class.forName("com.google.android.filament.filamat.MaterialBuilder")
      val platformCls =
        Class.forName("com.google.android.filament.filamat.MaterialBuilder\$Platform")
      val apiCls = Class.forName("com.google.android.filament.filamat.MaterialBuilder\$TargetApi")
      val optCls =
        Class.forName("com.google.android.filament.filamat.MaterialBuilder\$Optimization")

      val builder = builderCls.getDeclaredConstructor().newInstance()
      builderCls.getMethod("name", String::class.java).invoke(builder, name)
      val mobileEnum = java.lang.Enum.valueOf(platformCls.asSubclass(Enum::class.java), "MOBILE")
      builderCls.getMethod("platform", platformCls).invoke(builder, mobileEnum)
      val allApiEnum = java.lang.Enum.valueOf(apiCls.asSubclass(Enum::class.java), "ALL")
      builderCls.getMethod("targetApi", apiCls).invoke(builder, allApiEnum)
      val perfOptEnum = java.lang.Enum.valueOf(optCls.asSubclass(Enum::class.java), "PERFORMANCE")
      builderCls.getMethod("optimization", optCls).invoke(builder, perfOptEnum)
      builderCls.getMethod("material", String::class.java).invoke(builder, matSource)

      val pkg = builderCls.getMethod("build").invoke(builder) ?: return null
      val pkgCls = pkg.javaClass
      val isValid = pkgCls.getMethod("isValid").invoke(pkg) as? Boolean ?: false
      if (!isValid) return null
      val buf = pkgCls.getMethod("getBuffer").invoke(pkg) as? ByteBuffer ?: return null
      val dup = buf.duplicate()
      val out = ByteArray(dup.remaining())
      dup.get(out)
      out
    } catch (_: Throwable) {
      null
    }
  }
}
