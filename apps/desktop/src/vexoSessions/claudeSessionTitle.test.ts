// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { renameClaudeSession } from "./claudeSessionTitle.ts";

const ID = "faf4bfed-12b9-454a-b270-06a3d4c38632";

async function claudeHome(transcript: string | null): Promise<string> {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "claude-title-"));
  const project = NodePath.join(dir, "projects", "-Users-me-app");
  await NodeFSP.mkdir(project, { recursive: true });
  if (transcript !== null)
    await NodeFSP.writeFile(NodePath.join(project, `${ID}.jsonl`), transcript);
  return dir;
}

async function lines(dir: string): Promise<string[]> {
  const text = await NodeFSP.readFile(
    NodePath.join(dir, "projects", "-Users-me-app", `${ID}.jsonl`),
    "utf8",
  );
  return text.split("\n");
}

describe("renameClaudeSession", () => {
  it("appends the custom-title record Claude Code reads last", async () => {
    const dir = await claudeHome('{"type":"user"}\n');
    const result = await renameClaudeSession({
      claudeDir: dir,
      id: ID,
      title: "  Ship   the  band ",
    });
    expect(result).toEqual({ ok: true, title: "Ship the band" });
    expect(await lines(dir)).toEqual([
      '{"type":"user"}',
      `{"type":"custom-title","customTitle":"Ship the band","sessionId":"${ID}"}`,
      "",
    ]);
  });

  it("starts a new line when the transcript does not end with one", async () => {
    const dir = await claudeHome('{"type":"user"}');
    await renameClaudeSession({ claudeDir: dir, id: ID, title: "Renamed" });
    expect((await lines(dir))[1]).toBe(
      `{"type":"custom-title","customTitle":"Renamed","sessionId":"${ID}"}`,
    );
  });

  it("refuses ids that are not session ids, blank titles, and unknown sessions", async () => {
    const dir = await claudeHome('{"type":"user"}\n');
    expect(await renameClaudeSession({ claudeDir: dir, id: "../../etc/x", title: "x" })).toEqual({
      ok: false,
      reason: "invalid_id",
    });
    expect(await renameClaudeSession({ claudeDir: dir, id: ID, title: "   " })).toEqual({
      ok: false,
      reason: "empty_title",
    });
    const empty = await claudeHome(null);
    expect(await renameClaudeSession({ claudeDir: empty, id: ID, title: "x" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});
