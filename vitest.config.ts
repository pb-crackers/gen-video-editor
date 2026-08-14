/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Unit tests for the parts of this repo that are pure logic.
 *
 * Deliberately narrow. Most of what matters here — does a matte look right,
 * does alpha survive the encoder — is answered by rendering a frame and looking
 * at it, and a unit test that asserted on those would be asserting on a
 * screenshot. What belongs here is the code that parses, buffers and validates:
 * the places where a wrong answer is silent, cheap to trigger, and impossible
 * to see in a picture.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts", "film/**/*.test.ts"],
    // The renderer's own suites would need a DOM and a GPU; this config covers
    // node-side code only, and picking up a browser test would fail confusingly.
    exclude: ["**/node_modules/**", "apps/web/**"],
  },
});
