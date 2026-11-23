// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_SESSION_TITLE = 160;

export type RenameClaudeSessionResult =
  | { readonly ok: true; readonly title: string }
  | {
      readonly ok: false;
      readonly reason: "invalid_id" | "empty_title" | "not_found" | "write_failed";
    };

export function normalizeSessionTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim().slice(0, MAX_SESSION_TITLE).trim();
}

/** Finds `<claudeDir>/projects/<project>/<id>.jsonl`, the transcript Claude Code writes. */
export async function findClaudeSessionFile(claudeDir: string, id: string): Promise<string | null> {
  if (!SESSION_ID.test(id)) return null;
  const projects = NodePath.join(claudeDir, "projects");
  let entries: string[];
  try {
    entries = await NodeFSP.readdir(projects);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const candidate = NodePath.join(projects, entry, `${id}.jsonl`);
    try {
      if ((await NodeFSP.stat(candidate)).isFile()) return candidate;
    } catch {
      // Not in this project.
    }
  }
  return null;
}

/**
 * Appends the `custom-title` record Claude Code writes for `/rename`. The newest one wins,
 * so Claude Code's resume list, the Vexo connector and this app all show the new name.
 */
export async function renameClaudeSession(input: {
  readonly claudeDir: string;
  readonly id: string;
  readonly title: string;
}): Promise<RenameClaudeSessionResult> {
  if (!SESSION_ID.test(input.id)) return { ok: false, reason: "invalid_id" };
  const title = normalizeSessionTitle(input.title);
  if (title.length === 0) return { ok: false, reason: "empty_title" };
  const file = await findClaudeSessionFile(input.claudeDir, input.id);
  if (file === null) return { ok: false, reason: "not_found" };
  const record = JSON.stringify({ type: "custom-title", customTitle: title, sessionId: input.id });
  try {
    const handle = await NodeFSP.open(file, "a+");
    try {
      const { size } = await handle.stat();
      let lead = "";
      if (size > 0) {
        const last = Buffer.alloc(1);
        await handle.read(last, 0, 1, size - 1);
        if (last[0] !== 0x0a) lead = "\n";
      }
      await handle.appendFile(`${lead}${record}\n`, "utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return { ok: false, reason: "write_failed" };
  }
  return { ok: true, title };
}
