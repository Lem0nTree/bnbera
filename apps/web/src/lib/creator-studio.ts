import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertSafePublicNetworkTarget } from "@bnbera/agent-ingestion";
import { canonicalRuntimeConfigurationDigest } from "./creator-contract";
import type { CreatorStudioAdapter, CreatorStudioCommandDiagnostic, CreatorStudioCommandResult } from "./creator-worker";

export type StudioReadiness = { readonly ready: boolean; readonly reason: string };

const managedStudioSdkPackage = "@altananetwork/sdk";
const managedStudioSdkVersion = "0.7.1";
const managedStudioSdkIntegrity = "sha512-C1XCliQl4NRiHs5LwNtU2BmjqfB2MZWYR+e31ZmsH8fGs7l0bFiA/w5ufmzWj6LaXUYLQnpt6lI5kIQthNHY4Q==";
const managedStudioSdkScope = "managed-studio-0.0.13";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasManagedStudioSdkLock(toolchain: Record<string, unknown> | undefined): boolean {
  const sdk = toolchain?.agentStudioAltanaSdk;
  return record(sdk) && sdk.package === managedStudioSdkPackage && sdk.version === managedStudioSdkVersion && sdk.integrity === managedStudioSdkIntegrity && sdk.scope === managedStudioSdkScope && sdk.verificationStatus === "pinned-from-npm-registry";
}

/** Read the lock rather than accepting package/version values from a request. */
export function studioReadiness(lock: unknown): StudioReadiness {
  try {
    const toolchain = record(lock) && record(lock.toolchain) ? lock.toolchain : undefined;
    const cli = toolchain?.agentStudioCli as Record<string, unknown> | undefined;
    const runtime = toolchain?.agentStudioRuntime as Record<string, unknown> | undefined;
    if (cli?.package !== "@bnbagent/studio-cli" || cli.version !== "0.0.13" || typeof cli.integrity !== "string") {
      return { ready: false, reason: "The reviewed Studio CLI 0.0.13 pin is unavailable." };
    }
    if (runtime?.package !== "@bnbagent/studio-runtime" || runtime.version !== "0.0.13" || typeof runtime.integrity !== "string" || runtime.verificationStatus !== "pinned-from-npm-registry") {
      return { ready: false, reason: "Studio runtime 0.0.13 integrity is not verified in the standards lock." };
    }
    if (!hasManagedStudioSdkLock(toolchain)) {
      return { ready: false, reason: "Managed Studio 0.0.13 requires the standards-locked Altana SDK 0.7.1 pin." };
    }
    return { ready: true, reason: "Studio CLI/runtime and managed Altana SDK pins are verified." };
  } catch { return { ready: false, reason: "Studio standards lock is unreadable." }; }
}

