import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  addBundle,
  deleteBundle,
  listBundles,
  replaceBundle,
  resolveBundle,
  validateBundleRef,
  type BundleEntry,
  type BundleRef,
  type BundleResolved,
} from "@open-design/bundle";
import { SIDECAR_ENV, type SidecarImplementationSnapshot } from "@open-design/sidecar-proto";

import type { ToolDevConfig } from "./config.js";

export const TOOLS_DEV_WEB_BUNDLE_KEY = "od:sidecar:web";
export const TOOLS_DEV_WEB_BUNDLE_ENTRY = "sidecar/index.ts";

export type ToolsDevWebSource =
  | { type: "workspace" }
  | { entry: string; ref: BundleRef; type: "bundle" }
  | { entryPath: string; persistent?: boolean; type: "explicitPath" };

export type ToolsDevActivationFile = {
  version: 1;
  web: ToolsDevWebSource;
};

export type ToolsDevResolvedWebImplementation = {
  entryPath: string;
  implementation: SidecarImplementationSnapshot | null;
  source: ToolsDevWebSource;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function containsPath(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel));
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function normalizeToolsDevBundleRef(input: {
  key?: string | null;
  version: string;
}): BundleRef {
  return validateBundleRef({
    key: input.key == null || input.key.length === 0 ? TOOLS_DEV_WEB_BUNDLE_KEY : input.key,
    version: input.version,
  });
}

function parseWebSource(value: unknown): ToolsDevWebSource {
  if (!isRecord(value)) throw new Error("tools-dev activation web source must be an object");
  const type = stringField(value, "type");
  if (type === "workspace") return { type };
  if (type === "bundle") {
    const entry = stringField(value, "entry");
    const ref = value.ref;
    if (entry == null || !isRecord(ref)) {
      throw new Error("tools-dev bundle web source must contain ref and entry");
    }
    return {
      entry,
      ref: validateBundleRef(ref as BundleRef),
      type,
    };
  }
  if (type === "explicitPath") {
    const entryPath = stringField(value, "entryPath");
    if (entryPath == null) throw new Error("tools-dev explicitPath web source must contain entryPath");
    return {
      entryPath: path.resolve(entryPath),
      ...(typeof value.persistent === "boolean" ? { persistent: value.persistent } : {}),
      type,
    };
  }
  throw new Error(`unsupported tools-dev web source: ${String(type)}`);
}

function parseActivationFile(value: unknown): ToolsDevActivationFile {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error("tools-dev activation must contain version=1");
  }
  return {
    version: 1,
    web: value.web == null ? { type: "workspace" } : parseWebSource(value.web),
  };
}

export async function readToolsDevActivation(config: Pick<ToolDevConfig, "bundleActivationPath">): Promise<ToolsDevActivationFile> {
  try {
    return parseActivationFile(JSON.parse(await readFile(config.bundleActivationPath, "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, web: { type: "workspace" } };
    }
    throw error;
  }
}

export async function writeToolsDevWebSource(
  config: Pick<ToolDevConfig, "bundleActivationPath">,
  web: ToolsDevWebSource,
): Promise<ToolsDevActivationFile> {
  const activation = parseActivationFile({ version: 1, web });
  await mkdir(path.dirname(config.bundleActivationPath), { recursive: true });
  await writeFile(config.bundleActivationPath, `${JSON.stringify(activation, null, 2)}\n`, "utf8");
  return activation;
}

export async function addToolsDevBundle(input: {
  config: Pick<ToolDevConfig, "bundleBasePath">;
  ref: BundleRef;
  replace?: boolean;
  sourcePath: string;
}): Promise<BundleResolved> {
  const write = input.replace === true ? replaceBundle : addBundle;
  return await write({
    basePath: input.config.bundleBasePath,
    ref: input.ref,
    sourcePath: path.resolve(input.sourcePath),
  });
}

export async function listToolsDevBundles(config: Pick<ToolDevConfig, "bundleBasePath">): Promise<BundleEntry[]> {
  return await listBundles(config.bundleBasePath);
}

export async function resolveToolsDevBundle(input: {
  config: Pick<ToolDevConfig, "bundleBasePath">;
  ref: BundleRef;
}): Promise<BundleResolved> {
  return await resolveBundle({
    basePath: input.config.bundleBasePath,
    ref: input.ref,
  });
}

export async function deleteToolsDevBundle(input: {
  config: Pick<ToolDevConfig, "bundleBasePath">;
  ref: BundleRef;
}): Promise<boolean> {
  return await deleteBundle({
    basePath: input.config.bundleBasePath,
    ref: input.ref,
  });
}

export async function resolveToolsDevWebImplementation(config: ToolDevConfig): Promise<ToolsDevResolvedWebImplementation> {
  const activation = await readToolsDevActivation(config);
  const source = activation.web;

  if (source.type === "workspace") {
    return {
      entryPath: config.apps.web.sidecarEntryPath,
      implementation: null,
      source,
    };
  }

  if (source.type === "explicitPath") {
    const entryPath = path.resolve(source.entryPath);
    if (!(await pathExists(entryPath))) {
      throw new Error(`tools-dev explicit web sidecar entry does not exist: ${entryPath}`);
    }
    return {
      entryPath,
      implementation: {
        entryPath,
        persistent: source.persistent,
        source: "explicitPath",
      },
      source: {
        ...source,
        entryPath,
      },
    };
  }

  const bundle = await resolveBundle({
    basePath: config.bundleBasePath,
    ref: source.ref,
  });
  const entryPath = path.resolve(bundle.path, source.entry);
  if (!containsPath(bundle.path, entryPath)) {
    throw new Error(`tools-dev bundle web sidecar entry escaped bundle content: ${source.entry}`);
  }
  if (!(await pathExists(entryPath))) {
    throw new Error(`tools-dev bundle web sidecar entry does not exist: ${entryPath}`);
  }

  return {
    entryPath,
    implementation: {
      basePath: bundle.basePath,
      bundlePath: bundle.path,
      entryPath,
      metadataPath: bundle.metadataPath,
      ref: bundle.ref,
      source: "bundle",
    },
    source,
  };
}

export function sidecarImplementationEnv(
  implementation: SidecarImplementationSnapshot | null,
): NodeJS.ProcessEnv {
  return implementation == null
    ? {}
    : { [SIDECAR_ENV.IMPLEMENTATION]: JSON.stringify(implementation) };
}
