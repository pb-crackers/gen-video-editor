/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { ElectronFileHandle } from '@/lib/electron-file-handle';
import { ElectronWritableFileHandle } from '@/lib/electron-file-writable';
import { loadAsset, removeAsset, getAssetFile } from '@/components/engine';
import { assert, mimeTypeToExtension } from '@/utils';
import {
  assetFolderId,
  moveAssetsToFolder,
  useFolders,
} from '@/components/engine';

import type { Engine } from "@/components/engine";
import type { Asset } from "@/components/engine/db";
import type { AssetExportResult, AssetMoveResult, AssetRecord, AssetsExportRequest, AssetTreeEntry } from "@diffusionstudio/cli/channels";
import type { Accessor } from "solid-js";

export function handleAssetsAdd(engine: Accessor<Engine>) {
  return async ({ paths, folderId }: { paths: string[]; folderId?: string }): Promise<AssetRecord[]> => {
    const { world } = engine();
    if (folderId !== undefined) {
      assert(world.folders.has(folderId), `Folder ${folderId} not found.`);
    }
    const assets = await Promise.all(
      paths.map(async (path) => {
        try {
          return await loadAsset(world, new ElectronFileHandle(path), { folderId });
        } catch (e) {
          throw new Error(`${path}: ${(e as Error)?.message ?? String(e)}`);
        }
      })
    );
    return assets.map(toAssetRecord);
  }
}

/**
 * The persisted asset record minus the props that can't cross the wire
 */
function toAssetRecord(asset: Asset): AssetRecord {
  const record: Record<string, unknown> = { ...asset };
  delete record.handle;
  delete record.directoryHandle;
  delete record.hash;
  delete record.transcript;
  return record as AssetRecord;
}

export function handleAssetsList(engine: Accessor<Engine>) {
  return async ({ ids }: { ids?: string[] }): Promise<AssetRecord[]> => {
    const { world } = engine();

    // No ids → every asset in the library
    if (ids === undefined || ids.length === 0) {
      return Array.from(world.assets.values()).map(toAssetRecord);
    }

    return resolveAssets(world, ids).map(toAssetRecord);
  };
}

function resolveAssets(world: Engine["world"], ids: string[]): Asset[] {
  return ids.map((id) => {
    const asset = world.assets.get(id);
    assert(asset, `No such asset: ${id}`);
    return asset;
  });
}

export function handleAssetTree(engine: Accessor<Engine>) {
  return async ({ folderId, depth }: { folderId?: string; depth?: number }): Promise<AssetTreeEntry[]> => {
    const { world } = engine();
    if (folderId !== undefined) {
      assert(world.folders.has(folderId), `Folder ${folderId} not found.`);
    }

    const { childrenOf } = useFolders(world);
    const assets = Array.from(world.assets.values());

    // Visited set guards against parentId cycles in corrupt data.
    const visited = new Set<string>();
    const entries = (parentId: string | null, remaining: number | undefined): AssetTreeEntry[] => {
      const folderEntries = childrenOf(parentId)
        .filter((folder) => !visited.has(folder.id))
        .map((folder) => {
          visited.add(folder.id);
          const next = remaining === undefined ? undefined : remaining - 1;
          const children = next === undefined || next > 0 ? entries(folder.id, next) : [];
          return {
            id: folder.id,
            name: folder.name,
            type: "folder",
            ...(children.length > 0 && { children }),
          };
        });
      const assetEntries = assets
        .filter((asset) => assetFolderId(world, asset) === parentId)
        .map((asset) => ({ id: asset.id, name: asset.name, type: asset.type }));
      return [...folderEntries, ...assetEntries];
    };

    return entries(folderId ?? null, depth);
  }
}

export function handleAssetsMove(engine: Accessor<Engine>) {
  return async ({ ids, to }: { ids: string[]; to?: string }): Promise<AssetMoveResult[]> => {
    const { world } = engine();
    if (to !== undefined) {
      assert(world.folders.has(to), `Folder ${to} not found.`);
    }
    const folderId = to ?? null;
    resolveAssets(world, ids);
    await moveAssetsToFolder(world, ids, folderId);
    return ids.map((id) => ({ id, folderId }));
  }
}

export function handleAssetsDelete(engine: Accessor<Engine>) {
  return async ({ ids }: { ids: string[] }): Promise<Array<{ id: string; name: string }>> => {
    const { world } = engine();
    const results = resolveAssets(world, ids).map((asset) => ({ id: asset.id, name: asset.name }));
    await removeAsset(world, ...ids);
    return results;
  }
}

export function handleAssetsExport(engine: Accessor<Engine>) {
  return async ({ ids, output, isDir }: AssetsExportRequest): Promise<AssetExportResult[]> => {
    const { world } = engine();
    const assets = resolveAssets(world, ids);
    for (const asset of assets) {
      assert(asset.type !== "SEQUENCE", `Asset ${asset.id} is an image sequence; export is not supported.`);
    }
    const results: AssetExportResult[] = [];
    for (const asset of assets) {
      const blob = await getAssetFile(asset);
      const path = isDir
        ? await streamBlobToDir(blob, output, exportFileName(asset))
        : await streamBlobToFile(blob, output);
      results.push({ id: asset.id, path });
    }
    return results;
  };
}

/**
 * Strips characters that are path separators or invalid on Windows
 */
function exportFileName(asset: Asset): string {
  // eslint-disable-next-line no-control-regex -- control chars are stripped deliberately
  const sanitized = asset.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  const name = sanitized || asset.id;
  return /\.[^.\s]{1,8}$/.test(name) ? name : name + mimeTypeToExtension(asset.mimeType);
}

const MAX_UNIQUIFY = 1000;

async function streamBlobToDir(blob: Blob, dir: string, fileName: string): Promise<string> {
  // Joining with "/" is safe on Windows too — node's fs accepts it.
  const base = dir.replace(/[\\/]+$/, "");
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : "";
  for (let n = 0; n < MAX_UNIQUIFY; n++) {
    const path = `${base}/${n === 0 ? fileName : `${stem} (${n})${ext}`}`;
    const handle = new ElectronWritableFileHandle(path);
    let writable: WritableStream;
    try {
      writable = await handle.createWritable({ exclusive: true });
    } catch (e) {
      if (/EEXIST/.test((e as Error)?.message ?? "")) continue; // name taken — try the next suffix
      throw e;
    }
    await pumpBlob(blob, writable, handle);
    return path;
  }
  throw new Error(`Could not find a free file name for "${fileName}" in ${base}.`);
}

export async function streamBlobToFile(blob: Blob, path: string): Promise<string> {
  const handle = new ElectronWritableFileHandle(path);
  await pumpBlob(blob, await handle.createWritable(), handle);
  return path;
}

/**
 * Streams the blob chunk-by-chunk to the open writable
 */
async function pumpBlob(
  blob: Blob,
  writable: WritableStream,
  handle: ElectronWritableFileHandle,
): Promise<void> {
  const writer = writable.getWriter();
  const reader = blob.stream().getReader();
  let position = 0;
  try {
    for (; ;) {
      const { done, value } = await reader.read();
      if (done) break;
      await writer.write({ type: "write", data: value, position });
      position += value.byteLength;
    }
    await writer.close();
  } catch (e) {
    await handle.dispose().catch(() => { });
    throw e;
  }
}