export function readCreatorStandardsLock(): unknown {
  // Turbopack represents `import.meta.url` with a URL-shaped shim that Node's
  // fs APIs do not accept as a native URL. Resolve an ordinary filesystem
  // string for both repository-root tools and `apps/web` production runtime.
  const path = [
    resolve(process.cwd(), "config/standards.lock.json"),
    resolve(process.cwd(), "../config/standards.lock.json"),
    resolve(process.cwd(), "../../config/standards.lock.json"),
  ].find((candidate) => existsSync(candidate));
  if (path === undefined) throw new Error("CREATOR_STANDARDS_LOCK_UNAVAILABLE");
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

/** Native Studio invocation shape; only used after readiness and T6 authority checks. */
/** Native, non-interactive Studio deploy. The T6 secret reference is handed
 * to Studio by its owner; it is never an argument or persisted here. */
export function nativeStudioDeployCommand(projectRoot: string): readonly string[] {
  if (!projectRoot.startsWith("/")) throw new Error("Creator Studio project root must be absolute.");
  return ["bag", "deploy", "--provider", "bnb", "--project-root", projectRoot, "--yes"];
}

/**
 * Install only the reviewed template graph. This runs from the generated
 * workspace root so the checked-in root lockfile, rather than an app-local or
 * ambient lockfile, owns resolution.
 */
export function nativeStudioInstallCommand(projectRoot: string): readonly string[] {
  if (!projectRoot.startsWith("/")) throw new Error("Creator Studio project root must be absolute.");
  return ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts", "--force", "--store-dir", nativeStudioWorkspaceStoreDirectory(projectRoot)];
}

/**
 * Keep package-manager/Studio scratch files beside the private workspace.
 * Host `/tmp` may be quota-limited, and this directory is never part of the
 * generated runtime artifact because it lives at the workspace-parent level.
 */
export function nativeStudioWorkspaceTempDirectory(workspaceParent: string): string {
  if (!workspaceParent.startsWith("/")) throw new Error("Creator Studio workspace parent must be absolute.");
  return ensurePrivateWorkspaceDirectory(join(workspaceParent, ".creator-tmp"));
}

/** Keep pnpm's content-addressed store outside the generated runtime root. */
export function nativeStudioWorkspaceStoreDirectory(projectRoot: string): string {
  if (!projectRoot.startsWith("/")) throw new Error("Creator Studio project root must be absolute.");
  return join(dirname(projectRoot), ".pnpm-store");
}

function ensurePrivateWorkspaceDirectory(directory: string): string {
  try {
    const stat = lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Creator Studio temp directory is not private.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    mkdirSync(directory, { mode: 0o700 });
  }
  chmodSync(directory, 0o700);
  return directory;
}

export function nativeStudioStatusCommand(projectRoot: string): readonly string[] {
  if (!projectRoot.startsWith("/")) throw new Error("Creator Studio project root must be absolute.");
  return ["bag", "deploy", "status", "--provider", "bnb", "--project-root", projectRoot, "--json", "--no-probe"];
}

export type StudioDeploymentRecord = { readonly deploymentId: string; readonly endpoint: string | null };

/** Shape documented by Studio 0.0.13's `bag deploy status --json`. */
export function parseNativeStudioStatus(output: string): StudioDeploymentRecord | null {
  try {
    const parsed = JSON.parse(output) as { deployments?: readonly { provider?: unknown; deployment_id?: unknown; recorded_endpoint?: unknown }[] };
    const record = parsed.deployments?.find((item) => item.provider === "bnb");
    if (typeof record?.deployment_id !== "string" || record.deployment_id.length === 0 || record.deployment_id.length > 2_000) return null;
    const endpoint = typeof record.recorded_endpoint === "string" && /^https:\/\//.test(record.recorded_endpoint) ? record.recorded_endpoint : null;
    return { deploymentId: record.deployment_id, endpoint };
  } catch { return null; }
}

const templateArtifactPaths = ["README.md", "package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", "app/agent/package.json", "app/agent/studio.toml", "app/agent/tsconfig.json", "app/agent/src/unifiedMain.ts"] as const;
export type CreatorPublicRuntimeConfig = { readonly protocol: "pancakeswap-v2"; readonly tradingPair: "tbnb-cake" | "tbnb-busd"; readonly inputAmountWei: "100000000000000" | "500000000000000" | "1000000000000000"; readonly slippageBps: 10 | 25 | 50; readonly quoteMaxAgeSeconds: 30 | 60; readonly deadlineSeconds: 60 | 120 };
const publicConfigSourcePath = "app/agent/src/bnbera-public-config.ts";
const studioConfigSourcePath = "app/agent/studio.toml";
const generatedGitignorePath = ".gitignore";
const generatedGitignoreBytes = ".studio/\n";
const platformSlugPattern = /^[a-z][a-z0-9-]{1,40}$/u;
const walletAddressPattern = /^0x[0-9a-f]{40}$/iu;

/**
 * Studio's BNB provider uses this value as the project and platform slug.
 * Runtime names are generated server-side from the draft id, so retaining the
 * name in the slug makes deployments deterministic and distinct without
 * allowing arbitrary user text into a provider identifier.
 */
export function creatorStudioProjectSlug(runtimeName: string): string {
  if (!platformSlugPattern.test(runtimeName)) throw new Error("CREATOR_STUDIO_RUNTIME_NAME_INVALID");
  const slug = `bnbera-${runtimeName}`;
  if (!platformSlugPattern.test(slug)) throw new Error("CREATOR_STUDIO_SLUG_INVALID");
  return slug;
}

function canonicalStudioWalletAddress(value: unknown): string | null {
  return typeof value === "string" && walletAddressPattern.test(value) ? value.toLowerCase() : null;
}

function studioSessionPath(root: string): string {
  return join(root, ".studio", "wallets", "altana-session.json");
}

/** Read only the public wallet address from the owner-only handoff file. */
function creatorStudioWalletAddress(root: string): string | null {
  try {
    const rootStat = lstatSync(root);
    const studio = join(root, ".studio");
    const wallets = join(studio, "wallets");
    const sessionPath = studioSessionPath(root);
    const studioStat = lstatSync(studio);
    const walletsStat = lstatSync(wallets);
    const sessionStat = lstatSync(sessionPath);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || studioStat.isSymbolicLink() || !studioStat.isDirectory() || walletsStat.isSymbolicLink() || !walletsStat.isDirectory() || sessionStat.isSymbolicLink() || !sessionStat.isFile() || (rootStat.mode & 0o777) !== 0o700 || (studioStat.mode & 0o777) !== 0o700 || (walletsStat.mode & 0o777) !== 0o700 || (sessionStat.mode & 0o777) !== 0o600) return null;
    const parsed = JSON.parse(readFileSync(sessionPath, "utf8")) as { walletAddress?: unknown };
    return canonicalStudioWalletAddress(parsed.walletAddress);
  } catch { return null; }
}

