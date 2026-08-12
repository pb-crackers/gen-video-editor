/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { Match, Switch } from "solid-js";

import { Dialog, DialogContent, DialogPortal } from "@/components/ui/dialog";

import { DashboardAccountView } from "./account-view";
import { DashboardHelpView } from "./help-view";
import { DashboardProjectsView } from "./projects-view";
import { DashboardSettingsView } from "./settings-view";
import { DashboardSidebarHeader, DashboardSidebarNav, DashboardSidebarUser, DashboardSidebarItem } from "./sidebar";
import { Separator } from "@/components/ui/separator";

import type { DashboardView } from "./types";

const DASHBOARD_VIEWS: readonly DashboardView[] = [
  "projects",
  "templates",
  "account",
  "settings",
  "preferences",
  "help",
];

function parseView(value: string | string[] | undefined): DashboardView {
  const raw = Array.isArray(value) ? value[0] : value;
  return DASHBOARD_VIEWS.find((v) => v === raw) ?? "projects";
}

export function Dashboard() {
  const [params, setParams] = useSearchParams();

  const view = (): DashboardView => parseView(params.dashboard);
  const setView = (next: DashboardView) => {
    setParams({ dashboard: next }, { replace: true });
  };

  const close = () => {
    setParams({ dashboard: undefined }, { replace: true });
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) close();
  };

  return (
    <Dialog open preventScroll={false} onOpenChange={handleOpenChange}>
      <DialogPortal>
        <DialogContent
          showCloseButton={false}
          class="h-150 min-w-251 overflow-hidden rounded-xl p-0 gap-0"
        >
          <div class="flex h-full min-h-0 flex-row">
            <aside class="flex min-h-0 w-56 shrink-0 flex-col bg-card">
              <DashboardSidebarHeader />
              <DashboardSidebarNav>
                <DashboardSidebarItem active={view() === "projects"} onClick={() => setView("projects")} icon="diffusion-project-file" label="Projects" />
                <DashboardSidebarItem active={view() === "settings"} onClick={() => setView("settings")} icon="settings" label="Settings" class="mt-auto" />
                <DashboardSidebarItem active={view() === "help"} onClick={() => setView("help")} icon="help" label="Help" />
              </DashboardSidebarNav>
              <DashboardSidebarUser active={view() === "account"} onClick={() => setView("account")} />
            </aside>

            <Separator orientation="vertical" class="bg-border-strong" />

            <section class="flex min-h-0 flex-1 flex-col bg-canvas">
              <Switch>
                <Match when={view() === "projects"}>
                  <DashboardProjectsView />
                </Match>
                <Match when={view() === "account"}>
                  <DashboardAccountView />
                </Match>
                <Match when={view() === "settings"}>
                  <DashboardSettingsView />
                </Match>
                <Match when={view() === "help"}>
                  <DashboardHelpView />
                </Match>
              </Switch>
            </section>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
