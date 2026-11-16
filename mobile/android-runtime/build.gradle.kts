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

// Pure-Kotlin Three-Live runtime, spatial/simulation controllers, AI/voice editors, and
// pluggable `ThreeCompilerBackend` SPI — zero JNI or embedded JavaScript engine.

plugins {
  id("com.android.library")
  id("org.jetbrains.kotlin.android")
  `maven-publish`
  signing
}

base { archivesName.set("three-live-runtime") }

android {
  namespace = "com.google.threelive.runtime"
  compileSdk = 34

  defaultConfig {
    minSdk = 24
    targetSdk = 34
    consumerProguardFiles("consumer-rules.pro")
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  kotlinOptions {
    jvmTarget = "17"
    freeCompilerArgs = listOf("-opt-in=kotlin.RequiresOptIn", "-Xjvm-default=all-compatibility")
  }

  publishing {
    singleVariant("release") {
      withSourcesJar()
      withJavadocJar()
    }
  }
}

dependencies {
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.0")
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.0")

  testImplementation("junit:junit:4.13.2")
}

publishing {
  publications {
    register<MavenPublication>("release") {
      groupId = "com.google.threelive"
      artifactId = "runtime"
      version = "1.4.0"

      afterEvaluate { from(components["release"]) }

      pom {
        name.set("Three-Live Android Runtime")
        description.set(
          "Pure-Kotlin Three-Live spatial/simulation runtime and pluggable ThreeCompilerBackend SPI for Android (no embedded JS engine)"
        )
        url.set("https://github.com/google/three-live")
        licenses {
          license {
            name.set("The Apache License, Version 2.0")
            url.set("https://www.apache.org/licenses/LICENSE-2.0.txt")
            distribution.set("repo")
          }
        }
        developers {
          developer {
            id.set("google")
            name.set("Google LLC")
          }
        }
        scm {
          connection.set("scm:git:git://github.com/google/three-live.git")
          developerConnection.set("scm:git:ssh://github.com:google/three-live.git")
          url.set("https://github.com/google/three-live")
        }
      }
    }
  }
  repositories {
    val ghToken = System.getenv("GITHUB_TOKEN")
    if (!ghToken.isNullOrBlank()) {
      maven {
        name = "GitHubPackages"
        url =
          uri(
            "https://maven.pkg.github.com/${System.getenv("GITHUB_REPOSITORY") ?: "google/three-live"}"
          )
        credentials {
          username = System.getenv("GITHUB_ACTOR") ?: "github-actions"
          password = ghToken
        }
      }
    }
    val centralUser = System.getenv("MAVEN_CENTRAL_USERNAME")
    val centralPass = System.getenv("MAVEN_CENTRAL_PASSWORD")
    if (!centralUser.isNullOrBlank() && !centralPass.isNullOrBlank()) {
      maven {
        name = "MavenCentral"
        url =
          uri(
            System.getenv("MAVEN_CENTRAL_REPO_URL")
              ?: "https://ossrh-staging-api.central.sonatype.com/service/local/staging/deploy/maven2/"
          )
        credentials {
          username = centralUser
          password = centralPass
        }
      }
    }
  }
}

signing {
  val gpgKey = System.getenv("MAVEN_GPG_PRIVATE_KEY")
  if (!gpgKey.isNullOrBlank()) {
    useInMemoryPgpKeys(gpgKey, System.getenv("MAVEN_GPG_PASSPHRASE") ?: "")
    sign(publishing.publications)
  }
}