function tomlSectionBounds(lines: readonly string[], section: string): { readonly start: number; readonly end: number } | null {
  const start = lines.findIndex((line) => line.trim() === `[${section}]`);
  if (start < 0) return null;
  const nextSection = lines.slice(start + 1).findIndex((line) => /^\s*\[[^\]]+\]\s*$/u.test(line));
  return { start, end: nextSection < 0 ? lines.length : start + 1 + nextSection };
}

function bindTomlString(lines: string[], section: string, key: string, value: string, insertAfterKey?: string): boolean {
  const bounds = tomlSectionBounds(lines, section);
  if (bounds === null) return false;
  const keyPattern = new RegExp(`^(\\s*)${key}\\s*=`);
  for (let index = bounds.start + 1; index < bounds.end; index += 1) {
    const match = keyPattern.exec(lines[index]!);
    if (match !== null) {
      lines[index] = `${match[1]}${key} = ${JSON.stringify(value)}`;
      return true;
    }
  }
  const anchorPattern = insertAfterKey === undefined ? null : new RegExp(`^\\s*${insertAfterKey}\\s*=`);
  const anchor = anchorPattern === null ? -1 : lines.slice(bounds.start + 1, bounds.end).findIndex((line) => anchorPattern.test(line));
  const insertAt = anchor < 0 ? bounds.start + 1 : bounds.start + 2 + anchor;
  lines.splice(insertAt, 0, `${key} = ${JSON.stringify(value)}`);
  return true;
}

/**
 * Bind only the creator identity fields. All other audited Studio TOML stays
 * byte-for-byte equal to the checked-in template.
 */
function boundStudioConfigBytes(source: string, runtimeName: string, walletAddress: string): string {
  const slug = creatorStudioProjectSlug(runtimeName);
  const address = canonicalStudioWalletAddress(walletAddress);
  if (address === null) throw new Error("CREATOR_STUDIO_WALLET_ADDRESS_INVALID");
  const lines = source.split("\n");
  if (!bindTomlString(lines, "project", "name", slug)) throw new Error("CREATOR_STUDIO_PROJECT_NAME_MISSING");
  if (!bindTomlString(lines, "deploy.platform", "slug", slug)) {
    const deploy = tomlSectionBounds(lines, "deploy");
    if (deploy === null) throw new Error("CREATOR_STUDIO_DEPLOY_SECTION_MISSING");
    lines.splice(deploy.end, 0, "", "[deploy.platform]", `slug = ${JSON.stringify(slug)}`);
  }
  if (!bindTomlString(lines, "wallet", "address", address, "kind")) throw new Error("CREATOR_STUDIO_WALLET_SECTION_MISSING");
  return lines.join("\n");
}

