export function normalizeMath(markdown: string): string {
  // If there is no display math, do nothing
  const hasDisplayMath = /\$\$[\s\S]+?\$\$/g.test(markdown);
  if (!hasDisplayMath) return markdown;

  // Remove inline math $...$ but keep $$...$$
  return markdown.replace(
    /(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g,
    (_, content) => content
  );
}
