/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerZIP } from '@electron-forge/maker-zip';
import { PublisherGithub } from '@electron-forge/publisher-github';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { version } = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Diffusion Studio',
    appBundleId: 'studio.diffusion.editor',
    appCategoryType: 'public.app-category.video',
    appVersion: version,
    icon: './assets/icon',
    protocols: [{ name: 'Diffusion Studio', schemes: ['diffusion'] }],
    prune: false,
    // This allow-list carries no `node_modules`: esbuild bundles every
    // dependency into dist/main.js except `onnxruntime-node`, which loads a
    // `.node` binary at runtime and so stays external. That one ships via
    // extraResource below instead of from here — npm hoists it to the REPO
    // ROOT, outside the directory being packaged, so no path allow-listed here
    // could ever find it.
    ignore: (path) =>
      path !== '' &&
      path !== '/package.json' &&
      path !== '/dist' &&
      !path.startsWith('/dist/') &&
      path !== '/web' &&
      !path.startsWith('/web/'),
    // Staged by scripts/stage-cli.mjs; ends up at Contents/Resources/cli.
    // The second entry is scripts/stage-onnxruntime.mjs' output and must keep
    // its `node_modules` basename: extraResource copies by basename, so it
    // lands at Contents/Resources/node_modules, which is precisely where Node
    // looks when Contents/Resources/app/dist/main.js requires
    // `onnxruntime-node` and walks its parents.
    extraResource: ['./cli', './onnxruntime/node_modules'],
    osxSign: process.env.SKIP_SIGN ? undefined : {},
    osxNotarize:
      process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID
        ? {
            appleId: process.env.APPLE_ID,
            appleIdPassword: process.env.APPLE_PASSWORD,
            teamId: process.env.APPLE_TEAM_ID,
          }
        : undefined,
  },
  makers: [
    new MakerZIP({}, ['darwin']),
    new MakerDMG({
      name: `Diffusion-Studio-${process.arch}`,
      icon: './assets/icon.icns',
      // Dark, on-brand window; @2x sibling is picked up automatically for retina.
      background: './assets/dmg-background.png',
      iconSize: 120,
      additionalDMGOptions: {
        'background-color': '#1c1c1c',
        window: { size: { width: 658, height: 498 } },
      },
      contents: (opts) => [
        { x: 188, y: 217, type: 'file', path: opts.appPath },
        { x: 470, y: 217, type: 'link', path: '/Applications' },
      ],
    }),
  ],
  publishers: [
    new PublisherGithub({
      repository: { owner: 'diffusionstudio', name: 'editor' },
      draft: true,
    }),
  ],
};

export default config;
