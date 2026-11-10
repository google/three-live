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

#if os(iOS)
  import Foundation

  public enum StudioMode: String, CaseIterable, Identifiable, Sendable {
    case threeLive = "Three-Live"
    case xrLive = "XR-Live"

    public var id: String { rawValue }
  }

  public struct SampleAiEdit: Identifiable, Sendable {
    public let id = UUID()
    public let prompt: String
    public let script: String

    public init(prompt: String, script: String) {
      self.prompt = prompt
      self.script = script
    }
  }

  public struct ScenePreset: Identifiable, Sendable {
    public let id = UUID()
    public let name: String
    public let description: String
    public let script: String
    public let mode: StudioMode
    public let sampleEdits: [SampleAiEdit]

    public init(
      name: String,
      description: String,
      script: String,
      mode: StudioMode = .threeLive,
      sampleEdits: [SampleAiEdit] = []
    ) {
      self.name = name
      self.description = description
      self.script = script
      self.mode = mode
      self.sampleEdits = sampleEdits
    }
  }

  public enum SampleScenes {
    private static let walnutGrainPng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAEeElEQVR42u3bKZuzMBAAYOQKBAKBQCAQiBUVCAQCgUAgIhAV/f9/o9/SwjbHzGRy0GOfT0T0pPPmmBw0Gav0OlXZda6zq9jK0tyLqNUy1/D7zk1+K5fve7k/fnzH+pn1GtPPtUakTFvZHw9leu1/Slek17b4urb51/WklfW59bX1PWvpi/tnfsv2vF72963XSHSARQpsAQDEgQC/j8vjAYYdYL0wVKtcgPMGcGEAjATAqNX+IAWwBnmyABjBUwDb9493gIwNICgAJfhc+fxcaQDbxdkA+UEAlQawOAAsJADR/EsLgNb8O6T57wCdI0BPAjRqsdX+MwBaCoDq/1yAtXmKWAANo/9bAAZfgJIJIPX/6QZQxwNQ+j8EUD4CtAI4DIBcAL3219+VoP2fDZCDAEIZAFMYoMSbf3AGcAZo3AHOEsC54fV/LkAXmgGOBFgcAfTmjQE49X9bBoAA5OvvAOJZAOURAET/1wB6YACcvQGaAwBKGODkmwE4APUGsEQEUGaAvgAFH6D3AZDWPwlW+34AGZoBBiZAtAwgfU/vBVCHAegZwAvAMQMMWvA9MEuMBhCSASCAwXEN4AMwuACImAAlAmAZAENT4CEAy9sA2DNAb0mB4mMBIqVAP4A/NAe4AUSfA3ABqvA5QBc4B8AB6vcF4C6CngZwaRj7gC8A6EIAQvYBbADgRsinAZzZGyFuAH2MneB3BeDsBfYHbYWTAEFnAVwA5lnAWwAI4jRoYRyGkADVawA6X4A5JkAVDwBdBxShALUfwMUDADoNHiIAdF4ANfM4HAP4BgCIA9EpBKA4AGAPDgreFUDfDptQAHjDxDoP8DgOZwGIJwGowZtnBt4ARv9/tBT5ngBwNfgpAK0FQK7x23KaApA3RKjgZQQWgLEn+AjSDN6cLToDFPDovwPIKTMigHpHCH0snimDnhWA2BDhA3yBAOim6PMAMqTwboziArQAADYQJjMjeF+AGQ34/tr8aQDyWiAEYO9/s9YNQgDA/q/PG2wARuBVIECNAACv6wCdN4AUfK6NAxjAjAVPAJw9AebKvA4MoLaC1hcgJwAqDAD4wa4AWDeArkelQiUQBkBLAWipcHo2wEwATByA4giACvtBZq15AQDdCQPHBkJngFzrOkQmSLA+6QpwRzgAoNBr0g3AWELrAEq/tKQtO4C5HrClVX0cMDKBJwC6iwQCGBOTQICGN6ewA6RKPpebchyA7VbZqaJnbdDttLEABALQW2Z10QGwOboBUB8DMFOZIBDghGSCkQZIQQBhAUAHws8FSNFMcGncAajVJzkQFg4LIeKmCuB2+dQSfMoeCH0BBGcgxABKPgA0DqAA0BbWnwQYLQDjCwF6Y38PB+iPBUhfCtA5AHQuAI+/zaXRARbLDrNLJthrFgUAsE7MTJBABxVWACQVBgPUOEDHBkiPBxAkQG4ctHIAbAOhDtBZAGypcFD/OUoDjGgq1DZHPwigxwEyBwD7Acn7AagDYaKnOgogRiZ4NUD7H4AJ8G6ToQ5bDAUC/APIUQnKMqBZ2wAAAABJRU5ErkJggg=="

    private static let espressoScript = """
      // Commercial E61 Espresso Machine (Brushed Stainless Steel & Slate)
      const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0xd8e0e8, metalness: 0.92, roughness: 0.14, clearcoat: 0.2 });
      const woodAccentMat = new THREE.MeshPhysicalMaterial({ color: 0x1e293b, metalness: 0.55, roughness: 0.24, clearcoat: 0.4 });
      const brassOrChromeMat = new THREE.MeshPhysicalMaterial({ color: 0xe2e8f0, metalness: 0.95, roughness: 0.09, clearcoat: 0.2 });
      const mirrorChromeMat = new THREE.MeshPhysicalMaterial({ color: 0xf1f5f9, metalness: 0.96, roughness: 0.07, clearcoat: 0.25 });
      const darkSteelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.8, roughness: 0.28 });
      const ceramicMat = new THREE.MeshPhysicalMaterial({ color: 0xf8fafc, metalness: 0.02, roughness: 0.10, clearcoat: 0.95, clearcoatRoughness: 0.05 });
      const cremaMat = new THREE.MeshPhysicalMaterial({ color: 0xc27129, roughness: 0.18, metalness: 0.04, clearcoat: 0.6 });

      const machine = new THREE.Group();
      scene.add(machine);

      // Barista Counter Pedestal Base
      const pedestal = new THREE.Mesh(
        new THREE.CylinderGeometry(1.05, 1.12, 0.08, 48),
        new THREE.MeshPhysicalMaterial({ color: 0x1a202c, metalness: 0.35, roughness: 0.28, clearcoat: 0.35 })
      );
      pedestal.name = "BaristaCounterBase";
      pedestal.position.set(0, -0.56, 0.08);
      machine.add(pedestal);

      const pedestalRim = new THREE.Mesh(new THREE.TorusGeometry(1.06, 0.014, 12, 48), brassOrChromeMat);
      pedestalRim.rotation.x = Math.PI / 2;
      pedestalRim.position.set(0, -0.525, 0.08);
      machine.add(pedestalRim);

      // Main Lower Body with Curved Cylindrical Flanks & Side Cheeks
      const centerBody = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.82, 0.56), bodyMat);
      centerBody.name = "EspressoMainChassis";
      centerBody.position.set(0, -0.06, -0.08);
      machine.add(centerBody);

      for (const side of [-1, 1]) {
        const cornerCol = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.82, 32), bodyMat);
        cornerCol.position.set(side * 0.30, -0.06, -0.08);
        machine.add(cornerCol);

        const cheekGeo = new THREE.CylinderGeometry(0.292, 0.292, 0.68, 32, 1, false, side > 0 ? 0.22 : Math.PI + 0.22, Math.PI - 0.44);
        const cheek = new THREE.Mesh(cheekGeo, woodAccentMat);
        cheek.name = side > 0 ? "RightSideAccentCheek" : "LeftSideAccentCheek";
        cheek.position.set(side * 0.30, -0.05, -0.08);
        machine.add(cheek);

        for (const ty of [-0.39, 0.29]) {
          const trimArc = new THREE.Mesh(
            new THREE.CylinderGeometry(0.296, 0.296, 0.018, 32, 1, false, side > 0 ? 0.20 : Math.PI + 0.20, Math.PI - 0.40),
            brassOrChromeMat
          );
          trimArc.position.set(side * 0.30, ty, -0.08);
          machine.add(trimArc);
        }

        for (const fz of [-0.24, 0.24]) {
          const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.042, 0.06, 20), brassOrChromeMat);
          foot.position.set(side * 0.36, -0.49, fz);
          machine.add(foot);
        }
      }

      // Seamless Stadium-Capsule Cantilevered Upper Brew Hood
      const hoodCenter = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.2204, 0.78), bodyMat);
      hoodCenter.name = "UpperBrewHood";
      hoodCenter.position.set(0, 0.36, 0.03);
      const hoodSideBridge = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.2202, 0.22), bodyMat);
      hoodSideBridge.position.set(0, 0.36, 0.03);
      machine.add(hoodCenter, hoodSideBridge);

      for (const side of [-1, 1]) {
        const hoodSide = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.22, 32), bodyMat);
        hoodSide.position.set(side * 0.30, 0.36, 0.14);
        const hoodBack = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.22, 32), bodyMat);
        hoodBack.position.set(side * 0.30, 0.36, -0.08);
        machine.add(hoodSide, hoodBack);
      }

      // Polished Metallic Belt Molding under Upper Hood
      const beltBar = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.024, 0.792), brassOrChromeMat);
      beltBar.position.set(0, 0.245, 0.03);
      const beltBridge = new THREE.Mesh(new THREE.BoxGeometry(1.172, 0.024, 0.22), brassOrChromeMat);
      beltBridge.position.set(0, 0.245, 0.03);
      machine.add(beltBar, beltBridge);
      for (const side of [-1, 1]) {
        const beltCapF = new THREE.Mesh(new THREE.CylinderGeometry(0.286, 0.286, 0.024, 32), brassOrChromeMat);
        beltCapF.position.set(side * 0.30, 0.245, 0.14);
        const beltCapB = new THREE.Mesh(new THREE.CylinderGeometry(0.286, 0.286, 0.024, 32), brassOrChromeMat);
        beltCapB.position.set(side * 0.30, 0.245, -0.08);
        machine.add(beltCapF, beltCapB);
      }

      // Mirror-Chrome Recessed Backsplash & Central Precision Pressure Gauge
      const backSplash = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.56, 0.04), mirrorChromeMat);
      backSplash.position.set(0, -0.05, 0.21);
      machine.add(backSplash);

      const gaugeBezel = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.010, 16, 32), brassOrChromeMat);
      gaugeBezel.position.set(0, 0.36, 0.425);
      const gaugeDial = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.064, 0.016, 24), darkSteelMat);
      gaugeDial.name = "BoilerPressureGauge";
      gaugeDial.rotation.x = Math.PI / 2;
      gaugeDial.position.set(0, 0.36, 0.42);
      const gaugeCap = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 16), brassOrChromeMat);
      gaugeCap.position.set(0, 0.36, 0.432);
      machine.add(gaugeBezel, gaugeDial, gaugeCap);

      // Two Turned Steam & Water Knobs
      for (const side of [-1, 1]) {
        const kx = side * 0.34;
        const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 0.024, 20), brassOrChromeMat);
        mount.rotation.x = Math.PI / 2;
        mount.position.set(kx, 0.36, 0.425);
        const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.036, 0.042, 24), woodAccentMat);
        knob.rotation.x = Math.PI / 2;
        knob.position.set(kx, 0.36, 0.45);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.046, 20), brassOrChromeMat);
        cap.rotation.x = Math.PI / 2;
        cap.position.set(kx, 0.36, 0.452);
        machine.add(mount, knob, cap);
      }

      // Forward Brushed-Steel Drip Tray with Top Grate
      const trayCenter = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.1404, 0.36), mirrorChromeMat);
      trayCenter.name = "DripTray";
      trayCenter.position.set(0, -0.41, 0.36);
      machine.add(trayCenter);
      for (const side of [-1, 1]) {
        const trayCorner = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.14, 28), mirrorChromeMat);
        trayCorner.position.set(side * 0.30, -0.41, 0.36);
        const trayTrim = new THREE.Mesh(new THREE.CylinderGeometry(0.184, 0.184, 0.022, 28), brassOrChromeMat);
        trayTrim.position.set(side * 0.30, -0.46, 0.36);
        machine.add(trayCorner, trayTrim);
      }
      const trayFrontTrim = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.0222, 0.368), brassOrChromeMat);
      trayFrontTrim.position.set(0, -0.46, 0.36);
      machine.add(trayFrontTrim);

      for (let i = -4; i <= 4; i++) {
        const slot = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.012, 0.22), darkSteelMat);
        slot.position.set(i * 0.068, -0.338, 0.36);
        machine.add(slot);
      }

      // Saturated E61 Group Head & Turned Brew Paddle
      const groupUpper = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.15, 0.12, 32), mirrorChromeMat);
      groupUpper.name = "E61BrewGroupHead";
      groupUpper.position.set(0, 0.17, 0.32);
      const groupRing = new THREE.Mesh(new THREE.TorusGeometry(0.146, 0.016, 14, 32), brassOrChromeMat);
      groupRing.rotation.x = Math.PI / 2;
      groupRing.position.set(0, 0.11, 0.32);
      const groupLower = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.115, 0.07, 32), darkSteelMat);
      groupLower.position.set(0, 0.07, 0.32);
      machine.add(groupUpper, groupRing, groupLower);

      const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.04, 24), brassOrChromeMat);
      turret.position.set(0, 0.49, 0.30);
      const paddleShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 16), mirrorChromeMat);
      paddleShaft.rotation.x = Math.PI / 2.2;
      paddleShaft.rotation.z = -0.38;
      paddleShaft.position.set(0.03, 0.51, 0.36);
      const paddleGrip = new THREE.Mesh(new THREE.SphereGeometry(0.034, 24, 24), woodAccentMat);
      paddleGrip.position.set(0.06, 0.52, 0.42);
      machine.add(turret, paddleShaft, paddleGrip);

      // Locked-In Portafilter with Ergonomic Turned Handle & Dual Spouts
      const pfGroup = new THREE.Group();
      pfGroup.position.set(0, 0.03, 0.32);
      pfGroup.rotation.y = 0.32;
      const pfCup = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.098, 0.075, 28), mirrorChromeMat);
      const pfCollar = new THREE.Mesh(new THREE.TorusGeometry(0.116, 0.012, 12, 28), brassOrChromeMat);
      pfCollar.rotation.x = Math.PI / 2;
      pfCollar.position.y = 0.025;
      for (const sx of [-0.032, 0.032]) {
        const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.009, 0.045, 16), brassOrChromeMat);
        spout.position.set(sx, -0.05, 0);
        pfGroup.add(spout);
      }
      const pfFerrule = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.09, 20), brassOrChromeMat);
      pfFerrule.rotation.x = Math.PI / 2 + 0.14;
      pfFerrule.position.set(0, 0.0, 0.14);
      const pfHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.038, 0.28, 24), woodAccentMat);
      pfHandle.name = "PortafilterHandle";
      pfHandle.rotation.x = Math.PI / 2 + 0.14;
      pfHandle.position.set(0, -0.025, 0.31);
      const pfPommel = new THREE.Mesh(new THREE.SphereGeometry(0.038, 24, 24), brassOrChromeMat);
      pfPommel.position.set(0, -0.045, 0.45);
      pfGroup.add(pfCup, pfCollar, pfFerrule, pfHandle, pfPommel);
      machine.add(pfGroup);

      // Articulated Steam Wand (Left) & Hot Water Spout (Right)
      const steamJoint = new THREE.Mesh(new THREE.SphereGeometry(0.030, 20, 20), brassOrChromeMat);
      steamJoint.position.set(-0.28, 0.18, 0.25);
      const steamPipe1 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 16), mirrorChromeMat);
      steamPipe1.position.set(-0.30, 0.08, 0.28);
      steamPipe1.rotation.z = 0.18;
      steamPipe1.rotation.x = -0.20;
      const steamPipe2 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.010, 0.24, 16), mirrorChromeMat);
      steamPipe2.position.set(-0.29, -0.12, 0.32);
      steamPipe2.rotation.z = -0.14;
      const steamTip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.012, 0.035, 16), brassOrChromeMat);
      steamTip.position.set(-0.275, -0.23, 0.32);
      machine.add(steamJoint, steamPipe1, steamPipe2, steamTip);

      const waterJoint = new THREE.Mesh(new THREE.SphereGeometry(0.028, 20, 20), brassOrChromeMat);
      waterJoint.position.set(0.28, 0.18, 0.25);
      const waterPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.22, 16), mirrorChromeMat);
      waterPipe.position.set(0.29, 0.07, 0.28);
      waterPipe.rotation.z = -0.10;
      machine.add(waterJoint, waterPipe);

      // Top Cup-Warmer Rail
      const railArc = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.012, 12, 36, Math.PI * 1.15), brassOrChromeMat);
      railArc.rotation.x = Math.PI / 2;
      railArc.rotation.z = Math.PI * 0.925;
      railArc.position.set(0, 0.51, -0.02);
      machine.add(railArc);

      // Porcelain Demitasse Cup & Saucer with Golden Crema
      const cupGroup = new THREE.Group();
      cupGroup.position.set(0, -0.34, 0.32);
      const saucer = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.095, 0.020, 28), ceramicMat);
      saucer.position.y = 0.010;
      const cupLower = new THREE.Mesh(new THREE.CylinderGeometry(0.084, 0.058, 0.130, 28), ceramicMat);
      cupLower.name = "DemitasseCup";
      cupLower.position.y = 0.080;
      const cupRim = new THREE.Mesh(new THREE.TorusGeometry(0.081, 0.007, 12, 28), ceramicMat);
      cupRim.rotation.x = Math.PI / 2;
      cupRim.position.y = 0.146;
      const cupHandle = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.010, 12, 20), ceramicMat);
      cupHandle.position.set(-0.088, 0.085, 0);
      const crema = new THREE.Mesh(new THREE.CylinderGeometry(0.077, 0.077, 0.010, 24), cremaMat);
      crema.position.y = 0.145;
      for (const sx of [-0.028, 0.028]) {
        const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.004, 0.16, 12), cremaMat);
        stream.position.set(sx, 0.22, 0);
        cupGroup.add(stream);
      }
      cupGroup.add(saucer, cupLower, cupRim, cupHandle, crema);
      machine.add(cupGroup);
      """

    private static let livingRoomScript = """
      // Fluted Ceramic & Brushed Brass Table Lamp in 3D Living Room
      const amb = new THREE.AmbientLight(0xfff9f2, 0.28);
      const dir = new THREE.DirectionalLight(0xfffaf0, 0.86);
      dir.position.set(0.5, 1.0, 0.8);
      const bulb = new THREE.PointLight(0xffb454, 0.78, 2.4);
      bulb.position.set(0.02, 0.28, 0.14);
      scene.add(amb, dir, bulb);

      const lamp = new THREE.Group();
      lamp.position.set(0.02, 0.0, 0.12);

      const ceramicMat = new THREE.MeshPhysicalMaterial({
        color: 0xf4efe6,
        roughness: 0.20,
        metalness: 0.04,
        clearcoat: 0.65,
        clearcoatRoughness: 0.10
      });
      const brassMat = new THREE.MeshPhysicalMaterial({
        color: 0xd4af37,
        metalness: 0.95,
        roughness: 0.11,
        clearcoat: 0.35
      });

      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.092, 0.098, 0.018, 48), brassMat);
      plinth.name = "BrassPlinthBase";
      plinth.position.y = 0.009;
      const plinthStep = new THREE.Mesh(new THREE.CylinderGeometry(0.080, 0.086, 0.014, 48), brassMat);
      plinthStep.position.y = 0.024;

      const bodyCore = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.074, 0.185, 48), ceramicMat);
      bodyCore.name = "FlutedCeramicBody";
      bodyCore.position.y = 0.12;
      for (let i = 0; i < 20; i++) {
        const ang = (i / 20) * Math.PI * 2;
        const flute = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0095, 0.180, 12), ceramicMat);
        flute.position.set(Math.cos(ang) * 0.065, 0.12, Math.sin(ang) * 0.065);
        lamp.add(flute);
      }

      const upperCapRing = new THREE.Mesh(new THREE.CylinderGeometry(0.070, 0.073, 0.012, 48), brassMat);
      upperCapRing.position.y = 0.212;
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.068, 0.026, 48), brassMat);
      collar.position.y = 0.228;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.11, 32), brassMat);
      stem.position.y = 0.285;

      const shadeGeo = new THREE.SphereGeometry(0.188, 64, 32, 0, Math.PI * 2, 0, Math.PI * 0.57);
      const shadeMat = new THREE.MeshPhysicalMaterial({
        color: 0xfff8eb,
        emissive: 0xffb85c,
        emissiveIntensity: 0.48,
        roughness: 0.14,
        metalness: 0.02,
        transmission: 0.45,
        clearcoat: 0.90,
        clearcoatRoughness: 0.06
      });
      const shade = new THREE.Mesh(shadeGeo, shadeMat);
      shade.name = "WarmGlassDomeShade";
      shade.scale.set(1.0, 0.70, 1.0);
      shade.position.y = 0.295;

      const underGlow = new THREE.Mesh(
        new THREE.SphereGeometry(0.072, 32, 20),
        new THREE.MeshStandardMaterial({ color: 0xfffbeb, emissive: 0xffaa33, emissiveIntensity: 1.75, roughness: 0.1 })
      );
      underGlow.name = "WarmFilamentBulb";
      underGlow.position.y = 0.305;

      const finialWasher = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.008, 32), brassMat);
      finialWasher.position.y = 0.425;
      const finial = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.022, 0.022, 32), brassMat);
      finial.name = "BrassTopFinial";
      finial.position.y = 0.438;

      lamp.add(plinth, plinthStep, bodyCore, upperCapRing, collar, stem, shade, underGlow, finialWasher, finial);
      scene.add(lamp);
      """

    private static let cadGearsScript = """
      // CNC-Machined Planetary Gearbox (CSG Billet Carrier + 16-Tooth Involute Gears + Instanced Bolts)
      const WITH_SUN = true;

      const gunmetalMat = new THREE.MeshPhysicalMaterial({
        color: 0x3b495e,
        metalness: 0.88,
        roughness: 0.22,
        clearcoat: 0.25
      });
      const machinedSteelMat = new THREE.MeshPhysicalMaterial({
        color: 0xe2e8f0,
        metalness: 0.95,
        roughness: 0.12,
        clearcoat: 0.3
      });
      const darkAlloyMat = new THREE.MeshPhysicalMaterial({
        color: 0x1e293b,
        metalness: 0.90,
        roughness: 0.22
      });
      const bronzeBushingMat = new THREE.MeshPhysicalMaterial({
        color: 0xd97706,
        metalness: 0.92,
        roughness: 0.15
      });
      const tinGoldMat = new THREE.MeshPhysicalMaterial({
        color: 0xf59e0b,
        metalness: 0.96,
        roughness: 0.10,
        clearcoat: 0.45,
        clearcoatRoughness: 0.08
      });

      function createMachinedGear(teeth, outerR, innerR, pitchR, boreR, thickness, mat, bossMat, markerMat, namePrefix) {
        const group = new THREE.Group();
        group.name = namePrefix;
        const shape = new THREE.Shape();
        const step = (Math.PI * 2) / teeth;
        for (let i = 0; i < teeth; i++) {
          const a = i * step;
          const a0 = a;
          const a1 = a + step * 0.16;
          const a2 = a + step * 0.26;
          const a3 = a + step * 0.46;
          const a4 = a + step * 0.56;
          const a5 = a + step * 0.84;
          if (i === 0) shape.moveTo(Math.cos(a0) * innerR, Math.sin(a0) * innerR);
          else shape.lineTo(Math.cos(a0) * innerR, Math.sin(a0) * innerR);
          shape.lineTo(Math.cos(a1) * pitchR, Math.sin(a1) * pitchR);
          shape.lineTo(Math.cos(a2) * outerR, Math.sin(a2) * outerR);
          shape.lineTo(Math.cos(a3) * outerR, Math.sin(a3) * outerR);
          shape.lineTo(Math.cos(a4) * pitchR, Math.sin(a4) * pitchR);
          shape.lineTo(Math.cos(a5) * innerR, Math.sin(a5) * innerR);
        }
        shape.closePath();

        const bore = new THREE.Path();
        bore.absarc(0, 0, boreR, 0, Math.PI * 2, true);
        shape.holes.push(bore);

        const holeRingR = (innerR + boreR) * 0.53;
        const holeR = (innerR - boreR) * 0.22;
        for (let h = 0; h < 6; h++) {
          const ha = (h / 6) * Math.PI * 2;
          const hp = new THREE.Path();
          hp.absarc(Math.cos(ha) * holeRingR, Math.sin(ha) * holeRingR, holeR, 0, Math.PI * 2, true);
          shape.holes.push(hp);
        }

        const gearMesh = new THREE.Mesh(
          new THREE.ExtrudeGeometry(shape, {
            depth: thickness,
            bevelEnabled: true,
            bevelThickness: 0.018,
            bevelSize: 0.014,
            bevelSegments: 1,
            curveSegments: 8
          }),
          mat
        );
        gearMesh.name = namePrefix + "_Rim";
        gearMesh.rotation.x = -Math.PI / 2;
        gearMesh.position.y = -thickness / 2;
        group.add(gearMesh);

        const hubBoss = new THREE.Mesh(
          new THREE.CylinderGeometry(boreR * 1.42, boreR * 1.48, thickness + 0.08, 24),
          bossMat
        );
        const bushing = new THREE.Mesh(
          new THREE.CylinderGeometry(boreR * 1.18, boreR * 1.18, thickness + 0.10, 24),
          bronzeBushingMat
        );
        const timingBar = new THREE.Mesh(
          new THREE.BoxGeometry(innerR * 1.55, 0.032, 0.055),
          markerMat
        );
        timingBar.position.y = thickness / 2 + 0.025;
        group.add(hubBoss, bushing, timingBar);

        return group;
      }

      const baseProfile = new THREE.Shape();
      baseProfile.absarc(0, 0, 1.88, 0, Math.PI * 2, false);
      const centerHole = new THREE.Path();
      centerHole.absarc(0, 0, 0.34, 0, Math.PI * 2, true);
      baseProfile.holes.push(centerHole);

      const rawCarrier = new THREE.Mesh(
        new THREE.ExtrudeGeometry(baseProfile, {
          depth: 0.28,
          bevelEnabled: true,
          bevelThickness: 0.03,
          bevelSize: 0.025,
          bevelSegments: 1,
          curveSegments: 28
        }),
        gunmetalMat
      );
      rawCarrier.rotation.x = -Math.PI / 2;
      rawCarrier.position.set(0, -0.34, 0);

      const ch1 = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.16, 0.28), gunmetalMat);
      ch1.position.set(0, -0.08, 0);
      const ch2 = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 3.9), gunmetalMat);
      ch2.position.set(0, -0.08, 0);
      const step1 = THREE.CSG.subtract(rawCarrier, ch1);
      const carrier = THREE.CSG.subtract(step1, ch2);
      carrier.name = "CNCBilletCarrierHousing";
      scene.add(carrier);

      const outerRim = new THREE.Mesh(new THREE.TorusGeometry(1.74, 0.045, 14, 48), darkAlloyMat);
      outerRim.rotation.x = Math.PI / 2;
      outerRim.position.y = -0.04;
      scene.add(outerRim);

      const boltCount = 12;
      const bolts = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.055, 0.055, 0.12, 12),
        machinedSteelMat,
        boltCount
      );
      bolts.name = "InstancedSocketBolts";
      const m4 = new THREE.Matrix4();
      const bPos = new THREE.Vector3();
      const bQuat = new THREE.Quaternion();
      const bScl = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < boltCount; i++) {
        const a = (i / boltCount) * Math.PI * 2 + Math.PI / 12;
        bPos.set(Math.cos(a) * 1.74, -0.01, Math.sin(a) * 1.74);
        m4.compose(bPos, bQuat, bScl);
        bolts.setMatrixAt(i, m4);
      }
      scene.add(bolts);

      const orbitR = 1.12;
      const planets = [];
      for (let i = 0; i < 3; i++) {
        const orbitAngle = (i / 3) * Math.PI * 2 + Math.PI / 6;
        const px = Math.cos(orbitAngle) * orbitR;
        const pz = Math.sin(orbitAngle) * orbitR;

        const planet = createMachinedGear(16, 0.62, 0.47, 0.55, 0.16, 0.22, machinedSteelMat, darkAlloyMat, bronzeBushingMat, "PlanetGear_" + (i + 1));
        planet.position.set(px, 0.10, pz);
        const baseRotY = -orbitAngle + Math.PI / 16;
        planet.rotation.y = baseRotY;
        scene.add(planet);
        planets.push({ group: planet, baseRotY });

        const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.48, 20), darkAlloyMat);
        pin.position.set(px, 0.06, pz);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 6), machinedSteelMat);
        cap.position.set(px, 0.31, pz);
        scene.add(pin, cap);
      }

      let sunGear = null;
      let keywayBar = null;
      if (!WITH_SUN) {
        const emptySleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.26, 28), darkAlloyMat);
        emptySleeve.name = "UnloadedCentralBore";
        emptySleeve.position.set(0, -0.18, 0);
        scene.add(emptySleeve);
      } else {
        sunGear = createMachinedGear(16, 0.62, 0.47, 0.55, 0.18, 0.26, tinGoldMat, darkAlloyMat, machinedSteelMat, "SunGear_TiN");
        sunGear.position.set(0, 0.10, 0);
        scene.add(sunGear);

        const driveShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.62, 24), machinedSteelMat);
        driveShaft.position.set(0, 0.10, 0);
        keywayBar = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.045, 0.065), tinGoldMat);
        keywayBar.position.set(0, 0.41, 0);
        scene.add(driveShaft, keywayBar);
      }

      function animate(t) {
        const angle = (t / 4.0) * Math.PI * 2;
        if (sunGear) sunGear.rotation.y = angle;
        if (keywayBar) keywayBar.rotation.y = angle;
        for (const p of planets) {
          p.group.rotation.y = p.baseRotY - angle;
        }
      }
      """

    private static let holoTslScript = """
      // Loop-Free TSL Node Materials (WebGL2 + WebGPU + USDZ MaterialX + Android Filamat)
      const TSL = THREE.TSL;
      const uScanSpeed = TSL.uniform(4.5, "uScanSpeed");
      const uShieldColor = TSL.uniform(new THREE.Color(0x38bdf8), "uShieldColor");

      // 1. Procedural Voronoi + Triplanar Alloy Core (0 bitmap textures!)
      const cell = TSL.voronoi2D(TSL.uv.mul(7.0), 0.85);
      const grain = TSL.triplanar(3.5, 4.0);
      const coreMat = new THREE.MeshStandardNodeMaterial({ name: "VoronoiAlloyMat", metalness: 0.9 });
      coreMat.colorNode = TSL.mix(TSL.color(0x1e293b), TSL.color(0xe2e8f0), cell.mul(0.75).add(grain.mul(0.25)));
      coreMat.roughnessNode = TSL.remap(cell, 0.0, 1.0, 0.12, 0.52);
      coreMat.bumpNode = TSL.bumpFromHeight(cell, 0.35);

      const core = new THREE.Mesh(new THREE.TorusKnotGeometry(0.62, 0.2, 96, 24), coreMat);
      core.name = "VoronoiCore";
      core.castShadow = true;
      scene.add(core);

      // 2. Animated Fresnel + Scanline Holographic Energy Shield with Vertex Ripple
      const rim = TSL.fresnel(2.2);
      const scan = TSL.sin(TSL.positionWorld.y.mul(22.0).sub(TSL.time.mul(uScanSpeed))).mul(0.5).add(0.5);
      const ripple = TSL.sin(TSL.positionLocal.y.mul(6.0).add(TSL.time.mul(2.5))).mul(0.035);
      const shieldMat = new THREE.MeshStandardNodeMaterial({
        name: "HoloShieldMat",
        roughness: 0.1,
        metalness: 0.1
      });
      shieldMat.colorNode = uShieldColor;
      shieldMat.emissiveNode = TSL.hueShift(uShieldColor, TSL.time.mul(0.35)).mul(rim.mul(1.6).add(scan.mul(0.55)));
      shieldMat.opacityNode = rim.mul(0.72).add(scan.mul(0.18)).clamp(0.08, 0.88);
      shieldMat.positionNode = TSL.positionLocal.add(TSL.normalLocal.mul(ripple));

      const shield = new THREE.Mesh(new THREE.SphereGeometry(1.22, 48, 32), shieldMat);
      shield.name = "HoloEnergyShield";
      scene.add(shield);

      // 3. Shadow-Receiving Carbon Base Pedestal
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(1.55, 1.7, 0.22, 36),
        new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.65, roughness: 0.35 })
      );
      base.name = "ShieldPedestal";
      base.position.set(0, -1.42, 0);
      base.receiveShadow = true;
      scene.add(base);

      const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
      keyLight.position.set(3, 5, 4);
      keyLight.castShadow = true;
      scene.add(keyLight);
      """

    private static let instancedLatticeScript = """
      // Hardware GPU Instanced Crystal Lattice (125 instances in 1 draw call)
      const grid = 5;
      const total = grid * grid * grid;
      const instanced = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.0, 0.13, 0.34, 6),
        new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.85, roughness: 0.15 }),
        total
      );
      instanced.name = "InstancedCrystalLattice";

      const m4 = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3(1, 1, 1);
      const col = new THREE.Color();
      let idx = 0;
      for (let x = 0; x < grid; x++) {
        for (let y = 0; y < grid; y++) {
          for (let z = 0; z < grid; z++) {
            // Leave center hollow for the glowing energy core
            if (x >= 1 && x <= 3 && y >= 1 && y <= 3 && z >= 1 && z <= 3) {
              scl.set(0.001, 0.001, 0.001);
            } else {
              scl.set(1, 1, 1);
            }
            pos.set((x - 2) * 0.55, (y - 2) * 0.55, (z - 2) * 0.55);
            m4.compose(pos, quat, scl);
            instanced.setMatrixAt(idx, m4);
            col.setRGB(0.2 + (x / grid) * 0.75, 0.35 + (y / grid) * 0.6, 0.95 - (z / grid) * 0.5);
            instanced.setColorAt(idx, col);
            idx++;
          }
        }
      }
      scene.add(instanced);

      // Glowing HDR Emissive Core
      const core = new THREE.Mesh(
        new THREE.TorusKnotGeometry(0.38, 0.11, 96, 20),
        new THREE.MeshStandardMaterial({
          color: 0x38bdf8,
          emissive: 0x0284c7,
          emissiveIntensity: 0.85,
          metalness: 0.9,
          roughness: 0.1
        })
      );
      core.name = "LatticeEnergyCore";
      core.userData.interactivity = {
        onSelect: { action: "toggleTransform", scale: [1.25, 1.25, 1.25], duration: 0.35 }
      };
      scene.add(core);
      """

    private static let pagodaScript = """
      // Traditional Five-Story Timber Japanese Pagoda (3.2m tall) on Stone Platform (y = 0)
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
      ambientLight.name = "ambient_light";
      scene.add(ambientLight);

      const sunLight = new THREE.DirectionalLight(0xfff4dc, 1.4);
      sunLight.name = "sun_directional_light";
      sunLight.position.set(3.8, 5.5, 4.2);
      scene.add(sunLight);

      const fillLight = new THREE.DirectionalLight(0xcfe2ff, 0.6);
      fillLight.name = "fill_directional_light";
      fillLight.position.set(-3.2, 2.8, -2.8);
      scene.add(fillLight);

      const pagodaGroup = new THREE.Group();
      pagodaGroup.name = "five_story_japanese_pagoda";
      scene.add(pagodaGroup);

      // Materials
      const stoneFoundationMat = new THREE.MeshStandardMaterial({
        color: 0x9c9992,
        metalness: 0.06,
        roughness: 0.78
      });

      const vermilionTimberMat = new THREE.MeshStandardMaterial({
        color: 0xb8291e,
        metalness: 0.1,
        roughness: 0.42
      });

      const whitePlasterMat = new THREE.MeshStandardMaterial({
        color: 0xf4EFE6,
        metalness: 0.04,
        roughness: 0.65
      });

      const darkTileRoofMat = new THREE.MeshStandardMaterial({
        color: 0x2b3036,
        metalness: 0.35,
        roughness: 0.48
      });

      const bronzeSorinMat = new THREE.MeshStandardMaterial({
        color: 0x9e7d3b,
        metalness: 0.88,
        roughness: 0.25
      });

      // 1. Stone Foundation Platform (Kidan) on y = 0 with Front Stone Steps
      const foundationLower = new THREE.Mesh(
        new THREE.BoxGeometry(1.52, 0.14, 1.52),
        stoneFoundationMat
      );
      foundationLower.name = "stone_foundation_lower_plinth";
      foundationLower.position.set(0, 0.07, 0);
      pagodaGroup.add(foundationLower);

      const foundationUpper = new THREE.Mesh(
        new THREE.BoxGeometry(1.36, 0.14, 1.36),
        stoneFoundationMat
      );
      foundationUpper.name = "stone_foundation_upper_deck";
      foundationUpper.position.set(0, 0.21, 0);
      pagodaGroup.add(foundationUpper);

      // Front entry staircase on +Z face
      for (let st = 0; st < 4; st++) {
        const stepBlock = new THREE.Mesh(
          new THREE.BoxGeometry(0.42, 0.065, 0.24 - st * 0.045),
          stoneFoundationMat
        );
        stepBlock.name = `foundation_entry_step_${st + 1}`;
        stepBlock.position.set(0, 0.0325 + st * 0.065, 0.76 + (3 - st) * 0.03);
        pagodaGroup.add(stepBlock);
      }

      // Central heart pillar (Shinbashira) running through the entire pagoda
      const shinbashira = new THREE.Mesh(
        new THREE.CylinderGeometry(0.065, 0.095, 2.45, 16),
        vermilionTimberMat
      );
      shinbashira.name = "central_shinbashira_pillar";
      shinbashira.position.set(0, 1.5, 0);
      pagodaGroup.add(shinbashira);

      // 2. Five Stacked Timber Tiers with Sweeping Upturned Eaves, Corner Rafters & Red Perimeter Railings
      const baseTierY = 0.28;
      const tierHeight = 0.44;

      for (let t = 0; t < 5; t++) {
        const scaleFactor = 1.0 - t * 0.11; // Progressive architectural taper from tier 1 to 5
        const coreWidth = 0.78 * scaleFactor;
        const roofWidth = 1.28 * scaleFactor;
        const yBottom = baseTierY + t * tierHeight;

        const tierGroup = new THREE.Group();
        tierGroup.name = `pagoda_story_tier_${t + 1}`;
        tierGroup.position.set(0, yBottom, 0);
        pagodaGroup.add(tierGroup);

        // White plaster & timber core walls
        const wallBox = new THREE.Mesh(
          new THREE.BoxGeometry(coreWidth, 0.28, coreWidth),
          whitePlasterMat
        );
        wallBox.name = `tier_${t + 1}_plaster_wall_core`;
        wallBox.position.set(0, 0.14, 0);
        tierGroup.add(wallBox);

        // Four corner vermilion timber columns
        const colOffset = coreWidth * 0.49;
        for (const cx of [-colOffset, colOffset]) {
          for (const cz of [-colOffset, colOffset]) {
            const pillar = new THREE.Mesh(
              new THREE.CylinderGeometry(0.024 * scaleFactor, 0.026 * scaleFactor, 0.3, 12),
              vermilionTimberMat
            );
            pillar.name = `tier_${t + 1}_corner_column_${cx < 0 ? "W" : "E"}${cz < 0 ? "N" : "S"}`;
            pillar.position.set(cx, 0.15, cz);
            tierGroup.add(pillar);
          }
        }

        // Red perimeter balcony deck & railings (Kouran)
        const balconyDeck = new THREE.Mesh(
          new THREE.BoxGeometry(coreWidth * 1.22, 0.028, coreWidth * 1.22),
          vermilionTimberMat
        );
        balconyDeck.name = `tier_${t + 1}_balcony_walkway`;
        balconyDeck.position.set(0, 0.02, 0);
        tierGroup.add(balconyDeck);

        const railDist = coreWidth * 0.58;
        for (let sideIdx = 0; sideIdx < 4; sideIdx++) {
          const railBar = new THREE.Mesh(
            new THREE.BoxGeometry(coreWidth * 1.18, 0.018, 0.018),
            vermilionTimberMat
          );
          railBar.name = `tier_${t + 1}_perimeter_railing_${sideIdx + 1}`;
          const ang = (sideIdx * Math.PI) / 2;
          railBar.position.set(Math.sin(ang) * railDist, 0.068, Math.cos(ang) * railDist);
          railBar.rotation.y = ang;
          tierGroup.add(railBar);
        }

        // Sweeping Pagoda Roof: 4-sided pyramidal ConeGeometry + upturned corner eaves rafters
        const roofConeRadius = roofWidth * 0.72;
        const mainRoofCone = new THREE.Mesh(
          new THREE.ConeGeometry(roofConeRadius, 0.22, 4),
          darkTileRoofMat
        );
        mainRoofCone.name = `tier_${t + 1}_tiled_roof_slope`;
        mainRoofCone.rotation.y = Math.PI / 4;
        mainRoofCone.position.set(0, 0.36, 0);
        tierGroup.add(mainRoofCone);

        const lowerEaveSkirt = new THREE.Mesh(
          new THREE.CylinderGeometry(roofConeRadius * 0.75, roofConeRadius * 1.06, 0.075, 4),
          darkTileRoofMat
        );
        lowerEaveSkirt.name = `tier_${t + 1}_upturned_eave_skirt`;
        lowerEaveSkirt.rotation.y = Math.PI / 4;
        lowerEaveSkirt.position.set(0, 0.26, 0);
        tierGroup.add(lowerEaveSkirt);

        // Four diagonal corner rafters & upturned ridge finials
        for (let c = 0; c < 4; c++) {
          const cornerAng = (c * Math.PI) / 2 + Math.PI / 4;
          const rafterBeam = new THREE.Mesh(
            new THREE.BoxGeometry(0.026 * scaleFactor, 0.024 * scaleFactor, roofConeRadius * 0.98),
            vermilionTimberMat
          );
          rafterBeam.name = `tier_${t + 1}_corner_rafter_${c + 1}`;
          rafterBeam.position.set(
            Math.sin(cornerAng) * (roofConeRadius * 0.46),
            0.245,
            Math.cos(cornerAng) * (roofConeRadius * 0.46)
          );
          rafterBeam.rotation.y = cornerAng;
          rafterBeam.rotation.x = 0.16;
          tierGroup.add(rafterBeam);
        }
      }

      // 3. Tall Bronze Finial Spire (Sorin) with Nine Rings (Kurin) on the Apex (y = 2.48m to y = 3.22m)
      const sorinBaseY = baseTierY + 5 * tierHeight;
      const sorinGroup = new THREE.Group();
      sorinGroup.name = "bronze_sorin_finial_spire";
      sorinGroup.position.set(0, sorinBaseY, 0);
      pagodaGroup.add(sorinGroup);

      const dewBasin = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.05, 0.18),
        bronzeSorinMat
      );
      dewBasin.name = "roban_dew_basin";
      dewBasin.position.set(0, 0.025, 0);
      sorinGroup.add(dewBasin);

      const invertedBowl = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.085, 0.05, 20),
        bronzeSorinMat
      );
      invertedBowl.name = "fukubachi_inverted_bowl";
      invertedBowl.position.set(0, 0.075, 0);
      sorinGroup.add(invertedBowl);

      const spireShaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.016, 0.028, 0.64, 16),
        bronzeSorinMat
      );
      spireShaft.name = "sorin_central_bronze_shaft";
      spireShaft.position.set(0, 0.4, 0);
      sorinGroup.add(spireShaft);

      // Nine sacred bronze rings (Kurin) stacked along the spire
      for (let r = 0; r < 9; r++) {
        const ringRadius = 0.062 - r * 0.0022;
        const kurinRing = new THREE.Mesh(
          new THREE.TorusGeometry(ringRadius, 0.006, 10, 24),
          bronzeSorinMat
        );
        kurinRing.name = `sorin_kurin_ring_${r + 1}`;
        kurinRing.rotation.x = Math.PI / 2;
        kurinRing.position.set(0, 0.14 + r * 0.044, 0);
        sorinGroup.add(kurinRing);
      }

      // Water flame ornament & sacred jewel (Hoju) at the very top (y = 3.2m)
      const sacredJewel = new THREE.Mesh(
        new THREE.ConeGeometry(0.036, 0.09, 16),
        bronzeSorinMat
      );
      sacredJewel.name = "hoju_sacred_apex_jewel";
      sacredJewel.position.set(0, 0.72, 0);
      sorinGroup.add(sacredJewel);

      // Frame camera at ~2.2x bounding radius
      camera.position.set(2.85, 2.15, 3.25);
      camera.lookAt(0, 1.55, 0);
      """

    private static let livingRoomQuantumCoreScript = """
      // AI Edit: Tabletop Quantum Artifact on the Living Room Coffee Table
      const amb = new THREE.AmbientLight(0xe0f2fe, 0.32);
      const dir = new THREE.DirectionalLight(0xf8fafc, 0.85);
      dir.position.set(0.5, 1.0, 0.8);
      const glow = new THREE.PointLight(0x38bdf8, 0.95, 2.4);
      glow.position.set(0.02, 0.26, 0.12);
      scene.add(amb, dir, glow);

      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(0.105, 0.125, 0.024, 36),
        new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.85, roughness: 0.22 })
      );
      base.name = "ArtifactPedestalBase";
      base.position.set(0.02, 0.012, 0.12);
      scene.add(base);

      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.10, 32, 24),
        new THREE.MeshStandardMaterial({
          color: 0x38bdf8,
          emissive: 0x0284c7,
          emissiveIntensity: 0.45,
          metalness: 0.92,
          roughness: 0.08
        })
      );
      core.name = "QuantumCore";
      core.position.set(0.02, 0.26, 0.12);
      scene.add(core);

      const ring1 = new THREE.Mesh(
        new THREE.TorusGeometry(0.16, 0.012, 16, 64),
        new THREE.MeshStandardMaterial({ color: 0xa855f7, metalness: 0.85, roughness: 0.18 })
      );
      ring1.name = "InnerOrbitRing";
      ring1.position.set(0.02, 0.26, 0.12);
      ring1.rotation.x = 1.1;
      scene.add(ring1);

      const ring2 = new THREE.Mesh(
        new THREE.TorusGeometry(0.21, 0.010, 16, 64),
        new THREE.MeshStandardMaterial({ color: 0x10b981, metalness: 0.78, roughness: 0.22 })
      );
      ring2.name = "OuterOrbitRing";
      ring2.position.set(0.02, 0.26, 0.12);
      ring2.rotation.y = 0.9;
      ring2.rotation.z = 0.4;
      scene.add(ring2);

      function animate(t) {
        ring1.rotation.z = (t / 4.0) * Math.PI * 2;
        ring2.rotation.x = -(t / 4.0) * Math.PI * 2;
      }
      """

    private static let instancedDoubleHelixScript = """
      // AI Edit: 125 GPU Instances in a Spiraling Double-Helix around a Golden Core
      const total = 125;
      const instanced = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.0, 0.12, 0.32, 6),
        new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.88, roughness: 0.14 }),
        total
      );
      instanced.name = "InstancedDoubleHelix";

      const m4 = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3(1, 1, 1);
      const col = new THREE.Color();
      for (let i = 0; i < total; i++) {
        const strand = i % 2;
        const t = (i / total) * Math.PI * 4.0 + strand * Math.PI;
        const y = ((i / total) - 0.5) * 2.8;
        const r = 1.18;
        pos.set(Math.cos(t) * r, y, Math.sin(t) * r);
        quat.setFromEuler(new THREE.Euler(0, -t, Math.PI / 2));
        m4.compose(pos, quat, scl);
        instanced.setMatrixAt(i, m4);
        col.setHSL(strand ? 0.54 : 0.11, 0.9, 0.58);
        instanced.setColorAt(i, col);
      }
      scene.add(instanced);

      const core = new THREE.Mesh(
        new THREE.TorusKnotGeometry(0.46, 0.13, 96, 24),
        new THREE.MeshStandardMaterial({
          color: 0xf59e0b,
          emissive: 0xd97706,
          emissiveIntensity: 0.65,
          metalness: 0.94,
          roughness: 0.1
        })
      );
      core.name = "GoldenHelixCore";
      scene.add(core);
      """

    private static let instancedFibonacciSphereScript = """
      // AI Edit: 125 GPU Instances on a Fibonacci Geodesic Sphere Shell
      const total = 125;
      const instanced = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.0, 0.12, 0.34, 6),
        new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.88, roughness: 0.14 }),
        total
      );
      instanced.name = "InstancedFibonacciSphere";

      const m4 = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const up = new THREE.Vector3(0, 1, 0);
      const dir = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3(1, 1, 1);
      const col = new THREE.Color();
      const goldenAngle = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < total; i++) {
        const y = 1 - (i / (total - 1)) * 2;
        const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
        const theta = goldenAngle * i;
        dir.set(Math.cos(theta) * radiusAtY, y, Math.sin(theta) * radiusAtY).normalize();
        pos.copy(dir).multiplyScalar(1.38);
        quat.setFromUnitVectors(up, dir);
        m4.compose(pos, quat, scl);
        instanced.setMatrixAt(i, m4);
        col.setHSL(0.42 + 0.18 * ((y + 1) * 0.5), 0.85, 0.55);
        instanced.setColorAt(i, col);
      }
      scene.add(instanced);

      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.58, 36, 24),
        new THREE.MeshStandardMaterial({
          color: 0x10b981,
          emissive: 0x059669,
          emissiveIntensity: 0.85,
          metalness: 0.9,
          roughness: 0.1
        })
      );
      core.name = "EmeraldGeodesicCore";
      scene.add(core);
      """

    private static let pagodaLanternSuffix = """


      // AI Edit: Warm Glowing Paper Lanterns under all 5 Pagoda Roof Eaves at Dusk
      const lanternGlowLight = new THREE.PointLight(0xffaa44, 1.6, 4.5);
      lanternGlowLight.position.set(0, 1.45, 0.85);
      scene.add(lanternGlowLight);

      const lanternMat = new THREE.MeshStandardMaterial({
        color: 0xfff7ed,
        emissive: 0xff9d2e,
        emissiveIntensity: 2.2,
        roughness: 0.25
      });
      for (let t = 0; t < 5; t++) {
        const scaleFactor = 1.0 - t * 0.11;
        const eaveR = 1.28 * scaleFactor * 0.68;
        const yLantern = 0.28 + t * 0.44 + 0.20;
        for (let c = 0; c < 4; c++) {
          const ang = (c * Math.PI) / 2 + Math.PI / 4;
          const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.036 * scaleFactor, 14, 12), lanternMat);
          lantern.scale.set(0.85, 1.25, 0.85);
          lantern.name = `tier_${t + 1}_eave_lantern_${c + 1}`;
          lantern.position.set(Math.sin(ang) * eaveR, yLantern, Math.cos(ang) * eaveR);
          pagodaGroup.add(lantern);
        }
      }
      """

    public static let threeLivePresets: [ScenePreset] = [
      ScenePreset(
        name: "Espresso",
        description:
          "Commercial E61 espresso machine with brushed steel body, brew group, and crema stream",
        script: espressoScript,
        mode: .threeLive,
        sampleEdits: [
          SampleAiEdit(
            prompt: "Give it a matte obsidian body, polished walnut side accents, and brass trim",
            script:
              espressoScript
              .replacingOccurrences(
                of: "// Commercial E61 Espresso Machine (Brushed Stainless Steel & Slate)",
                with:
                  "// AI Edit: Matte Obsidian Body, Polished Walnut Side Accents & Brass Trim\nconst WALNUT_URL = \"\(walnutGrainPng)\";"
              )
              .replacingOccurrences(
                of:
                  "const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0xd8e0e8, metalness: 0.92, roughness: 0.14, clearcoat: 0.2 });",
                with:
                  "const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0x161920, metalness: 0.48, roughness: 0.19, clearcoat: 0.45, clearcoatRoughness: 0.10 });"
              )
              .replacingOccurrences(
                of:
                  "const woodAccentMat = new THREE.MeshPhysicalMaterial({ color: 0x1e293b, metalness: 0.55, roughness: 0.24, clearcoat: 0.4 });",
                with:
                  "const woodAccentMat = new THREE.MeshPhysicalMaterial({ map: WALNUT_URL, color: 0xffffff, metalness: 0.05, roughness: 0.07, clearcoat: 1.0, clearcoatRoughness: 0.03 });"
              )
              .replacingOccurrences(
                of:
                  "const brassOrChromeMat = new THREE.MeshPhysicalMaterial({ color: 0xe2e8f0, metalness: 0.95, roughness: 0.09, clearcoat: 0.2 });",
                with:
                  "const brassOrChromeMat = new THREE.MeshPhysicalMaterial({ color: 0xd9ad42, metalness: 0.95, roughness: 0.10, clearcoat: 0.35 });"
              )
          ),
          SampleAiEdit(
            prompt: "Switch to a British racing-green body with polished copper trim",
            script:
              espressoScript
              .replacingOccurrences(
                of: "// Commercial E61 Espresso Machine (Brushed Stainless Steel & Slate)",
                with:
                  "// AI Edit: Glossy British Racing-Green Body & Side Cheeks with Polished Copper Trim"
              )
              .replacingOccurrences(
                of:
                  "const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0xd8e0e8, metalness: 0.92, roughness: 0.14, clearcoat: 0.2 });",
                with:
                  "const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0x198754, metalness: 0.16, roughness: 0.14, clearcoat: 0.95, clearcoatRoughness: 0.04 });"
              )
              .replacingOccurrences(
                of:
                  "const woodAccentMat = new THREE.MeshPhysicalMaterial({ color: 0x1e293b, metalness: 0.55, roughness: 0.24, clearcoat: 0.4 });",
                with:
                  "const woodAccentMat = new THREE.MeshPhysicalMaterial({ color: 0x146c43, metalness: 0.16, roughness: 0.15, clearcoat: 0.95, clearcoatRoughness: 0.04 });"
              )
              .replacingOccurrences(
                of:
                  "const brassOrChromeMat = new THREE.MeshPhysicalMaterial({ color: 0xe2e8f0, metalness: 0.95, roughness: 0.09, clearcoat: 0.2 });",
                with:
                  "const brassOrChromeMat = new THREE.MeshPhysicalMaterial({ color: 0xe29760, metalness: 0.94, roughness: 0.10, clearcoat: 0.35 });"
              )
          ),
        ]
      ),
      ScenePreset(
        name: "Living Room",
        description: "Fluted ceramic & brushed brass table lamp with warm glass dome shade",
        script: livingRoomScript,
        mode: .threeLive,
        sampleEdits: [
          SampleAiEdit(
            prompt:
              "Switch to a smoked-glass globe lamp with matte black hardware and cool moonlight",
            script:
              livingRoomScript
              .replacingOccurrences(of: "0xffb454, 0.78, 2.4", with: "0x7dd3fc, 0.95, 2.8")
              .replacingOccurrences(of: "color: 0xf4efe6", with: "color: 0x1e293b")
              .replacingOccurrences(of: "color: 0xd4af37", with: "color: 0x18181b")
              .replacingOccurrences(
                of: "color: 0xfff8eb,\n  emissive: 0xffb85c,\n  emissiveIntensity: 0.48,",
                with: "color: 0xcbd5e1,\n  emissive: 0x38bdf8,\n  emissiveIntensity: 0.42,"
              )
              .replacingOccurrences(
                of: "color: 0xfffbeb, emissive: 0xffaa33, emissiveIntensity: 1.75",
                with: "color: 0xe0f2fe, emissive: 0x38bdf8, emissiveIntensity: 1.85"
              )
          ),
          SampleAiEdit(
            prompt: "Replace the lamp with an orbiting quantum core artifact on the coffee table",
            script: livingRoomQuantumCoreScript
          ),
        ]
      ),
      ScenePreset(
        name: "CAD Gears",
        description:
          "CNC-machined planetary gearbox with CSG billet carrier, 16-tooth involute gears, and instanced bolts",
        script: cadGearsScript,
        mode: .threeLive,
        sampleEdits: [
          SampleAiEdit(
            prompt: "Anodize the CNC carrier cobalt blue with copper-beryllium planet gears",
            script:
              cadGearsScript
              .replacingOccurrences(
                of: "color: 0x3b495e,\n  metalness: 0.88,\n  roughness: 0.22,\n  clearcoat: 0.25",
                with:
                  "color: 0x1d4ed8,\n  metalness: 0.82,\n  roughness: 0.16,\n  clearcoat: 0.55"
              )
              .replacingOccurrences(
                of: "color: 0xe2e8f0,\n  metalness: 0.95,\n  roughness: 0.12,\n  clearcoat: 0.3",
                with:
                  "color: 0xd97742,\n  metalness: 0.95,\n  roughness: 0.11,\n  clearcoat: 0.35"
              )
          ),
          SampleAiEdit(
            prompt: "Remove the central sun gear to inspect the unloaded carrier bore",
            script: cadGearsScript.replacingOccurrences(
              of: "const WITH_SUN = true;",
              with: "const WITH_SUN = false;"
            )
          ),
        ]
      ),
      ScenePreset(
        name: "Holo TSL",
        description:
          "Loop-free TSL node materials with procedural Voronoi alloy core and animated Fresnel energy shield",
        script: holoTslScript,
        mode: .threeLive,
        sampleEdits: [
          SampleAiEdit(
            prompt: "Shift the holographic shield to plasma emerald and double the scanline speed",
            script:
              holoTslScript
              .replacingOccurrences(
                of: "const uScanSpeed = TSL.uniform(4.5, \"uScanSpeed\");",
                with: "const uScanSpeed = TSL.uniform(9.0, \"uScanSpeed\");"
              )
              .replacingOccurrences(
                of:
                  "const uShieldColor = TSL.uniform(new THREE.Color(0x38bdf8), \"uShieldColor\");",
                with:
                  "const uShieldColor = TSL.uniform(new THREE.Color(0x10b981), \"uShieldColor\");"
              )
              .replacingOccurrences(
                of: "TSL.hueShift(uShieldColor, TSL.time.mul(0.35))",
                with: "uShieldColor"
              )
          ),
          SampleAiEdit(
            prompt:
              "Overcharge the shield with crimson Fresnel pulses and stronger vertex ripple",
            script:
              holoTslScript
              .replacingOccurrences(
                of: "const uScanSpeed = TSL.uniform(4.5, \"uScanSpeed\");",
                with: "const uScanSpeed = TSL.uniform(7.5, \"uScanSpeed\");"
              )
              .replacingOccurrences(
                of:
                  "const uShieldColor = TSL.uniform(new THREE.Color(0x38bdf8), \"uShieldColor\");",
                with:
                  "const uShieldColor = TSL.uniform(new THREE.Color(0xf43f5e), \"uShieldColor\");"
              )
              .replacingOccurrences(of: "TSL.color(0xe2e8f0)", with: "TSL.color(0xf59e0b)")
              .replacingOccurrences(of: ".mul(0.035)", with: ".mul(0.075)")
              .replacingOccurrences(
                of: "TSL.hueShift(uShieldColor, TSL.time.mul(0.35))",
                with: "uShieldColor"
              )
          ),
        ]
      ),
      ScenePreset(
        name: "Instanced Lattice",
        description:
          "125-instance hardware GPU crystal lattice (EXT_mesh_gpu_instancing / PointInstancer) around a glowing core",
        script: instancedLatticeScript,
        mode: .threeLive,
        sampleEdits: [
          SampleAiEdit(
            prompt:
              "Rearrange the 125 instances into a spiraling double-helix around a golden core",
            script: instancedDoubleHelixScript
          ),
          SampleAiEdit(
            prompt: "Form a geodesic Fibonacci sphere shell around an emerald energy core",
            script: instancedFibonacciSphereScript
          ),
        ]
      ),
      ScenePreset(
        name: "Pagoda",
        description:
          "Traditional five-story timber Japanese pagoda (3.2m tall) with upturned eaves and bronze sorin spire",
        script: pagodaScript,
        mode: .threeLive,
        sampleEdits: [
          SampleAiEdit(
            prompt: "Illuminate at dusk with glowing warm paper lanterns under every roof eave",
            script:
              pagodaScript
              .replacingOccurrences(
                of: "new THREE.AmbientLight(0xffffff, 0.65)",
                with: "new THREE.AmbientLight(0x1e293b, 0.42)"
              )
              .replacingOccurrences(
                of: "new THREE.DirectionalLight(0xfff4dc, 1.4)",
                with: "new THREE.DirectionalLight(0x818cf8, 0.55)"
              ) + "\n\n" + pagodaLanternSuffix
          ),
          SampleAiEdit(
            prompt: "Give the roofs weathered copper-patina tiles and golden imperial pillars",
            script:
              pagodaScript
              .replacingOccurrences(
                of: "color: 0xb8291e,\n  metalness: 0.1,\n  roughness: 0.42",
                with: "color: 0xd4af37,\n  metalness: 0.86,\n  roughness: 0.18"
              )
              .replacingOccurrences(
                of: "color: 0x2b3036,\n  metalness: 0.35,\n  roughness: 0.48",
                with: "color: 0x2d8a78,\n  metalness: 0.48,\n  roughness: 0.36"
              )
          ),
        ]
      ),
    ]

    public static let xrLivePresets: [ScenePreset] = [
      ScenePreset(
        name: "Ballpit",
        description: "Room floor, tabletop anchor, and 14 dynamic grabbable ballpit spheres",
        script: """
          // Ballpit Lab: Room & Heightfield Physics
          // Pedestal & Room Reference Floor Grid
          const floor = new THREE.Mesh(
            new THREE.BoxGeometry(3.4, 0.08, 3.4),
            new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35, metalness: 0.2 })
          );
          floor.name = 'Room_Floor';
          floor.position.set(0, -0.85, 0);
          scene.add(floor);

          // Tabletop Surface Anchor Target
          const table = new THREE.Mesh(
            new THREE.CylinderGeometry(0.65, 0.55, 0.08, 32),
            new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.2, metalness: 0.6 })
          );
          table.name = 'Pedestal_Table';
          table.position.set(0, -0.25, 0);
          scene.add(table);

          // Colorful Dynamic Ballpit Spheres (userData.xr.physics = 'dynamic')
          const palette = [0x38bdf8, 0xa855f7, 0x22c55e, 0xf59e0b, 0xec4899, 0x6366f1];
          for (let i = 0; i < 14; i++) {
            const radius = 0.11 + (i % 3) * 0.03;
            const ball = new THREE.Mesh(
              new THREE.SphereGeometry(radius, 24, 24),
              new THREE.MeshStandardMaterial({
                color: palette[i % palette.length],
                roughness: 0.18,
                metalness: 0.25
              })
            );
            ball.name = 'Ball_' + (i + 1);
            const angle = (i / 14) * Math.PI * 2;
            const ring = 0.25 + (i % 4) * 0.18;
            ball.position.set(
              Math.cos(angle) * ring,
              0.35 + i * 0.14,
              Math.sin(angle) * ring
            );
            ball.userData.xr = {
              physics: 'dynamic',
              traits: ['grab', 'scale']
            };
            scene.add(ball);
          }
          """,
        mode: .xrLive
      ),
      ScenePreset(
        name: "Workbench",
        description:
          "6DoF grab, pinch-scale torus knot, capsule billboard gem, and dynamic orbiter",
        script: """
          // Spatial Workbench: 6DoF Grab, Scale & Capsule Billboard
          // Workbench Pedestal
          const base = new THREE.Mesh(
            new THREE.CylinderGeometry(0.9, 1.0, 0.08, 36),
            new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.5 })
          );
          base.name = 'Workbench_Pedestal';
          base.position.set(0, -0.65, 0);
          scene.add(base);

          // 1. Grabbable & Scalable Hero Torus Knot Artifact
          const artifact = new THREE.Mesh(
            new THREE.TorusKnotGeometry(0.28, 0.085, 96, 20),
            new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.15, metalness: 0.75 })
          );
          artifact.name = 'Torus_Knot_Artifact';
          artifact.position.set(-0.45, 0.1, 0);
          artifact.userData.xr = {
            traits: ['grab', 'scale'],
            anchor: 'table'
          };
          artifact.userData.interactivity = {
            onSelect: { action: 'toggleTransform', scale: [1.3, 1.3, 1.3], duration: 0.35 }
          };
          scene.add(artifact);

          // 2. Capsule Billboard Indicator Gem (TurnToFace Y-axis locked)
          const gem = new THREE.Mesh(
            new THREE.CylinderGeometry(0, 0.24, 0.42, 6),
            new THREE.MeshStandardMaterial({ color: 0xa855f7, roughness: 0.2, metalness: 0.4 })
          );
          gem.name = 'Billboard_Gem';
          gem.position.set(0.45, 0.15, 0);
          gem.userData.xr = {
            traits: ['grab', 'billboard'],
            anchor: 'table'
          };
          gem.userData.interactivity = {
            onSelect: { action: 'toggleTransform', scale: [1.3, 1.3, 1.3], duration: 0.3 }
          };
          scene.add(gem);

          // 3. Floating Dynamic Moon Orbiter (bounces on workbench pedestal)
          const orb = new THREE.Mesh(
            new THREE.SphereGeometry(0.14, 24, 24),
            new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.2, metalness: 0.3 })
          );
          orb.name = 'Dynamic_Orbiter';
          orb.position.set(0, 0.55, 0);
          orb.userData.xr = {
            physics: 'dynamic',
            traits: ['grab', 'scale']
          };
          scene.add(orb);
          """,
        mode: .xrLive
      ),
      ScenePreset(
        name: "Gemini AI",
        description: "Near, Mid, and Far depth reference pillars with 6DoF grab & scale traits",
        script: """
          // Gemini Spatial Perception & Depth Occlusion Scene
          // Near, Mid, and Far Depth Reference Pillars for 8x8 Metric Depth Grid
          const depths = [
            { pos: [-0.55, -0.125, 0.55], color: 0x22c55e, h: 0.7 },
            { pos: [0.0, 0.0, 0.0], color: 0x38bdf8, h: 0.95 },
            { pos: [0.6, 0.125, -0.65], color: 0xa855f7, h: 1.2 }
          ];

          depths.forEach((d, idx) => {
            const pillar = new THREE.Mesh(
              new THREE.BoxGeometry(0.28, d.h, 0.28),
              new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.25, metalness: 0.4 })
            );
            pillar.name = 'Depth_Pillar_' + (idx + 1);
            pillar.position.set(d.pos[0], d.pos[1], d.pos[2]);
            pillar.userData.xr = { traits: ['grab', 'scale'] };
            pillar.userData.interactivity = {
              onSelect: { action: 'toggleTransform', scale: [1.25, 1.25, 1.25], duration: 0.3 }
            };
            scene.add(pillar);
          });
          """,
        mode: .xrLive
      ),
      ScenePreset(
        name: "Robotic Arm IK",
        description:
          "Articulated 2-bone inverse kinematics arm (userData.xr.ik) tracking a grabbable 6DoF target orb",
        script: """
          const armMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.22, metalness: 0.85 });
          const shoulder = new THREE.Group();
          shoulder.name = 'Shoulder';
          shoulder.position.set(-0.22, -0.1, 0);
          const upper = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.34), armMat);
          upper.position.set(0, 0, 0.17);
          shoulder.add(upper);

          const forearm = new THREE.Group();
          forearm.name = 'Forearm';
          forearm.position.set(0, 0, 0.34);
          const lower = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.065, 0.3), armMat);
          lower.position.set(0, 0, 0.15);
          forearm.add(lower);
          shoulder.add(forearm);

          const wrist = new THREE.Mesh(
            new THREE.SphereGeometry(0.06, 20, 20),
            new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: 0x7e22ce, emissiveIntensity: 0.7 })
          );
          wrist.name = 'WristEffector';
          wrist.position.set(0, 0, 0.3);
          wrist.userData.xr = {
            ik: { root: 'Shoulder', mid: 'Forearm', effector: 'WristEffector', target: 'GripperTarget', pole: 'ElbowPole' }
          };
          forearm.add(wrist);
          scene.add(shoulder);

          const pole = new THREE.Group();
          pole.name = 'ElbowPole';
          pole.position.set(-0.22, 0.65, 0);
          scene.add(pole);

          const target = new THREE.Mesh(
            new THREE.SphereGeometry(0.075, 24, 24),
            new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x16a34a, emissiveIntensity: 0.85 })
          );
          target.name = 'GripperTarget';
          target.position.set(0.24, 0.18, 0.18);
          target.userData.xr = {
            grab: '1-hand',
            orbit: { target: [0, 0.15, 0.1], radius: 0.25, speed: 1.0, height: 0.05 },
            outline: { color: '#22c55e', thickness: 0.025 }
          };
          scene.add(target);
          """,
        mode: .xrLive
      ),
    ]

    public static let presets: [ScenePreset] = threeLivePresets

    public static func presets(for mode: StudioMode) -> [ScenePreset] {
      switch mode {
      case .threeLive:
        return threeLivePresets
      case .xrLive:
        return xrLivePresets
      }
    }
  }
#endif