function templateArtifactRoot(): string {
  const candidates = [
    process.env.BNBERA_CREATOR_TEMPLATE_ROOT,
    resolve(process.cwd(), "templates/pancakeswap-one-shot"),
    resolve(process.cwd(), "../templates/pancakeswap-one-shot"),
    resolve(process.cwd(), "../../templates/pancakeswap-one-shot"),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  const root = candidates.find((value) => existsSync(join(value, "app/agent/studio.toml")));
  if (root === undefined) throw new Error("CREATOR_TEMPLATE_ARTIFACT_UNAVAILABLE");
  return root;
}

/**
 * The generated workspace is deployable only when its package and root lock
 * resolve the managed Studio SDK context. The browser/toolchain SDK 0.9.0 is
 * intentionally a different lock entry and must never leak into this graph.
 */
function hasReviewedManagedStudioTemplate(root: string): boolean {
  try {
    const lock = readCreatorStandardsLock();
    const toolchain = record(lock) && record(lock.toolchain) ? lock.toolchain : undefined;
    if (!hasManagedStudioSdkLock(toolchain)) return false;
    const packageJson = JSON.parse(readFileSync(join(root, "app/agent/package.json"), "utf8")) as unknown;
    if (!record(packageJson) || !record(packageJson.dependencies) || packageJson.dependencies[managedStudioSdkPackage] !== managedStudioSdkVersion) return false;
    const lockText = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
    const importerPin = `      '${managedStudioSdkPackage}':\n        specifier: ${managedStudioSdkVersion}\n        version: ${managedStudioSdkVersion}(`;
    const packagePin = `  '${managedStudioSdkPackage}@${managedStudioSdkVersion}':\n    resolution: {integrity: ${managedStudioSdkIntegrity}}`;
    return lockText.includes(importerPin) && lockText.includes(packagePin);
  } catch { return false; }
}

function canonicalPublicRuntimeConfig(input: unknown): CreatorPublicRuntimeConfig {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("CREATOR_PUBLIC_CONFIG_INVALID");
  const value = input as Record<string, unknown>;
  const tradingPair = value.tradingPair === "tbnb-cake" ? "tbnb-cake" : value.tradingPair === "tbnb-busd" ? "tbnb-busd" : undefined;
  const inputAmountWei = value.inputAmountWei === "100000000000000" ? "100000000000000" : value.inputAmountWei === "500000000000000" ? "500000000000000" : value.inputAmountWei === "1000000000000000" ? "1000000000000000" : undefined;
  const slippageBps = value.slippageBps === 10 ? 10 : value.slippageBps === 25 ? 25 : value.slippageBps === 50 ? 50 : undefined;
  const quoteMaxAgeSeconds = value.quoteMaxAgeSeconds === 30 ? 30 : value.quoteMaxAgeSeconds === 60 ? 60 : undefined;
  const deadlineSeconds = value.deadlineSeconds === 60 ? 60 : value.deadlineSeconds === 120 ? 120 : undefined;
  if (Object.keys(value).length !== 6 || value.protocol !== "pancakeswap-v2" || tradingPair === undefined || inputAmountWei === undefined || slippageBps === undefined || quoteMaxAgeSeconds === undefined || deadlineSeconds === undefined) throw new Error("CREATOR_PUBLIC_CONFIG_INVALID");
  return { protocol: "pancakeswap-v2", tradingPair, inputAmountWei, slippageBps, quoteMaxAgeSeconds, deadlineSeconds };
}
function runtimeDigest(config: unknown): string { return canonicalRuntimeConfigurationDigest(canonicalPublicRuntimeConfig(config)); }
/** Generate source from validated enum values; arbitrary source text is never accepted. */
function publicConfigSourceBytes(config: unknown, digest: unknown): string {
  const canonical = canonicalPublicRuntimeConfig(config);
  const expectedDigest = runtimeDigest(canonical);
  if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest) || digest !== expectedDigest) throw new Error("CREATOR_PUBLIC_CONFIG_DIGEST_MISMATCH");
  const literal = (value: string | number): string => JSON.stringify(value);
  return [
    "/* Generated by BNBEra Creator materialization; do not edit. */",
    "export const configuration = {",
    `  protocol: ${literal(canonical.protocol)},`,
    `  tradingPair: ${literal(canonical.tradingPair)},`,
    `  inputAmountWei: ${literal(canonical.inputAmountWei)},`,
    `  slippageBps: ${literal(canonical.slippageBps)},`,
    `  quoteMaxAgeSeconds: ${literal(canonical.quoteMaxAgeSeconds)},`,
    `  deadlineSeconds: ${literal(canonical.deadlineSeconds)},`,
    "} as const;",
    `export const configurationDigest = ${literal(digest)};`,
    "",
  ].join("\n");
}
/** The handoff may precede scaffold, but only for the sink's exact state. */
function hasApprovedStudioState(root: string): boolean {
  try {
    const rootStat = lstatSync(root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return false;
    const studio = join(root, ".studio");
    const studioStat = lstatSync(studio);
    if (studioStat.isSymbolicLink() || !studioStat.isDirectory()) return false;
    const studioEntries = readdirSync(studio, { withFileTypes: true });
    if (studioEntries.length !== 1 || studioEntries[0]?.name !== "wallets" || studioEntries[0].isSymbolicLink() || !studioEntries[0].isDirectory()) return false;
    const wallets = join(studio, "wallets");
    const walletsStat = lstatSync(wallets);
    const walletEntries = readdirSync(wallets, { withFileTypes: true });
    if (walletEntries.length !== 1 || walletEntries[0]?.name !== "altana-session.json" || walletEntries[0].isSymbolicLink() || !walletEntries[0].isFile()) return false;
    const session = lstatSync(join(wallets, "altana-session.json"));
    return !walletsStat.isSymbolicLink() && (rootStat.mode & 0o777) === 0o700 && (studioStat.mode & 0o777) === 0o700 && (walletsStat.mode & 0o777) === 0o700 && (session.mode & 0o777) === 0o600;
  } catch { return false; }
}

const expectedArtifactDirectories = new Set(["app", "app/agent", "app/agent/src"]);
const expectedArtifactFiles = new Set<string>([...templateArtifactPaths, generatedGitignorePath, publicConfigSourcePath]);

/**
 * Validate the shape of a workspace without requiring the immutable files to
 * be complete. Existing files are never trusted merely because their parent
 * directory is allowed: every source file must be a regular, non-symlink
 * file, and every non-generated path must be in the reviewed manifest.
 */
function validWorkspaceEntries(root: string): boolean {
  try {
    const rootStat = lstatSync(root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return false;
    const pathIsApprovedDependencyTarget = (path: string): boolean => {
      const targetRelative = relative(root, path);
      if (targetRelative === "app/agent") return true;
      return ["node_modules", "app/agent/node_modules"].some(
        (dependencyRoot) => targetRelative === dependencyRoot || targetRelative.startsWith(`${dependencyRoot}${sep}`),
      );
    };
    const walk = (directory: string, prefix: string, generatedAncestor: boolean, nodeModulesAncestor: boolean): boolean => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const relative = `${prefix}${entry.name}`;
        const path = join(directory, entry.name);
        const stat = lstatSync(path);
        // pnpm's isolated linker creates dependency links inside node_modules.
        // Those links are generated output, but source files, .studio state,
        // and the node_modules directory itself must never be symlinks. Read
        // the link text instead of realpath so an interrupted install with a
        // dangling dependency link can still be retried safely; a resolved
        // target must remain in an approved dependency tree. pnpm's workspace
        // package link legitimately targets the exact app/agent package.
        if (stat.isSymbolicLink()) {
          if (!nodeModulesAncestor) return false;
          let target: string;
          try { target = resolve(dirname(path), readlinkSync(path)); } catch { return false; }
          if (!pathIsApprovedDependencyTarget(target)) return false;
          continue;
        }
        // Only the workspace/package dependency trees and known build output
        // are generated. A basename such as `dist` or `node_modules` inside
        // reviewed source must not turn an arbitrary path into an allowlist.
        const entersNodeModules = nodeModulesAncestor || (entry.name === "node_modules" && (relative === "node_modules" || relative === "app/agent/node_modules"));
        const generated = generatedAncestor || entersNodeModules || (entry.name === ".studio" && relative === ".studio") || ((entry.name === "dist" || entry.name === "build" || entry.name === ".next") && relative === `app/agent/${entry.name}`);
        if (stat.isDirectory()) {
          if (!generated && !expectedArtifactDirectories.has(relative)) return false;
          if (entry.name === "node_modules" && !nodeModulesAncestor && !entersNodeModules) return false;
          if (!walk(path, `${relative}/`, generated, entersNodeModules)) return false;
        } else {
          if (!stat.isFile() || (!generated && !expectedArtifactFiles.has(relative))) return false;
        }
      }
      return true;
    };
    return walk(root, "", false, false);
  } catch { return false; }
}

