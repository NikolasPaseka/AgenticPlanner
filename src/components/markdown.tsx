import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "./ui";

/*
 * Task descriptions, comments, summaries, and reviews are untrusted: agents and
 * PR text write them. So raw HTML is dropped, unsafe link protocols are removed
 * by react-markdown's default URL check, links open in a new tab without a
 * referrer, and images become links, so viewing a task never loads a remote
 * image that could track the owner.
 */
const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer nofollow">
      {children}
    </a>
  ),
  img: ({ src, alt }) =>
    typeof src === "string" && src ? (
      <a href={src} target="_blank" rel="noreferrer nofollow">
        {alt || "image"}
      </a>
    ) : null,
};

/** Renders untrusted Markdown (GitHub flavoured) as safe, themed HTML. */
export function MarkdownText({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("markdown text-sm", className)}>
      <Markdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {children}
      </Markdown>
    </div>
  );
}
