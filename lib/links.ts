/**
 * 学习资源链接：把「平台 + 关键词」拼成真实可点的搜索链接。
 *
 * 为什么不写死具体 URL：平台内容会下架、课程会改版，写死的链接必然腐烂。
 * 用搜索链接保证永远能打开，且用户能自己筛到最新版本。
 * 代价是多一次点击，换来的是不会出现 404。
 */

function enc(q: string): string {
  return encodeURIComponent(q.trim());
}

const PLATFORM_TEMPLATES: Record<string, (q: string) => string> = {
  B站: (q) => `https://search.bilibili.com/all?keyword=${enc(q)}`,
  掘金: (q) => `https://search.juejin.cn/?query=${enc(q)}`,
  慕课网: (q) => `https://www.imooc.com/search?words=${enc(q)}`,
  Coursera: (q) => `https://www.coursera.org/search?query=${enc(q)}`,
  freeCodeCamp: (q) => `https://www.freecodecamp.org/news/search/?query=${enc(q)}`,
  YouTube: (q) => `https://www.youtube.com/results?search_query=${enc(q)}`,
  官方文档: (q) => `https://www.google.com/search?q=${enc(`${q} 官方文档`)}`,
  GitHub: (q) => `https://github.com/search?q=${enc(q)}&type=repositories`,
  知乎: (q) => `https://www.zhihu.com/search?type=content&q=${enc(q)}`,
};

export function resolveUrl(platform: string, query: string): string {
  const tpl = PLATFORM_TEMPLATES[platform];
  if (tpl) return tpl(query);
  return `https://www.google.com/search?q=${enc(`${platform} ${query}`)}`;
}