function expectedArtifactBytes(source: string, runtimeName: string, walletAddress: string | null, path: string, config?: CreatorPublicRuntimeConfig, digest?: string): Buffer {
  if (path === studioConfigSourcePath && config !== undefined && digest !== undefined && walletAddress !== null) {
    return Buffer.from(boundStudioConfigBytes(readFileSync(join(source, path), "utf8"), runtimeName, walletAddress));
  }
  if (path === generatedGitignorePath) return Buffer.from(generatedGitignoreBytes);
  if (path === publicConfigSourcePath) return Buffer.from(publicConfigSourceBytes(config, digest));
  return readFileSync(join(source, path));
}

function existingFileMatches(path: string, expected: Buffer): boolean {
  try {
    const stat = lstatSync(path);
    return !stat.isSymbolicLink() && stat.isFile() && readFileSync(path).equals(expected);
  } catch { return false; }
}

/** A workspace is reusable only when it is exactly the reviewed artifact. */
function hasExactTemplateArtifact(root: string, runtimeName: string, config?: CreatorPublicRuntimeConfig, digest?: string): boolean {
  try {
    const rootStat = lstatSync(root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return false;
    if (!validWorkspaceEntries(root)) return false;
    const source = templateArtifactRoot();
    if (!hasReviewedManagedStudioTemplate(source)) return false;
    const walletAddress = config !== undefined && digest !== undefined ? creatorStudioWalletAddress(root) : null;
    return [...templateArtifactPaths, generatedGitignorePath, publicConfigSourcePath].every((path) => existingFileMatches(join(root, path), expectedArtifactBytes(source, runtimeName, walletAddress, path, config, digest))) && (config === undefined || digest === undefined || walletAddress !== null);
  } catch { return false; }
}

function existingArtifactContentsMatch(root: string, source: string, runtimeName: string, walletAddress: string, config: CreatorPublicRuntimeConfig, digest: string): boolean {
  return [...templateArtifactPaths, generatedGitignorePath, publicConfigSourcePath].every((path) => {
    const target = join(root, path);
    try {
      lstatSync(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      return false;
    }
    return existingFileMatches(target, expectedArtifactBytes(source, runtimeName, walletAddress, path, config, digest));
  });
}

/** Write only a missing file, reconciling an identical concurrent write. */
function writeMissingFile(path: string, bytes: Buffer): void {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Creator Studio artifact path is not a regular file.");
    if (!readFileSync(path).equals(bytes)) throw new Error("Creator Studio artifact differs from the reviewed source.");
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    writeFileSync(path, bytes, { flag: "wx", mode: 0o644 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !existingFileMatches(path, bytes)) throw error;
  }
}

/** Probe the deployed provider rather than treating a status record as live. */
export function nativeStudioPingUrl(endpoint: string): URL {
  const target = new URL(endpoint);
  return new URL(`${target.pathname.replace(/\/+$/, "")}/ping`, target.origin);
}

/** Studio's managed A2A endpoint is returned as this public card URL. */
export function isNativeStudioAgentCardUrl(endpoint: string | URL): boolean {
  const target = typeof endpoint === "string" ? new URL(endpoint) : endpoint;
  const pathname = target.pathname.replace(/\/+$/u, "");
  return pathname === "/.well-known/agent-card.json" || pathname.endsWith("/.well-known/agent-card.json");
}

/** Keep public health probing separate from authenticated A2A invocation. */
export function nativeStudioProbeUrl(endpoint: string): URL {
  const target = new URL(endpoint);
  return isNativeStudioAgentCardUrl(target) ? target : nativeStudioPingUrl(target.toString());
}

function validCreatorAgentCard(body: unknown): boolean {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return false;
  const card = body as { protocolVersion?: unknown; preferredTransport?: unknown; defaultInputModes?: unknown; defaultOutputModes?: unknown; skills?: unknown };
  const hasJsonMode = (value: unknown): boolean => Array.isArray(value) && value.includes("application/json");
  const hasExecuteSkill = Array.isArray(card.skills) && card.skills.some((skill) => skill !== null && typeof skill === "object" && !Array.isArray(skill) && (skill as { id?: unknown }).id === "execute_swap");
  return card.protocolVersion === "0.3.0" && card.preferredTransport === "JSONRPC" && hasJsonMode(card.defaultInputModes) && hasJsonMode(card.defaultOutputModes) && hasExecuteSkill;
}

async function verifyNativeStudioEndpoint(endpoint: string): Promise<boolean> {
  try {
    const target = await assertSafePublicNetworkTarget(endpoint);
    if (target.protocol !== "https:") return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const probe = nativeStudioProbeUrl(target.toString());
      const response = await fetch(probe, { method: "GET", signal: controller.signal, redirect: "error" });
      if (!response.ok) return false;
      const body = await response.json() as unknown;
      if (isNativeStudioAgentCardUrl(target)) return validCreatorAgentCard(body);
      if (body === null || typeof body !== "object" || Array.isArray(body)) return false;
      const health = body as { status?: unknown; template?: unknown };
      return health.status === "healthy" && health.template === "pancakeswap-one-shot";
    } finally { clearTimeout(timer); }
  } catch { return false; }
}

const nativeStudioMaxBuffer = 1_048_576;
const allowedStudioSignals = new Set<CreatorStudioCommandDiagnostic["signal"]>([
  "SIGABRT", "SIGBUS", "SIGFPE", "SIGHUP", "SIGILL", "SIGINT", "SIGKILL", "SIGPIPE", "SIGQUIT", "SIGSEGV", "SIGTERM", "SIGTRAP", "SIGUSR1", "SIGUSR2",
]);
const allowedStudioCodes = new Set<Exclude<CreatorStudioCommandDiagnostic["code"], number | null>>([
  "EACCES", "ENOENT", "ETIMEDOUT", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
]);

function safeStudioCode(value: unknown): CreatorStudioCommandDiagnostic["code"] {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 255) return value;
  if (typeof value === "string" && allowedStudioCodes.has(value as Exclude<CreatorStudioCommandDiagnostic["code"], number | null>)) return value as Exclude<CreatorStudioCommandDiagnostic["code"], number | null>;
  return null;
}

