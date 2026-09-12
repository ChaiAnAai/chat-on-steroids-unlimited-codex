import community from './mcp-chinese-catalog.json';

export interface McpPresentationInput { name: string; title?: string; description?: string; repository?: string; homepage?: string }
export interface McpPurpose { text: string; category: string; glyph: string; source: 'reviewed' | 'community' | 'publisher' | 'category' | 'unknown' }
// Exact upstream descriptions: edits by publishers invalidate these translations instead of inheriting stale claims.
const reviewed: Record<string, string> = {
  'Connect AI assistants to your GitHub-hosted Obsidian vault to seamlessly access, search, and analy…': '连接存放在 GitHub 上的 Obsidian 笔记库，让 AI 读取、搜索和分析笔记。',
  'A Model Context Protocol (MCP) application for automated GitHub PR analysis and issue management.…': '分析 GitHub 的代码合并请求（PR），并管理问题和任务（Issue）。',
  'Access the GitHub API, enabling file operations, repository management, search functionality, and…': '连接 GitHub，操作仓库文件、管理代码仓库并进行搜索。',
  'GitHub platform changelog feed. $0.01/query. Register in-session — free testnet funds.': '查询 GitHub 平台的更新公告。发布者标价每次查询 0.01 美元，需在会话中注册；其免费测试资金不等同于免费正式服务。',
  'Trending GitHub repos: new & rising daily. $0.01/query. Register in-session — free testnet funds.': '发现 GitHub 每日新增和热度上升的代码仓库。发布者标价每次查询 0.01 美元，需注册。',
  'Hiring developers? Find and source software engineers by what they build on GitHub.': '根据开发者在 GitHub 上的项目寻找软件工程师，适合招聘与人才搜寻。',
  'Resolve a company domain to its GitHub organization with repo, language and activity signals.': '从公司域名查找对应的 GitHub 组织，并查看仓库、编程语言和活跃情况。',
  'Manage repositories, users, releases, and automate GitHub workflows': '管理 GitHub 仓库、用户和版本发布，并自动处理工作流。',
  'GitHub repo analytics: stars, trending, code search, contributor maps for project research.': '分析 GitHub 仓库的收藏量、趋势、代码和贡献者，辅助项目调研。',
  'Scrape GitHub repository metadata, stars, forks, topics, licences and activity. Pay per row.': '采集 GitHub 仓库信息、收藏量、分支、主题、许可证和活动数据，按数据行计费。',
  'BlackHawkMCP - connect AI to Google Sheets': '让 AI 连接 Google 表格。具体可读写的内容取决于该服务授权。',
  'Decode any Base tx: plain English, strict JSON, risk flags, no LLM. 50 free/day per IP, then $0.02.': '解读 Base 区块链交易，输出文字说明、JSON 和风险标记；每个 IP 每天免费 50 次，超出后每次 0.02 美元。',
  'Pay-per-use tool API for AI agents. Free tier, x402 USDC micropayments, or API key.': '为 AI 提供按次使用的工具 API，支持免费档、USDC 小额支付或 API Key。',
  'Medium CLI + 23-tool MCP server. Your IDE drafts replies. No API keys.': '在开发环境中使用 Medium 的命令行和 23 个 MCP 工具，可起草回复；发布者说明无需 API Key。',
  'Convert HTML to PDF/PNG/WebP/PPTX slide carousels with 11 themes — for LinkedIn, decks, posts.': '把 HTML 转成 PDF、图片或 PPTX 幻灯片，提供 11 种主题，适合演示和社交内容。',
  'Substack CLI + 26-tool MCP server. Your IDE drafts replies via propose_reply. No API keys.': '在开发环境中连接 Substack，使用 26 个工具并起草回复；发布者说明无需 API Key。',
  'Memory for coding agents, checked against the filesystem and git before it is believed.': '为编程助手保存记忆，并通过文件系统和 Git 核对记录是否仍然有效。',
  'Human-to-AI code review bridge. Review UI in the browser, AI agents fix code via MCP.': '在浏览器里审阅界面，把修改意见交给 AI，通过 MCP 修改代码。',
  'Universal AI API Orchestrator — 1,554 tools, 96 services. One install.': '聚合多个服务的 API。发布者宣称一次安装可接入 96 个服务、1,554 个工具，实际能力以连接检查为准。',
  'PayPerByte — per-byte data for AI agents: x402 USDC on Base, EIP-712-attested. No token.': '向 AI 按字节提供数据，使用 Base 网络上的 USDC 支付，并提供签名证明。',
  'Local-first shared memory and task coordination for AI coding agents. Go daemon plus headless CLI.': '为多个编程助手提供本地共享记忆和任务协调，通过后台服务与命令行运行。',
  'Read-only MCP server for querying the live NOVAI blockchain over its public JSON-RPC endpoint.': '通过公开接口只读查询 NOVAI 区块链的实时数据。',
  'x402-paid Base agent tools (USDC). 5 deterministic tools. No API keys. No NFT pass.': '提供 5 个 Base 网络工具，使用 USDC 按次支付；无需 API Key 或 NFT 通行凭证。',
  'Read-only Polymarket prediction market data for AI agents.': '让 AI 只读查询 Polymarket 预测市场数据。'
};
const categories: Array<[RegExp, string, string, string]> = [
  [/\b(obsidian|notion|notes?|knowledge|wiki)\b/i, '笔记与知识库', '册', '与笔记、文档或知识库相关，适合整理和查找资料。'],
  [/\b(recruit|hiring|talent|engineers|sourcing)\b/i, '招聘与人才', '人', '与招聘、人才查找或人员资料相关。'],
  [/\b(slides?|pptx|presentation)\b/i, '演示与排版', '演', '与幻灯片、演示文件或内容排版相关。'],
  [/\b(github|gitlab|repository|repositories|code review|git)\b/i, '代码与仓库', '码', '与代码仓库、项目检索或开发协作相关。'],
  [/\b(documentation|docs|learn)\b/i, '文档检索', '文', '与技术文档的查找、阅读或检索相关。'],
  [/\b(sheets|spreadsheet|excel|csv)\b/i, '表格与数据', '表', '与电子表格或结构化数据相关。'],
  [/\b(memory|coordination)\b/i, '记忆与协作', '忆', '与助手记忆保存或任务协调相关。'],
  [/\b(browser|playwright|selenium|puppeteer)\b/i, '浏览器自动化', '览', '与浏览器操作、网页测试或页面读取相关。'],
  [/\b(search|crawl|scrape|fetch)\b/i, '搜索与采集', '搜', '与搜索信息、读取网页或采集数据相关。'],
  [/\b(image|design|photo|3d|blender|video)\b/i, '图像与创作', '绘', '与图像、视频、设计或三维内容相关。'],
  [/\b(database|postgres|sql|redis|mongo)\b/i, '数据库', '数', '与数据库查询或管理相关。'],
  [/\b(blockchain|usdc|base tx|x402|polymarket|trading|stock|market data)\b/i, '金融与链上数据', '财', '与金融市场或区块链数据相关；使用前查看费用与权限。'],
  [/\b(medium|substack|social|linkedin|twitter)\b/i, '内容与社交', '讯', '与内容发布、回复或社交平台相关。'],
  [/\b(api|tools|orchestrat|integration)\b/i, '服务与工具', '接', '连接外部 API 或工具，具体能力请查看条目详情。']
];
function repositoryKey(value?: string): string {
  try { const u = new URL(value!); return u.protocol === 'https:' && u.hostname === 'github.com' ? `${u.origin}${u.pathname.replace(/\.git\/?$/, '').replace(/\/$/, '')}`.toLowerCase() : ''; } catch { return ''; }
}
export function mcpPurpose(input: McpPresentationInput): McpPurpose {
  const description = input.description ?? '';
  // Never classify by registry namespace or the user's search: io.github is not evidence of GitHub functionality.
  const match = categories.find(([pattern]) => pattern.test(`${input.title ?? ''} ${description}`));
  const category = match?.[1] ?? '其他工具', glyph = match?.[2] ?? '具';
  if (input.name === 'com.microsoft/microsoft-learn-mcp') return { text: '查找微软官方技术文档、读取完整说明，并检索代码示例。适合学习 Azure、Windows 和微软开发工具。', category: '文档检索', glyph: '文', source: 'reviewed' };
  if (Object.hasOwn(reviewed, description)) return { text: reviewed[description]!, category, glyph, source: 'reviewed' };
  const entries: Record<string, string> = community.entries, key = repositoryKey(input.repository ?? input.homepage);
  if (key && Object.hasOwn(entries, key)) return { text: entries[key]!, category, glyph, source: 'community' };
  if (/[\u4e00-\u9fff]/.test(description)) return { text: description, category, glyph, source: 'publisher' };
  return { text: match?.[3] ?? '暂未收录中文用途说明。展开原文或打开项目说明查看具体能力。', category, glyph, source: match ? 'category' : 'unknown' };
}
export const chineseCatalogSource = community.source;
export function marketplaceSearchTerm(value: string): string {
  const terms: Record<string,string> = { '代码':'github','代码仓库':'github','笔记':'notes','知识库':'knowledge','文档':'documentation','微软文档':'microsoft-learn-mcp','搜索':'search','浏览器':'browser','图片':'image','图像':'image','数据库':'database','表格':'spreadsheet','记忆':'memory','视频':'video','地图':'maps','天气':'weather' };
  return terms[value.trim()] ?? value.trim();
}
