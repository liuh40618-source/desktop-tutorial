const ASCII_WORD_CHARACTER = /[a-z0-9_+#]/i;

const NEGATED_BEFORE = /(?:没(?:有)?(?:实际|怎么|太)?(?:用|使用|接触|掌握|学习|学|练习|操作|实践)(?:过)?|未(?:曾)?(?:用|使用|接触|掌握|了解|学习|练习)(?:过)?|从未(?:使用|接触|掌握|学习)|不(?:太|怎么)?(?:熟悉|熟练|擅长|会|懂|具备|掌握|了解)|不会(?:使用|操作|写|编程)?|无需|无须|不要求|非必需|没有(?:接触|掌握|使用)?|暂无经验|经验不足|not familiar with|not proficient (?:in|with)|no experience (?:with|using)|no knowledge of|never (?:used|worked with)|do not know|don't know|haven't used|does not require|doesn't require|not required|not needed)[,，、:：\s]*$/iu;

const NEGATED_AFTER = /^[,，:：\s]*(?:(?:我|目前|仍|还|也|可能)\s*)?(?:不(?:太|怎么)?(?:熟悉|熟练|擅长|会|懂|具备|掌握|了解)|未(?:曾)?(?:掌握|使用|接触|了解)|没(?:有)?(?:掌握|使用|接触)|无需|无须|不要求|非必需|没有经验|暂无经验|经验不足|not familiar|unfamiliar|not proficient|no experience|not required|not needed|isn't required|is not required)/iu;

const UNCERTAIN_BEFORE = /(?:仅|只)?(?:略懂|稍懂|只懂|会一点|浅尝|初步了解|了解一些|有一定了解|有所了解|略有接触|接触过|尝试过|刚开始学|刚开始学习|正在学|正在学习|学习中|自学中|计划学|计划学习|准备学|准备学习|想学|希望学|希望学习|待学习|待提升|需要提升|经验较少|经验有限|(?:(?:currently|still)\s+)?learning(?:\s+(?:to use|about))?|basic knowledge\s+of|limited experience\s+(?:of|with)|beginner in)(?:一点|一些)?[,，、:：\s]*$/iu;
const UNCERTAIN_AFTER = /^[,，、:：\s]*(?:(?:还|仍|目前|尚|需要|待|计划|准备|想|希望|但|不过|有待)\s*)?(?:正在学|正在学习|在学|在学习|学习|自学中|入门|初学|略懂|稍懂|经验较少|经验有限|需要提升|待提升|需提升|提升|继续学习|补充学习|加强|(?:still\s+)?learning|beginner|novice|limited experience|basic knowledge)/iu;

/** @param {string | undefined} character @returns {boolean} */
function isSentenceBoundary(character) {
  return character !== undefined && /[。！？!?；;\n]/u.test(character);
}

/** @param {string} text @param {number} start @param {number} end */
function classifyNearbyCaution(text, start, end) {
  const beforeStart = Math.max(0, start - 48);
  let clauseStart = beforeStart;
  for (let index = start - 1; index >= beforeStart; index -= 1) {
    if (isSentenceBoundary(text[index])) {
      clauseStart = index + 1;
      break;
    }
  }

  const afterLimit = Math.min(text.length, end + 32);
  let clauseEnd = afterLimit;
  for (let index = end; index < afterLimit; index += 1) {
    if (isSentenceBoundary(text[index])) {
      clauseEnd = index;
      break;
    }
  }

  const before = text.slice(clauseStart, start).trim();
  const after = text.slice(end, clauseEnd).trim();
  if (NEGATED_BEFORE.test(before) || NEGATED_AFTER.test(after)) return "negated";
  if (UNCERTAIN_BEFORE.test(before) || UNCERTAIN_AFTER.test(after)) return "uncertain";
  return null;
}

/**
 * Find occurrences of a skill alias. ASCII aliases must be separate tokens so
 * SQL won't match NoSQL and Java won't match JavaScript. Chinese phrases retain
 * substring matching because they do not have consistent word separators.
 * @param {string} text
 * @param {string} alias
 * @returns {{ start: number, end: number, negated: boolean, uncertain: boolean }[]}
 */
export function findSkillAliasOccurrences(text, alias) {
  const source = String(text ?? "");
  const needle = String(alias ?? "").trim().toLowerCase();
  if (!needle) return [];

  const haystack = source.toLowerCase();
  const needsBoundaries = /^[\x00-\x7f]+$/.test(needle) && /[a-z0-9]/i.test(needle);
  const occurrences = [];
  let fromIndex = 0;

  while (fromIndex <= haystack.length - needle.length) {
    const start = haystack.indexOf(needle, fromIndex);
    if (start < 0) break;
    const end = start + needle.length;
    const before = start > 0 ? haystack[start - 1] : undefined;
    const after = end < haystack.length ? haystack[end] : undefined;
    const hasValidBoundary =
      !needsBoundaries ||
      ((!before || !ASCII_WORD_CHARACTER.test(before)) && (!after || !ASCII_WORD_CHARACTER.test(after)));

    if (hasValidBoundary) {
      const caution = classifyNearbyCaution(haystack, start, end);
      occurrences.push({ start, end, negated: caution === "negated", uncertain: caution === "uncertain" });
    }
    fromIndex = start + 1;
  }

  return occurrences;
}

/** @param {string} text @param {string} alias */
export function containsSkillAlias(text, alias) {
  return findSkillAliasOccurrences(text, alias).length > 0;
}
