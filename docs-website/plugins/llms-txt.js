// Emits machine-readable docs for AI coding agents and other LLM tools, following
// https://llmstxt.org:
//
// - `llms.txt`: the intro from `llms-header.md`, then every doc in sidebar order as a
//   `[title](url): description` link, grouped by sidebar category.
// - `llms-full.txt`: the intro plus the full text of every doc outside the `## Optional`
//   section, for tools that load the whole documentation in one request.
// - A plain Markdown copy of each doc next to its HTML page (`docs/Writers` ->
//   `docs/Writers.md`), which is what the links in `llms.txt` point to. Copies keep their
//   source's relative links, which still resolve because pages mirror the source tree.
//
// Generated at build time from the same sources and sidebar as the site, so it can't drift.

const fs = require('fs')
const path = require('path')

const DOCS_PLUGIN = 'docusaurus-plugin-content-docs'

// Sidebar categories listed under `## Optional`: llms.txt readers may skip them, and they're
// left out of llms-full.txt.
const OPTIONAL_CATEGORIES = new Set(['Contributing', 'Other'])

function stripFrontMatter(source) {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
}

// Docs are served at their source path, so a Markdown copy lives at the source path too,
// with `.mdx` normalized to `.md`.
function markdownPathFor(doc) {
  const relative = doc.source.replace(/^@site\/docs\//, '')
  return relative.replace(/\.mdx$/, '.md')
}

function toMarkdown(doc, siteDir) {
  const sourcePath = path.join(siteDir, doc.source.replace(/^@site\//, ''))
  let body = stripFrontMatter(fs.readFileSync(sourcePath, 'utf8')).trim()
  // Links to sibling .mdx pages point at their .md copy
  body = body.replace(/(\]\([^)\s]*?)\.mdx(#[^)\s]*)?\)/g, '$1.md$2)')
  if (!/^#\s/m.test(body)) {
    body = `# ${doc.title}\n\n${body}`
  }
  return `${body}\n`
}

function oneLine(text) {
  return text.replace(/\s+/g, ' ').trim()
}

// Flattens a sidebar into [{ label, docIds }] per top-level category, in order.
function sidebarSections(sidebar) {
  const collect = (items) =>
    items.flatMap((item) => {
      if (item.type === 'doc') return [item.id]
      if (item.type === 'category') {
        const own = item.link && item.link.type === 'doc' ? [item.link.id] : []
        return [...own, ...collect(item.items)]
      }
      return []
    })
  return sidebar
    .filter((item) => item.type === 'category')
    .map((item) => ({ label: item.label, docIds: collect([item]) }))
}

module.exports = function llmsTxtPlugin(context) {
  const { siteDir, siteConfig } = context
  const siteUrl = siteConfig.url.replace(/\/$/, '')
  let docsData = null

  return {
    name: 'llms-txt',

    async allContentLoaded({ allContent }) {
      const docsContent = allContent[DOCS_PLUGIN] && allContent[DOCS_PLUGIN].default
      const version = docsContent && docsContent.loadedVersions[0]
      if (!version) {
        throw new Error('llms-txt: docs plugin content not found')
      }
      docsData = {
        docs: new Map(version.docs.map((doc) => [doc.id, doc])),
        sections: sidebarSections(version.sidebars.docs),
      }
    },

    async postBuild({ outDir }) {
      if (!docsData) {
        throw new Error('llms-txt: no docs content loaded')
      }
      const header = fs.readFileSync(path.join(siteDir, 'llms-header.md'), 'utf8').trim()
      const urlFor = (doc) => `${siteUrl}${siteConfig.baseUrl}${markdownPathFor(doc)}`

      const index = [header]
      const full = [header]
      const optional = []
      let written = 0

      for (const { label, docIds } of docsData.sections) {
        const isOptional = OPTIONAL_CATEGORIES.has(label)
        const links = []
        for (const id of docIds) {
          const doc = docsData.docs.get(id)
          if (!doc || doc.draft || doc.unlisted) continue

          const markdown = toMarkdown(doc, siteDir)
          const target = path.join(outDir, markdownPathFor(doc))
          fs.mkdirSync(path.dirname(target), { recursive: true })
          fs.writeFileSync(target, markdown)
          written += 1

          const description = oneLine(doc.frontMatter.description || doc.description || '')
          links.push(`- [${doc.title}](${urlFor(doc)})${description ? `: ${description}` : ''}`)
          if (!isOptional) {
            full.push(`<!-- Source: ${urlFor(doc)} -->\n\n${markdown.trim()}`)
          }
        }
        if (isOptional) {
          optional.push(...links)
        } else if (links.length) {
          index.push(`## ${label}\n\n${links.join('\n')}`)
        }
      }
      if (optional.length) {
        index.push(`## Optional\n\n${optional.join('\n')}`)
      }

      fs.writeFileSync(path.join(outDir, 'llms.txt'), `${index.join('\n\n')}\n`)
      fs.writeFileSync(path.join(outDir, 'llms-full.txt'), `${full.join('\n\n---\n\n')}\n`)
      // eslint-disable-next-line no-console
      console.log(`[llms-txt] llms.txt, llms-full.txt and ${written} Markdown pages`)
    },
  }
}
