// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

/** Child result. Callers must not log stdout from keychain or verify commands. */
export type RunResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

export type Runner = (
  command: string,
  args: readonly string[],
  stdin?: string,
  timeoutMs?: number,
) => Promise<RunResult>;

export type HelperReply = {
  ok?: boolean;
  reason?: string;
  locked?: boolean;
  windows?: Array<{
    windowId?: number;
    title?: string;
    app?: string;
    bounds?: { x?: number; y?: number; width?: number; height?: number };
  }>;
};

const DEFAULT_TIMEOUT_MS = 45_000;

let runner: Runner = defaultRun;

export function setRunForTests(next: Runner | null): void {
  runner = next ?? defaultRun;
}

export function run(
  command: string,
  args: readonly string[],
  stdin?: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<RunResult> {
  return runner(command, args, stdin, timeoutMs);
}

export function swiftBin(): string {
  return "/usr/bin/swift";
}

export function helperScript(): string {
  const fromMeta = NodeURL.fileURLToPath(new URL("../scripts/mac-helper.swift", import.meta.url));
  if (NodeFS.existsSync(fromMeta)) return fromMeta;
  const starts = [NodePath.dirname(fromMeta), process.cwd()];
  const seen = new Set<string>();
  for (const start of starts) {
    let dir = start;
    for (let depth = 0; depth < 8; depth += 1) {
      if (seen.has(dir)) break;
      seen.add(dir);
      const candidates = [
        NodePath.join(dir, "scripts", "mac-helper.swift"),
        NodePath.join(dir, "packages", "vexo-mac", "scripts", "mac-helper.swift"),
      ];
      for (const candidate of candidates) {
        if (NodeFS.existsSync(candidate)) return candidate;
      }
      const parent = NodePath.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return fromMeta;
}

/** Last JSON object on stdout. Does not include stderr, which can be noisy. */
export function parseReply(stdout: string): HelperReply | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"));
  const line = lines[lines.length - 1];
  if (!line) return null;
  try {
    return JSON.parse(line) as HelperReply;
  } catch {
    return null;
  }
}

function defaultRun(
  command: string,
  args: readonly string[],
  stdin?: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = NodeChildProcess.spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ code: null, stdout: "", stderr: "timed_out" });
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      out.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err.push(chunk);
    });
    child.on("error", (error: { code?: string }) => {
      finish({
        code: 127,
        stdout: "",
        stderr: error.code === "ENOENT" ? "not_found" : "spawn_failed",
      });
    });
    child.stdin.on("error", () => {
      // The child can exit before stdin is consumed. Never surface that payload.
    });
    child.on("close", (code) => {
      finish({
        code,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
  });
}
