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

import XCTest

/// Drives the Apple TV demo with the simulated Siri Remote.
final class TVRemoteUITests: XCTestCase {
  private let app = XCUIApplication()
  private let remote = XCUIRemote.shared

  override func setUpWithError() throws {
    continueAfterFailure = false
    app.launch()
  }

  /// Explore → Select (nothing selectable) → Menu returns to the scene list without leaving
  /// the app.
  func testRemoteExploresAndMenuReturnsToScenes() throws {
    let explore = try waitForExploreEnabled()
    remote.press(.left)
    XCTAssertTrue(explore.hasFocus)
    remote.press(.select)

    let hint = app.staticTexts["exploreHint"]
    XCTAssertTrue(hint.waitForExistence(timeout: 5))
    XCTAssertFalse(explore.exists)

    // The opening preset (Espresso) has no `onSelect` behaviors.
    remote.press(.select)
    waitForStatus("Nothing selectable under the reticle")

    // Menu leaves Explore with focus back on Explore, but must not leave the app.
    remote.press(.menu)
    XCTAssertTrue(explore.wait(for: \.hasFocus, toEqual: true, timeout: 5))
    XCTAssertFalse(hint.exists)
    XCTAssertEqual(app.state, .runningForeground)
  }

  /// Loads Instanced Lattice and selects the knot at the center of its turntable, which has an
  /// `onSelect` behavior. (The scene has no physics, so nothing else can move under the
  /// reticle.)
  func testRemoteSelectsNodeUnderReticle() throws {
    let explore = try waitForExploreEnabled()
    let lattice = app.buttons["preset-Instanced Lattice"]
    XCTAssertTrue(lattice.exists)
    move(.right, until: lattice)
    remote.press(.select)
    // The title switches as the new compile starts (Explore turns off in the same update),
    // so waiting for it and then for Explore cannot match the previous preset's state.
    XCTAssertTrue(
      app.staticTexts["sceneTitle"].wait(for: \.label, toEqual: "Instanced Lattice", timeout: 10))
    XCTAssertTrue(explore.wait(for: \.isEnabled, toEqual: true, timeout: 60))

    move(.left, until: explore)
    remote.press(.select)
    XCTAssertTrue(app.staticTexts["exploreHint"].waitForExistence(timeout: 5))
    remote.press(.select)
    waitForStatus("Selected LatticeEnergyCore")
  }

  /// Outside Explore the demo does not handle Menu, so it leaves the app as tvOS expects.
  func testMenuOnSceneListLeavesTheApp() throws {
    _ = try waitForExploreEnabled()
    remote.press(.menu)
    let left = XCTNSPredicateExpectation(
      predicate: NSPredicate(
        format: "state != %d", XCUIApplication.State.runningForeground.rawValue),
      object: app)
    XCTAssertEqual(
      XCTWaiter.wait(for: [left], timeout: 10), .completed,
      "app was still in the foreground after Menu")
  }

  /// Auto-rotate (on for Three-Live presets) pauses in Explore, so the model holds still under
  /// the reticle. Espresso has no animations, so any change between the two frames is rotation.
  func testExploreHoldsTheModelStill() throws {
    let explore = try waitForExploreEnabled()
    XCTAssertEqual(app.staticTexts["sceneTitle"].label, "Espresso")
    remote.press(.left)
    XCTAssertTrue(explore.hasFocus)
    remote.press(.select)
    XCTAssertTrue(app.staticTexts["exploreHint"].waitForExistence(timeout: 5))

    // Past the 1.5 s auto-rotate delay, then 2 s apart: 60° of turntable if it were spinning.
    Thread.sleep(forTimeInterval: 2.5)
    let before = XCUIScreen.main.screenshot().image
    Thread.sleep(forTimeInterval: 2)
    let after = XCUIScreen.main.screenshot().image
    let changed = try changedPixelFraction(before, after)
    XCTAssertLessThan(changed, 0.01, "\(Int(changed * 100))% of pixels changed while exploring")
  }

  // MARK: Helpers

  /// The fraction of pixels whose color moved by more than 24 levels, sampled at quarter size.
  private func changedPixelFraction(_ a: UIImage, _ b: UIImage) throws -> Double {
    func rgba(_ image: UIImage) throws -> [UInt8] {
      let cgImage = try XCTUnwrap(image.cgImage)
      let (width, height) = (cgImage.width / 4, cgImage.height / 4)
      var bytes = [UInt8](repeating: 0, count: width * height * 4)
      try bytes.withUnsafeMutableBytes { buffer in
        let context = try XCTUnwrap(
          CGContext(
            data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
            bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
      }
      return bytes
    }
    let (pixelsA, pixelsB) = (try rgba(a), try rgba(b))
    XCTAssertEqual(pixelsA.count, pixelsB.count)
    let count = min(pixelsA.count, pixelsB.count) / 4
    var changed = 0
    for i in 0..<count {
      let moved = (0..<3).contains { abs(Int(pixelsA[i * 4 + $0]) - Int(pixelsB[i * 4 + $0])) > 24 }
      if moved { changed += 1 }
    }
    return Double(changed) / Double(max(count, 1))
  }

  /// Presses `direction` until `element` has focus, failing after 32 presses.
  private func move(_ direction: XCUIRemote.Button, until element: XCUIElement) {
    for _ in 0..<32 where !element.hasFocus {
      remote.press(direction)
    }
    XCTAssertTrue(element.hasFocus, "\(element) never received focus")
  }

  private func waitForExploreEnabled() throws -> XCUIElement {
    let explore = app.buttons["explore"]
    XCTAssertTrue(explore.wait(for: \.isEnabled, toEqual: true, timeout: 60))
    return explore
  }

  private func waitForStatus(_ text: String) {
    let status = app.staticTexts["status"]
    XCTAssertTrue(
      status.wait(for: \.label, toEqual: text, timeout: 30),
      "status was \"\(status.label)\", expected \"\(text)\"")
  }
}
