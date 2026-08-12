/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Router, HashRouter, Route } from '@solidjs/router';
import { ColorModeProvider } from '@kobalte/core';
import { Toaster } from "@/components/ui/sonner";
import { AppContextMenu } from "@/components/app-context-menu";

import { AuthProvider } from '@/context/auth';
import { PersistRoute } from '@/lib/persist-route';
import { ScreenTooSmall } from '@/components/screen-too-small';
import { UnsupportedBrowser } from '@/components/unsupported-browser';
import { HomePage } from './pages/home';
import { NotFoundPage } from './pages/not-found';

/**
 * No AuthGate, no login route and no purchase surfaces: this build has no
 * accounts. The editor opens straight onto the workspace.
 */
function App() {
  const RouterComponent = window.desktop ? HashRouter : Router;
  return (
    <RouterComponent
      root={(props) => (
        <ColorModeProvider initialColorMode="dark">
          <AppContextMenu>
            <AuthProvider>
              {props.children}
            </AuthProvider>
          </AppContextMenu>
          <Toaster />
          <ScreenTooSmall />
          <UnsupportedBrowser />
          <PersistRoute />
        </ColorModeProvider>
      )}
    >
      <Route path="/" component={HomePage} />
      <Route path="*404" component={NotFoundPage} />
    </RouterComponent>
  );
}

export default App;
