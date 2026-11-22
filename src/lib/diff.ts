/**
 * Parses the unified diff GitHub returns for one file of a pull request
 * ("patch"), so the UI can number lines and place review findings on them.
 */

export type DiffLine =
  | { kind: "hunk"; text: string }
  | { kind: "add"; newLine: number; text: string }
  | { kind: "del"; oldLine: number; text: string }
  | { kind: "context"; oldLine: number; newLine: number; text: string }
  | { kind: "meta"; text: string };

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parsePatch(patch: string): DiffLine[] {
  const out: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const raw of patch.split("\n")) {
    const hunk = raw.match(HUNK);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      out.push({ kind: "hunk", text: raw });
    } else if (raw.startsWith("+")) {
      out.push({ kind: "add", newLine: newLine++, text: raw.slice(1) });
    } else if (raw.startsWith("-")) {
      out.push({ kind: "del", oldLine: oldLine++, text: raw.slice(1) });
    } else if (raw.startsWith("\\")) {
      out.push({ kind: "meta", text: raw.slice(2) });
    } else if (out.length > 0) {
      // Context lines start with a space; a trailing empty string after the last newline is skipped.
      if (raw === "" && oldLine === 0 && newLine === 0) continue;
      out.push({ kind: "context", oldLine: oldLine++, newLine: newLine++, text: raw.slice(1) });
    }
  }
  // GitHub patches do not end with a newline, but tolerate one.
  const last = out.at(-1);
  if (last?.kind === "context" && last.text === "" && patch.endsWith("\n")) out.pop();
  return out;
}

/** Line numbers in the new file that the diff shows, for placing findings. */
export function visibleNewLines(lines: DiffLine[]): Set<number> {
  const set = new Set<number>();
  for (const l of lines) if (l.kind === "add" || l.kind === "context") set.add(l.newLine);
  return set;
}
