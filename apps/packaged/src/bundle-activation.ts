import { access, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import {
  BundleStoreError,
  resolveBundle,
  validateBundleRef,
  type BundleRef,
} from "@open-design/bundle";
import { SIDECAR_ENV, type SidecarImplementationSnapshot } from "@open-design/sidecar-proto";

import type { PackagedNamespacePaths } from "./paths.js";

export const PACKAGED_WEB_SIDECAR_BUNDLE_KEY = "od:sidecar:web";
export const SIDECAR_IMPLEMENTATION_ENV = SIDECAR_ENV.IMPLEMENTATION;

export type PackagedBundleActivationSource =
  | { type: "builtin" }
  | { entry: string; ref: BundleRef; type: "bundle" };

export type PackagedBundleActivationBinding = {
  source: PackagedBundleActivationSource;
};

export type PackagedBundleActivationFile = {
  bindings: Record<string, PackagedBundleActivationBinding>;
  version: 1;
};

export type PackagedWebSidecarImplementation =
  | {
      entryPath: string | null;
      implementation: Extract<SidecarImplementationSnapshot, { source: "builtin" }>;
    }
  | {
      entryPath: string;
      implementation: Extract<SidecarImplementationSnapshot, { source: "bundle" }>;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function containsPath(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseActivationFile(value: unknown): PackagedBundleActivationFile {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.bindings)) {
    throw new Error("packaged bundle activation must contain version=1 and object bindings");
  }

  const bindings: Record<string, PackagedBundleActivationBinding> = {};
  for (const [key, binding] of Object.entries(value.bindings)) {
    if (!isRecord(binding) || !isRecord(binding.source)) {
      throw new Error(`packaged bundle activation binding ${key} must contain an object source`);
    }
    const type = stringField(binding.source, "type");
    if (type === "builtin") {
      bindings[key] = { source: { type } };
      continue;
    }
    if (type === "bundle") {
      const ref = binding.source.ref;
      const entry = stringField(binding.source, "entry");
      if (!isRecord(ref) || entry == null) {
        throw new Error(`packaged bundle activation binding ${key} must contain ref and entry`);
      }
      const parsedRef = validateBundleRef(ref as BundleRef);
      if (parsedRef.key !== key) {
        throw new Error(`packaged bundle activation binding ${key} ref key must match its binding key`);
      }
      bindings[key] = {
        source: {
          entry,
          ref: parsedRef,
          type,
        },
      };
      continue;
    }
    throw new Error(`unsupported packaged bundle activation source for ${key}: ${String(type)}`);
  }

  return { bindings, version: 1 };
}

async function readActivation(path: string): Promise<PackagedBundleActivationFile | null> {
  try {
    return parseActivationFile(JSON.parse(await readFile(path, "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function builtin(entryPath: string | null, fallbackReason?: string): PackagedWebSidecarImplementation {
  return {
    entryPath,
    implementation: {
      source: "builtin",
      ...(entryPath == null ? {} : { entryPath }),
      ...(fallbackReason == null ? {} : { fallbackReason }),
    },
  };
}

export async function resolvePackagedWebSidecarImplementation(options: {
  builtinEntryPath: string | null;
  paths: PackagedNamespacePaths;
}): Promise<PackagedWebSidecarImplementation> {
  let activation: PackagedBundleActivationFile | null;
  try {
    activation = await readActivation(options.paths.bundleActivationPath);
  } catch (error) {
    return builtin(options.builtinEntryPath, `activation-invalid:${error instanceof Error ? error.message : String(error)}`);
  }

  const binding = activation?.bindings[PACKAGED_WEB_SIDECAR_BUNDLE_KEY];
  if (binding == null) return builtin(options.builtinEntryPath, activation == null ? "activation-missing" : "binding-missing");
  if (binding.source.type === "builtin") return builtin(options.builtinEntryPath, "binding-builtin");

  try {
    const resolved = await resolveBundle({
      basePath: options.paths.bundleBasePath,
      ref: binding.source.ref,
    });
    const entryPath = resolve(resolved.path, binding.source.entry);
    if (!containsPath(resolved.path, entryPath)) {
      return builtin(options.builtinEntryPath, "bundle-entry-escaped");
    }
    if (!(await pathExists(entryPath))) {
      return builtin(options.builtinEntryPath, "bundle-entry-missing");
    }
    return {
      entryPath,
      implementation: {
        basePath: resolved.basePath,
        bundlePath: resolved.path,
        entryPath,
        metadataPath: resolved.metadataPath,
        ref: resolved.ref,
        source: "bundle",
      },
    };
  } catch (error) {
    const reason = error instanceof BundleStoreError ? `${error.code}:${error.message}` : error instanceof Error ? error.message : String(error);
    return builtin(options.builtinEntryPath, `bundle-unresolved:${reason}`);
  }
}

export function sidecarImplementationEnv(
  implementation: SidecarImplementationSnapshot,
): NodeJS.ProcessEnv {
  return {
    [SIDECAR_IMPLEMENTATION_ENV]: JSON.stringify(implementation),
  };
}

export function createPackagedBundleActivationFile(input: {
  web: PackagedBundleActivationSource;
}): PackagedBundleActivationFile {
  return {
    bindings: {
      [PACKAGED_WEB_SIDECAR_BUNDLE_KEY]: {
        source: input.web,
      },
    },
    version: 1,
  };
}

export function packagedBundleActivationPath(paths: Pick<PackagedNamespacePaths, "dataRoot">): string {
  return join(paths.dataRoot, "bundle-activation.json");
}
