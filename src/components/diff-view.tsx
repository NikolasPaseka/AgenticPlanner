import { Fragment } from "react";
import type { ReviewFinding } from "@/lib/db/schema";
import { parsePatch, visibleNewLines, type DiffLine } from "@/lib/diff";
import type { PullRequestCommit, PullRequestFile } from "@/lib/github/gateway";
import { timeAgo } from "@/lib/ui/labels";
import { CommitIcon, FileIcon } from "./icons";
import { SEVERITY_CLASS } from "./review-bits";
import { Badge, cn } from "./ui";

export type PlacedFinding = ReviewFinding & { reviewer: string };

const STATUS: Record<PullRequestFile["status"], { label: string; className: string }> = {
  added: { label: "Added", className: "text-emerald-700 dark:text-emerald-300" },
  removed: { label: "Deleted", className: "text-red-600 dark:text-red-400" },
  modified: { label: "Modified", className: "text-muted" },
  renamed: { label: "Renamed", className: "text-sky-700 dark:text-sky-300" },
  copied: { label: "Copied", className: "text-sky-700 dark:text-sky-300" },
  changed: { label: "Changed", className: "text-muted" },
  unchanged: { label: "Unchanged", className: "text-muted" },
};

/** Files with more diff lines than this start collapsed. */
const COLLAPSE_LINES = 400;
const normalize = (path: string) => path.replace(/^\.?\//, "");

function FindingNote({ finding, inset = true }: { finding: PlacedFinding; inset?: boolean }) {
  return (
    <div
      className={cn(
        "my-1.5 mr-3 flex flex-col gap-1 rounded-lg border border-border bg-surface p-3 font-sans text-sm whitespace-normal shadow-card",
        inset ? "ml-3 sm:ml-24" : "ml-3",
      )}
    >
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <Badge className={SEVERITY_CLASS[finding.severity]}>{finding.severity}</Badge>
        <span>{finding.reviewer}</span>
        {!inset && finding.line && <span className="font-mono">line {finding.line}</span>}
      </p>
      <p className="whitespace-pre-wrap text-fg">{finding.message}</p>
    </div>
  );
}

function Row({ line }: { line: DiffLine }) {
  if (line.kind === "hunk") {
    return (
      <tr className="bg-accent-soft text-muted">
        <td colSpan={4} className="px-3 py-1 whitespace-pre">
          {line.text}
        </td>
      </tr>
    );
  }
  if (line.kind === "meta") {
    return (
      <tr className="text-muted italic">
        <td colSpan={3} />
        <td className="px-2 py-0.5">{line.text}</td>
      </tr>
    );
  }
  const oldNo = line.kind === "add" ? "" : line.oldLine;
  const newNo = line.kind === "del" ? "" : line.newLine;
  const sign = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
  return (
    <tr className={cn(line.kind === "add" && "bg-emerald-500/10", line.kind === "del" && "bg-red-500/10")}>
      <td className="w-10 border-r border-border px-2 text-right text-muted select-none">{oldNo}</td>
      <td className="w-10 border-r border-border px-2 text-right text-muted select-none">{newNo}</td>
      <td
        className={cn(
          "w-5 pl-2 select-none",
          line.kind === "add" && "text-emerald-700 dark:text-emerald-400",
          line.kind === "del" && "text-red-600 dark:text-red-400",
        )}
      >
        {sign}
      </td>
      <td className="pr-4 whitespace-pre">{line.text}</td>
    </tr>
  );
}

function Additions({ file }: { file: Pick<PullRequestFile, "additions" | "deletions"> }) {
  return (
    <span className="shrink-0 font-mono text-xs">
      <span className="text-emerald-700 dark:text-emerald-400">+{file.additions}</span>{" "}
      <span className="text-red-600 dark:text-red-400">−{file.deletions}</span>
    </span>
  );
}

function FileDiff({
  file,
  index,
  findings,
  prUrl,
  collapsed,
}: {
  file: PullRequestFile;
  index: number;
  findings: PlacedFinding[];
  prUrl: string | null;
  collapsed: boolean;
}) {
  const lines = file.patch ? parsePatch(file.patch) : [];
  const shown = visibleNewLines(lines);
  const byLine = new Map<number, PlacedFinding[]>();
  const fileLevel: PlacedFinding[] = [];
  for (const f of findings) {
    if (f.line && shown.has(f.line)) byLine.set(f.line, [...(byLine.get(f.line) ?? []), f]);
    else fileLevel.push(f);
  }
  const status = STATUS[file.status];

  return (
    <details
      id={`file-${index}`}
      open={!collapsed}
      className="group scroll-mt-20 rounded-xl border border-border bg-surface shadow-card"
    >
      <summary className="sticky top-14 z-10 flex cursor-pointer items-center gap-2 rounded-t-xl border-b border-border bg-surface-2 px-3 py-2 text-sm select-none">
        <span aria-hidden className="text-[10px] text-muted transition group-open:rotate-90">
          ▶
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={file.filename}>
          {file.previousFilename && file.previousFilename !== file.filename && (
            <span className="text-muted">{file.previousFilename} → </span>
          )}
          {file.filename}
        </span>
        {findings.length > 0 && (
          <Badge className="text-amber-700 dark:text-amber-300">
            {findings.length} finding{findings.length === 1 ? "" : "s"}
          </Badge>
        )}
        <Badge className={cn("hidden sm:inline-flex", status.className)}>{status.label}</Badge>
        <Additions file={file} />
      </summary>
      {fileLevel.length > 0 && (
        <div className="border-b border-border py-1">
          {fileLevel.map((f, i) => (
            <FindingNote key={i} finding={f} inset={false} />
          ))}
        </div>
      )}
      {file.patch ? (
        <div className="overflow-x-auto rounded-b-xl">
          <table className="min-w-full border-collapse font-mono text-xs leading-5">
            <tbody>
              {lines.map((line, i) => (
                <Fragment key={i}>
                  <Row line={line} />
                  {(line.kind === "add" || line.kind === "context") &&
                    byLine.get(line.newLine)?.map((f, j) => (
                      <tr key={`f${j}`}>
                        <td colSpan={4}>
                          <FindingNote finding={f} />
                        </td>
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-3 text-sm text-muted">
          GitHub does not show a diff for this file (binary or too large).{" "}
          {prUrl && (
            <a href={`${prUrl}/files`} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              Open on GitHub
            </a>
          )}
        </p>
      )}
    </details>
  );
}

/** Files changed in a pull request, GitHub-style, with review findings placed on their lines. */
export function DiffView({
  files,
  findings,
  prUrl,
}: {
  files: PullRequestFile[];
  findings: PlacedFinding[];
  prUrl: string | null;
}) {
  const total = {
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
  };
  const forFile = (name: string) => findings.filter((f) => f.file && normalize(f.file) === name);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-border bg-surface shadow-card">
        <p className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm">
          <span className="font-semibold">
            {files.length} file{files.length === 1 ? "" : "s"} changed
          </span>
          <Additions file={total} />
        </p>
        <ul className="max-h-64 divide-y divide-border overflow-y-auto text-sm">
          {files.map((f, i) => {
            const n = forFile(f.filename).length;
            return (
              <li key={f.filename}>
                <a href={`#file-${i}`} className="flex items-center gap-2 px-4 py-1.5 hover:bg-surface-2">
                  <FileIcon className={cn("shrink-0", STATUS[f.status].className)} width={14} height={14} />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.filename}</span>
                  {n > 0 && (
                    <span className="text-xs text-amber-700 dark:text-amber-300">
                      {n} finding{n === 1 ? "" : "s"}
                    </span>
                  )}
                  <Additions file={f} />
                </a>
              </li>
            );
          })}
        </ul>
      </div>
      {files.map((f, i) => (
        <FileDiff
          key={f.filename}
          file={f}
          index={i}
          findings={forFile(f.filename)}
          prUrl={prUrl}
          collapsed={(f.patch?.split("\n").length ?? 0) > COLLAPSE_LINES}
        />
      ))}
    </div>
  );
}

export function CommitList({ commits }: { commits: PullRequestCommit[] }) {
  return (
    <details className="group rounded-xl border border-border bg-surface shadow-card">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-sm select-none">
        <span aria-hidden className="text-[10px] text-muted transition group-open:rotate-90">
          ▶
        </span>
        <span className="font-semibold">
          {commits.length} commit{commits.length === 1 ? "" : "s"}
        </span>
      </summary>
      <ul className="divide-y divide-border border-t border-border text-sm">
        {commits.map((c) => (
          <li key={c.sha} className="flex items-center gap-3 px-4 py-2">
            <CommitIcon className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate">{c.message.split("\n")[0]}</span>
            <span className="hidden shrink-0 text-xs text-muted sm:inline">
              {c.author}
              {c.date && ` · ${timeAgo(new Date(c.date))}`}
            </span>
            <span className="shrink-0 font-mono text-xs text-muted">{c.sha.slice(0, 7)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
