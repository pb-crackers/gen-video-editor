/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { createEffect, createContext, useContext, onCleanup, onMount, createResource } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import { useEngine } from '@/context/engine';
import { useProjectId } from '@/hooks/use-project-id';
import { useAuth } from '@/context/auth';
import { hasHostedApi } from '@/lib/trpc';
import { t, q, m, q0, m0 } from "@/lib/cli-rpc";
import { handleContextGet } from "./context";
import { handleAssetsAdd, handleAssetsList, handleAssetTree, handleAssetsDelete, handleAssetsMove, handleAssetsExport } from "./assets";
import { handleMediaProbe, handleMediaFrame, handleMediaTranscribe, handleMediaFilmstrip, handleMediaWaveform, handleMediaListen } from "./media";
import { handleFoldersList, handleFolderCreate, handleFolderRename, handleFoldersMove, handleFoldersDelete } from "./folders";
import { handleSelectionFocus, handleSelectionList, handleSelectionSet } from "./selection";
import { handleNodeList, handleNodeTree, handleNodeGrep, handleNodeCapture, handleNodeDelete, handleNodePatch, handleNodeDuplicate, handleNodeRender } from "./node";
import { handleMount, handleNodeInsert } from "./mount";
import { handleProjectActive, handleProjectList, handleProjectCreate, handleProjectDelete, handleProjectOpen } from "./project";
import { handleLogs } from "./logs";
import { handleModels } from "./models";
import { handleVoices } from "./voices";
import { cliBridge, mainBridge } from '@/lib/ipc';
import { createRouterCaller } from '@/lib/cli-rpc';
import { MAIN_CHANNELS } from '@desktop/main-channels';
import { assert } from "@/utils/common";
import { handleGetFullscreenState, handleWindowFullscreenChange, handleWindowScreenshot } from "./window";

import type { JSX, Accessor } from 'solid-js';
import type { User } from '@supabase/supabase-js';
import type { Engine } from '@/components/engine';

type EditorApiProviderProps = {
  children: JSX.Element;
};

type EditorApiContextValue = {
  isFullscreen: Accessor<boolean>;
  isDesktop: boolean;
};

const EditorApiContext = createContext<EditorApiContextValue>();

export function EditorApiProvider(props: EditorApiProviderProps) {
  const projectId = useProjectId();
  const engine = useEngine();
  const auth = useAuth();
  const [, setParams] = useSearchParams();
  const [isFullscreen, { mutate }] = createResource(handleGetFullscreenState, { initialValue: false });

  // There are no accounts in this build. What a generative call can still lack
  // is somewhere to send the request, so that is what gets checked.
  const requireAuth = <I, O>(fn: (data: I) => Promise<O>) => (data: I) => {
    assert(
      hasHostedApi,
      "No model provider configured. Set VITE_API_URL to a gateway that implements the generation API.",
    );
    return fn(data);
  };

  const getUser = () => {
    const user = auth.user();
    assert(user, "User not found");
    return user;
  };

  const getEngine = () => engine;

  createEffect(() => {
    document.documentElement.dataset.fullscreen = String(isFullscreen());
  });

  onMount(() => {
    if (!window.desktop) return;
    onCleanup(mainBridge.handle(MAIN_CHANNELS.WINDOW_FULLSCREEN_CHANGE, handleWindowFullscreenChange(mutate)));
  });

  createEffect(() => {
    if (!window.desktop || !engine.initialized() || projectId() !== engine.world.projectId) return;


    const router = createAppRouter({ getEngine, getUser, requireAuth, setParams });
    onCleanup(cliBridge.register(createRouterCaller(router)));
  });

  return (
    <EditorApiContext.Provider
      value={{
        isFullscreen,
        isDesktop: !!window.desktop,
      }}
    >
      {props.children}
    </EditorApiContext.Provider>
  );
}


type AppRouterDeps = {
  getEngine: () => Engine;
  getUser: () => User;
  requireAuth: <I, O>(fn: (data: I) => Promise<O>) => (data: I) => Promise<O>;
  setParams: ReturnType<typeof useSearchParams>[1];
};

function createAppRouter({ getEngine, getUser, requireAuth, setParams }: AppRouterDeps) {
  return t.router({
    ping: t.procedure.query(() => {}),
    whoami: t.procedure.query(() => getUser()),
    context: q0(handleContextGet(getEngine)),
    mount: m(handleMount(getEngine)),
    models: q(handleModels()),
    logs: q(handleLogs()),
    screenshot: q0(handleWindowScreenshot()),
    voices: q0(handleVoices()),
    asset: t.router({
      add: m(handleAssetsAdd(getEngine)),
      list: q(handleAssetsList(getEngine)),
      tree: q(handleAssetTree(getEngine)),
      delete: m(handleAssetsDelete(getEngine)),
      move: m(handleAssetsMove(getEngine)),
      export: m(handleAssetsExport(getEngine)),
    }),
    media: t.router({
      probe: q(handleMediaProbe(getEngine)),
      frame: q(handleMediaFrame(getEngine)),
      transcribe: q(handleMediaTranscribe(getEngine)),
      filmstrip: q(handleMediaFilmstrip(getEngine)),
      waveform: q(handleMediaWaveform(getEngine)),
      listen: q(requireAuth(handleMediaListen(getEngine))),
    }),
    folder: t.router({
      list: q(handleFoldersList(getEngine)),
      create: m(handleFolderCreate(getEngine)),
      rename: m(handleFolderRename(getEngine)),
      move: m(handleFoldersMove(getEngine)),
      delete: m(handleFoldersDelete(getEngine)),
    }),
    selection: t.router({
      list: q0(handleSelectionList(getEngine)),
      set: m(handleSelectionSet(getEngine)),
      focus: m0(handleSelectionFocus(getEngine)),
    }),
    node: t.router({
      list: q(handleNodeList(getEngine)),
      tree: q(handleNodeTree(getEngine)),
      grep: q(handleNodeGrep(getEngine)),
      capture: q(handleNodeCapture(getEngine)),
      insert: m(handleNodeInsert(getEngine)),
      delete: m(handleNodeDelete(getEngine)),
      patch: m(handleNodePatch(getEngine)),
      duplicate: m(handleNodeDuplicate(getEngine)),
      render: m(handleNodeRender(getEngine)),
    }),
    project: t.router({
      active: q0(handleProjectActive(getEngine)),
      list: q0(handleProjectList()),
      create: m(handleProjectCreate(getEngine, setParams)),
      delete: m(handleProjectDelete(getEngine, setParams)),
      open: m(handleProjectOpen(getEngine, setParams)),
    }),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

export function useEditorApi() {
  const ctx = useContext(EditorApiContext);
  assert(ctx, "useEditorApi must be used within EditorApiProvider");
  return ctx;
}