function safeStudioSignal(value: unknown): CreatorStudioCommandDiagnostic["signal"] {
  if (typeof value === "string" && allowedStudioSignals.has(value as CreatorStudioCommandDiagnostic["signal"])) return value as Exclude<CreatorStudioCommandDiagnostic["signal"], null>;
  return null;
}

/** Convert a child-process error into bounded public diagnostics only. */
export function classifyNativeStudioProcessError(error: unknown): CreatorStudioCommandResult {
  const value = record(error) ? error : {};
  const code = safeStudioCode(value.code);
  const signal = safeStudioSignal(value.signal);
  const outputOverflow = code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
  const timedOut = value.killed === true;
  const reasonCode = outputOverflow
    ? "STUDIO_COMMAND_OUTPUT_OVERFLOW"
    : timedOut
      ? "STUDIO_COMMAND_TIMEOUT"
      : signal === null
        ? "STUDIO_COMMAND_FAILED"
        : "STUDIO_COMMAND_SIGNAL";
  return {
    exitCode: typeof code === "number" && code > 0 ? code : 1,
    reasonCode,
    diagnostic: { code, signal, timedOut, outputOverflow },
  };
}

/** Bounded native CLI adapter. `execFile` deliberately uses shell:false. */
export function nativeStudioProcessAdapter(): CreatorStudioAdapter {
  const execute = async (command: readonly string[], cwd: string) => {
    const projectRootArgument = command.indexOf("--project-root");
    const commandRoot = projectRootArgument >= 0 ? command[projectRootArgument + 1] : cwd;
    const tempDirectory = nativeStudioWorkspaceTempDirectory(dirname(commandRoot ?? cwd));
    const storeDirectory = ensurePrivateWorkspaceDirectory(nativeStudioWorkspaceStoreDirectory(commandRoot ?? cwd));
    const result = await promisify(execFile)(command[0]!, command.slice(1), {
      cwd,
      env: { ...process.env, TMPDIR: tempDirectory, TMP: tempDirectory, TEMP: tempDirectory, npm_config_store_dir: storeDirectory },
      shell: false,
      timeout: 120_000,
      maxBuffer: nativeStudioMaxBuffer,
      windowsHide: true,
    });
    return String(result.stdout);
  };
  const runBoundedCommand = async (command: readonly string[], cwd: string) => {
    try { await execute(command, cwd); return { exitCode: 0, reasonCode: "STUDIO_COMMAND_OK" as const }; }
    catch (error) { return classifyNativeStudioProcessError(error); }
  };
  return {
    async inspect(workspaceParent, runtimeName, config, digest) {
      return hasExactTemplateArtifact(join(workspaceParent, runtimeName), runtimeName, config, digest) ? "STUDIO_TEMPLATE_READY" : "STUDIO_TEMPLATE_MISMATCH";
    },
    async materialize(workspaceParent, runtimeName, config, digest) {
      const destination = join(workspaceParent, runtimeName);
      const source = templateArtifactRoot();
      if (config === undefined || digest === undefined) return "STUDIO_TEMPLATE_MISMATCH";
      if (!hasReviewedManagedStudioTemplate(source)) return "STUDIO_TEMPLATE_MISMATCH";
      if (existsSync(destination)) {
        if (hasExactTemplateArtifact(destination, runtimeName, config, digest)) return "STUDIO_TEMPLATE_READY";
        // The browser handoff can create the approved sibling `.studio` state
        // before this worker gets its first scaffold tick. Keep that state and
        // fill only the missing immutable source artifact.
        if (!validWorkspaceEntries(destination) || !hasApprovedStudioState(destination)) return "STUDIO_TEMPLATE_MISMATCH";
      }
      const walletAddress = creatorStudioWalletAddress(destination);
      if (walletAddress === null) return "STUDIO_TEMPLATE_MISMATCH";
      if (!existingArtifactContentsMatch(destination, source, runtimeName, walletAddress, config, digest)) return "STUDIO_TEMPLATE_MISMATCH";
      try {
        // Do not recursively copy the template directory: that would copy
        // .gitignore or later generated directories into a workspace whose
        // immutable source manifest deliberately has only the reviewed root
        // manifests, app files, generated ignore file, and digest-bound
        // configuration module.
        for (const path of templateArtifactPaths) {
          const target = join(destination, path);
          mkdirSync(dirname(target), { recursive: true });
          writeMissingFile(target, expectedArtifactBytes(source, runtimeName, walletAddress, path, config, digest));
        }
        writeMissingFile(join(destination, generatedGitignorePath), expectedArtifactBytes(source, runtimeName, walletAddress, generatedGitignorePath, config, digest));
        writeMissingFile(join(destination, publicConfigSourcePath), expectedArtifactBytes(source, runtimeName, walletAddress, publicConfigSourcePath, config, digest));
        return hasExactTemplateArtifact(destination, runtimeName, config, digest) ? "STUDIO_TEMPLATE_READY" : "STUDIO_TEMPLATE_MISMATCH";
      } catch { return hasExactTemplateArtifact(destination, runtimeName, config, digest) ? "STUDIO_TEMPLATE_READY" : "STUDIO_TEMPLATE_MISMATCH"; }
    },
    async install(command, input) { return runBoundedCommand(command, input.cwd); },
    async run(command, input) { return runBoundedCommand(command, input.cwd); },
    async status(command) {
      try { return parseNativeStudioStatus(await execute(command, process.cwd())); } catch { return null; }
    },
    verifyEndpoint: verifyNativeStudioEndpoint
  };
}
