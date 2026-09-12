// Import an already downloaded, pinned MIT community directory. No runtime translation service.
const fs = require('node:fs');
const root = 'out/marketplace-localization-sources';
const revision = fs.readFileSync(`${root}/revision.txt`, 'utf8').trim();
if (!/^[a-f0-9]{40}$/.test(revision)) throw Error('Expected a pinned source revision');
const entries = {};
for (const line of fs.readFileSync(`${root}/README-zh.md`, 'utf8').split(/\r?\n/)) {
  const match = /^- \[([^\]]+)\]\((https:\/\/github\.com\/[^\s)]+)\).*? - (.+)$/.exec(line);
  if (!match || !/[\u4e00-\u9fff]/.test(match[3])) continue;
  const key = match[2].replace(/\/$/, '').toLowerCase();
  const description = match[3].replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, '').replace(/[*`]/g, '').trim().slice(0, 700);
  // Monorepos have different tools under different paths: never collapse them to the root.
  if (entries[key] && entries[key] !== description) { entries[key] = ''; continue; }
  entries[key] = description;
}
const output = { source: `https://github.com/punkpeye/awesome-mcp-servers/blob/${revision}/README-zh.md`, revision,
  entries: Object.fromEntries(Object.entries(entries).filter(([, text]) => text).sort(([a], [b]) => a.localeCompare(b))) };
fs.writeFileSync('src/shared/mcp-chinese-catalog.json', JSON.stringify(output, null, 2) + '\n');
fs.mkdirSync('docs/licenses/awesome-mcp-servers', { recursive: true });
fs.copyFileSync(`${root}/LICENSE`, 'docs/licenses/awesome-mcp-servers/LICENSE');
console.log(`Imported ${Object.keys(output.entries).length} Chinese descriptions at ${revision}`);
