import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * A legal document's Markdown (our own files in content/legal) with the design system's type:
 * headings, lists, quotes, and tables that scroll inline on a phone instead of the page (their
 * cells are prose, so they wrap, unlike the data grids mz-table is made for). Raw HTML
 * in the text is never rendered (react-markdown's default); GFM adds the tables.
 */
const components: Components = {
  h1: ({ children }) => <h1 className="font-display text-heading-lg text-balance">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-10 text-heading-md text-balance">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-6 text-heading-sm">{children}</h3>,
  p: ({ children }) => <p className="mt-3 text-body text-pretty">{children}</p>,
  ul: ({ children }) => <ul className="mt-3 flex list-disc flex-col gap-1.5 ps-6 text-body">{children}</ul>,
  ol: ({ children }) => <ol className="mt-3 flex list-decimal flex-col gap-1.5 ps-6 text-body">{children}</ol>,
  blockquote: ({ children }) => <blockquote className="mt-4 border-s-2 border-line-strong ps-4 text-text-2">{children}</blockquote>,
  code: ({ children }) => <code className="rounded-sm bg-surface-sunk px-1 font-mono text-body-sm">{children}</code>,
  a: ({ children, href }) => <a href={href} className="underline underline-offset-2">{children}</a>,
  hr: () => <hr className="mt-8 border-line" />,
  table: ({ children }) => (
    <div className="mz-table-wrap mt-4 overflow-x-auto">
      <table className="mz-table [&_td]:min-w-[16ch] [&_td]:align-top [&_td]:whitespace-normal [&_th]:whitespace-normal">{children}</table>
    </div>
  ),
};

export function LegalMarkdown({ source }: { source: string }) {
  return <Markdown remarkPlugins={[remarkGfm]} components={components}>{source}</Markdown>;
}
