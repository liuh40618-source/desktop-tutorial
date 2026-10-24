/** 公开 GitHub 仓库的轻量审计：只读 commits 与 languages，不 clone、不读取源码。 */

import type { GithubAudit } from "./types";

export const GITHUB_REPOSITORY_URL = /^https:\/\/github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/;
const API_ROOT = "https://api.github.com";
const MAX_RESPONSE_BYTES = 1024 * 1024;
const USER_AGENT = "career-navigator-github-audit/1.0";

export interface ParsedGithubRepository {
  url: string;
  owner: string;
  repo: string;
}

export interface GithubAuditResult extends GithubAudit {
  reasons: string[];
  error?: string;
}

export function parseGithubRepositoryUrl(value: unknown): ParsedGithubRepository | null {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) return null;
  const match = GITHUB_REPOSITORY_URL.exec(value);
  if (!match) return null;
  // 正则已经限制了字符集；URL 再校验一次，防止后续代码改动时放宽 host/path。
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || parsed.pathname !== `/${match[1]}/${match[2]}` || parsed.search || parsed.hash) return null;
  return { url: value, owner: match[1], repo: match[2] };
}

async function readJsonBounded(response: Response): Promise<unknown> {
  const length = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw new Error("GitHub 响应过大");
  if (!response.body) {
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new Error("GitHub 响应过大");
    return JSON.parse(text);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new Error("GitHub 响应过大");
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function fetchGithubJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "error",
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": USER_AGENT,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("公开仓库不存在，或仓库不是公开可读");
    if (response.status === 403 || response.status === 429) throw new Error("GitHub API 暂时限流，请稍后再试");
    throw new Error(`GitHub API 返回 ${response.status}`);
  }
  return readJsonBounded(response);
}

export async function auditPublicGithubRepository(value: unknown): Promise<GithubAuditResult> {
  const repository = parseGithubRepositoryUrl(value);
  const auditedAt = Date.now();
  if (!repository) {
    return {
      url: typeof value === "string" ? value : "",
      owner: "",
      repo: "",
      commitCount: 0,
      languageCount: 0,
      languages: [],
      passed: false,
      ruleVersion: "github-public-api-v1",
      auditedAt,
      reasons: ["URL 必须严格符合 https://github.com/用户名/仓库名，不能带查询参数、片段或尾斜杠"],
      error: "GitHub 仓库链接格式不合规",
    };
  }

  try {
    const base = `${API_ROOT}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`;
    const [commitsPayload, languagesPayload] = await Promise.all([
      fetchGithubJson(`${base}/commits?per_page=100`),
      fetchGithubJson(`${base}/languages`),
    ]);
    const commits = Array.isArray(commitsPayload) ? commitsPayload : [];
    const languagesObject = languagesPayload && typeof languagesPayload === "object" && !Array.isArray(languagesPayload)
      ? languagesPayload as Record<string, unknown>
      : {};
    const languages = Object.keys(languagesObject).slice(0, 30);
    const commitCount = commits.length;
    const languageCount = languages.length;
    const passed = commitCount >= 3 && languageCount >= 1;
    const reasons = [
      `公开 commits 接口返回 ${commitCount} 条（规则门槛：至少 3 条）`,
      `languages 接口返回 ${languageCount} 种语言（规则门槛：至少 1 种）`,
      passed ? "通过自动化公开 API 审计，可把对应行动证据提到等级 3" : "未达到自动化审计门槛，不自动提升证据等级",
    ];
    return { ...repository, commitCount, languageCount, languages, passed, ruleVersion: "github-public-api-v1", auditedAt, reasons };
  } catch (error) {
    return {
      ...repository,
      commitCount: 0,
      languageCount: 0,
      languages: [],
      passed: false,
      ruleVersion: "github-public-api-v1",
      auditedAt,
      reasons: [error instanceof Error ? error.message : "GitHub API 请求失败"],
      error: "公开仓库审计失败，请确认链接和网络后重试",
    };
  }
}
