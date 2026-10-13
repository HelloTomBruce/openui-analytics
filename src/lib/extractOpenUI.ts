/**
 * 从模型输出中提取 OpenUI DSL 代码块。
 *
 * 只有 ```openui 围栏或未标注语言的裸 ``` 围栏才会进入 OpenUI 渲染器；
 * ```sql / ```json 等其他语言围栏保留在正文中按纯文本/代码展示，
 * 避免被误吞进渲染器造成解析错误与正文缺失。
 */

export interface ExtractedContent {
  /** 去除 openui 代码块后的正文 */
  textPart: string;
  /** 提取出的 openui DSL 源码（无则为空串） */
  openuiPart: string;
}

// 带语言捕获的围栏匹配；末尾 (?:```|$) 兼容流式传输中尚未闭合的围栏。
// 扫描策略：第一个 ```openui 围栏优先；否则回退到第一个未标注语言的裸围栏
// （模型忘记写语言标签时兜底）；```sql 等其他语言围栏一律留在正文。
const FENCE_RE = /```(\w*)[ \t]*\r?\n?([\s\S]*?)(?:```|$)/g;

export function extractOpenUI(rawContent: string): ExtractedContent {
  if (!rawContent) return { textPart: rawContent ?? "", openuiPart: "" };

  let firstBare: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  FENCE_RE.lastIndex = 0;

  while ((match = FENCE_RE.exec(rawContent)) !== null) {
    const lang = match[1].toLowerCase();
    if (lang === "openui") {
      return {
        textPart: (
          rawContent.slice(0, match.index) + rawContent.slice(match.index + match[0].length)
        ).trim(),
        openuiPart: match[2].trim(),
      };
    }
    if (lang === "" && !firstBare) {
      firstBare = match;
    }
  }

  if (firstBare) {
    return {
      textPart: (
        rawContent.slice(0, firstBare.index) +
        rawContent.slice(firstBare.index + firstBare[0].length)
      ).trim(),
      openuiPart: firstBare[2].trim(),
    };
  }

  return { textPart: rawContent, openuiPart: "" };
}
