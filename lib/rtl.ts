/**
 * Right-to-left vs. left-to-right script detection for LLM output.
 *
 * A block is rendered RTL only when strong RTL characters (Persian/Arabic/
 * Hebrew letters) outnumber strong LTR characters (Latin/Cyrillic/Greek
 * letters). Punctuation, digits, and whitespace are direction-neutral and are
 * ignored. This "majority of strong characters" rule means an English write-up
 * that merely mentions فولاد a few times stays LTR, while a mostly-Persian
 * answer reads right-to-left.
 *
 * Strong RTL ranges: Hebrew (0590-05FF), Arabic incl. Persian (0600-06FF),
 * Syriac, Thaana, NKo, Samaritan, Mandaic, Arabic Extended-A (0700-08FF), and
 * Hebrew/Arabic presentation forms (FB1D-FDFD, FE70-FEFC).
 */
const RTL_STRONG = /[֐-ࣿיִ-﷽ﹰ-ﻼ]/g;
const LTR_STRONG = /[A-Za-zЀ-ӿͰ-Ͽ]/g;

/** True when `text` should render right-to-left (i.e. is predominantly RTL script). */
export function isRtlText(text: string): boolean {
  if (!text) return false;
  const rtl = (text.match(RTL_STRONG) || []).length;
  const ltr = (text.match(LTR_STRONG) || []).length;
  if (rtl + ltr === 0) return false;
  return rtl > ltr;
}
