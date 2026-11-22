import { describe, expect, it } from "vitest";
import { parsePatch, visibleNewLines } from "./diff";

const patch = [
  "@@ -1,4 +1,5 @@",
  " import a from 'a';",
  "-const x = 1;",
  "+const x = 2;",
  "+const y = 3;",
  " ",
  " export { x };",
  "@@ -20,2 +21,2 @@ function f() {",
  "-  return 1;",
  "+  return 2;",
  "\\ No newline at end of file",
].join("\n");

describe("parsePatch", () => {
  it("numbers old and new lines across hunks", () => {
    const lines = parsePatch(patch);
    expect(lines[0]).toEqual({ kind: "hunk", text: "@@ -1,4 +1,5 @@" });
    expect(lines[1]).toEqual({ kind: "context", oldLine: 1, newLine: 1, text: "import a from 'a';" });
    expect(lines[2]).toEqual({ kind: "del", oldLine: 2, text: "const x = 1;" });
    expect(lines[3]).toEqual({ kind: "add", newLine: 2, text: "const x = 2;" });
    expect(lines[4]).toEqual({ kind: "add", newLine: 3, text: "const y = 3;" });
    expect(lines[5]).toEqual({ kind: "context", oldLine: 3, newLine: 4, text: "" });
    expect(lines[6]).toEqual({ kind: "context", oldLine: 4, newLine: 5, text: "export { x };" });
    expect(lines[7].kind).toBe("hunk");
    expect(lines[8]).toEqual({ kind: "del", oldLine: 20, text: "  return 1;" });
    expect(lines[9]).toEqual({ kind: "add", newLine: 21, text: "  return 2;" });
    expect(lines[10]).toEqual({ kind: "meta", text: "No newline at end of file" });
  });

  it("ignores a trailing newline and text before the first hunk", () => {
    const lines = parsePatch("junk\n@@ -0,0 +1,1 @@\n+hello\n");
    expect(lines).toEqual([
      { kind: "hunk", text: "@@ -0,0 +1,1 @@" },
      { kind: "add", newLine: 1, text: "hello" },
    ]);
  });

  it("lists the new-file lines a reviewer can comment on", () => {
    expect([...visibleNewLines(parsePatch(patch))]).toEqual([1, 2, 3, 4, 5, 21]);
  });
});
