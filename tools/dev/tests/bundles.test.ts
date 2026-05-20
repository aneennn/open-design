import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import type { ToolDevConfig } from "../src/config.js";
import {
  TOOLS_DEV_WEB_BUNDLE_ENTRY,
  addToolsDevBundle,
  deleteToolsDevBundle,
  listToolsDevBundles,
  normalizeToolsDevBundleRef,
  readToolsDevActivation,
  resolveToolsDevWebImplementation,
  writeToolsDevWebSource,
} from "../src/bundles.js";

async function makeTempConfig(): Promise<ToolDevConfig> {
  const root = await mkdtemp(path.join(tmpdir(), "od-tools-dev-bundles-"));
  const dataRoot = path.join(root, "data");
  return {
    apps: {
      daemon: {
        app: "daemon",
        ipcPath: path.join(root, "daemon.sock"),
        latestLogPath: path.join(root, "logs", "daemon", "latest.log"),
        logDir: path.join(root, "logs", "daemon"),
        sidecarEntryPath: path.join(root, "daemon-sidecar.ts"),
      },
      desktop: {
        app: "desktop",
        electronBinaryPath: "electron",
        ipcPath: path.join(root, "desktop.sock"),
        latestLogPath: path.join(root, "logs", "desktop", "latest.log"),
        logDir: path.join(root, "logs", "desktop"),
        mainEntryPath: path.join(root, "desktop.js"),
        packageJsonPath: path.join(root, "package.json"),
      },
      web: {
        app: "web",
        ipcPath: path.join(root, "web.sock"),
        latestLogPath: path.join(root, "logs", "web", "latest.log"),
        logDir: path.join(root, "logs", "web"),
        nextDistDir: path.join(root, "runtime", "web", "next"),
        nextTsconfigPath: path.join(root, "runtime", "web", "tsconfig.json"),
        sidecarEntryPath: path.join(root, "workspace", "apps", "web", "sidecar", "index.ts"),
      },
    },
    bundleActivationPath: path.join(dataRoot, "tools-dev-activation.json"),
    bundleBasePath: path.join(dataRoot, "bundles"),
    dataRoot,
    namespace: "test",
    namespaceRoot: root,
    toolsDevRoot: root,
    tsxCliPath: "tsx",
    workspaceRoot: path.join(root, "workspace"),
  };
}

async function makeBundleSource(root: string): Promise<string> {
  const source = path.join(root, "source");
  await mkdir(path.join(source, "sidecar"), { recursive: true });
  await writeFile(path.join(source, "sidecar", "index.ts"), "export {};\n", "utf8");
  await writeFile(path.join(source, "package.json"), "{\"name\":\"@open-design/web\"}\n", "utf8");
  return source;
}

describe("tools-dev bundles", () => {
  it("defaults to the workspace web sidecar when no activation exists", async () => {
    const config = await makeTempConfig();

    const activation = await readToolsDevActivation(config);
    const implementation = await resolveToolsDevWebImplementation(config);

    assert.deepEqual(activation, { version: 1, web: { type: "workspace" } });
    assert.equal(implementation.entryPath, config.apps.web.sidecarEntryPath);
    assert.equal(implementation.implementation, null);
  });

  it("stores bundle directories through packages/bundle and resolves active web source", async () => {
    const config = await makeTempConfig();
    const sourcePath = await makeBundleSource(config.namespaceRoot);
    const ref = normalizeToolsDevBundleRef({ version: "dev.1" });

    const added = await addToolsDevBundle({ config, ref, sourcePath });
    await writeToolsDevWebSource(config, {
      entry: TOOLS_DEV_WEB_BUNDLE_ENTRY,
      ref,
      type: "bundle",
    });
    const implementation = await resolveToolsDevWebImplementation(config);
    const bundles = await listToolsDevBundles(config);

    assert.equal(added.ref.key, "od:sidecar:web");
    assert.equal(bundles.length, 1);
    assert.equal(implementation.entryPath, path.join(added.path, TOOLS_DEV_WEB_BUNDLE_ENTRY));
    assert.equal(implementation.implementation?.source, "bundle");
    if (implementation.implementation?.source !== "bundle") throw new Error("expected bundle implementation");
    assert.equal(implementation.implementation.basePath, config.bundleBasePath);
    assert.equal(implementation.implementation.bundlePath, added.path);
    assert.deepEqual(implementation.implementation.ref, ref);
  });

  it("rejects bundle web entries that escape the resolved bundle path", async () => {
    const config = await makeTempConfig();
    const sourcePath = await makeBundleSource(config.namespaceRoot);
    const ref = normalizeToolsDevBundleRef({ version: "dev.2" });

    await addToolsDevBundle({ config, ref, sourcePath });
    await writeToolsDevWebSource(config, {
      entry: "../sidecar/index.ts",
      ref,
      type: "bundle",
    });

    await assert.rejects(resolveToolsDevWebImplementation(config), /escaped bundle content/);
  });

  it("records explicit web sidecar paths without adding them to the bundle store", async () => {
    const config = await makeTempConfig();
    const entryPath = path.join(config.namespaceRoot, "explicit", "index.ts");
    await mkdir(path.dirname(entryPath), { recursive: true });
    await writeFile(entryPath, "export {};\n", "utf8");

    await writeToolsDevWebSource(config, {
      entryPath,
      persistent: true,
      type: "explicitPath",
    });
    const implementation = await resolveToolsDevWebImplementation(config);
    const bundles = await listToolsDevBundles(config);

    assert.deepEqual(bundles, []);
    assert.equal(implementation.entryPath, entryPath);
    assert.deepEqual(implementation.implementation, {
      entryPath,
      persistent: true,
      source: "explicitPath",
    });
  });

  it("deletes stored bundle refs through packages/bundle", async () => {
    const config = await makeTempConfig();
    const sourcePath = await makeBundleSource(config.namespaceRoot);
    const ref = normalizeToolsDevBundleRef({ version: "dev.3" });

    await addToolsDevBundle({ config, ref, sourcePath });

    assert.equal(await deleteToolsDevBundle({ config, ref }), true);
    assert.equal(await deleteToolsDevBundle({ config, ref }), false);
    assert.deepEqual(await listToolsDevBundles(config), []);
  });
});
