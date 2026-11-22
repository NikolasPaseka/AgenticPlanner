import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownText } from "./markdown";

const render = (md: string) => renderToStaticMarkup(<MarkdownText>{md}</MarkdownText>);

describe("MarkdownText", () => {
  it("renders GitHub flavoured Markdown", () => {
    const html = render("## Plan\n\n- [x] done\n- [ ] next\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n`code`");
    expect(html).toContain("<h2>Plan</h2>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("<table>");
    expect(html).toContain("<code>code</code>");
  });

  it("drops raw HTML from untrusted text", () => {
    const html = render('Hi <script>alert(1)</script><img src="https://evil.test/x.png" onerror="alert(1)">');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror");
  });

  it("removes unsafe link protocols and opens links without a referrer", () => {
    const html = render("[bad](javascript:alert(1)) and [good](https://example.com)");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noreferrer nofollow"');
  });

  it("turns images into links so no remote image loads", () => {
    const html = render("![screenshot](https://example.com/a.png)");
    expect(html).not.toContain("<img");
    expect(html).toContain('<a href="https://example.com/a.png" target="_blank" rel="noreferrer nofollow">screenshot</a>');
  });
});
