/**
 * ESLint rules for the design system (DESIGN_SYSTEM.md §3, docs/design-usage.md), applied to
 * apps/web/src/{features,shared}. They read every string literal and template chunk, so they
 * catch classes in className, cn(), cva() and style objects alike.
 *
 * - no-physical-direction-classes: ml-/mr-/pl-/pr-/left-/right-/text-left/… break RTL;
 *   use the logical ms-/me-/ps-/pe-/start-/end-/text-start/…  Classes scoped with an explicit
 *   `rtl:` or `ltr:` variant are allowed.
 * - no-raw-colors: hex/rgb()/hsl()/oklch() literals and Tailwind palette colours
 *   (bg-red-500 …). Use semantic tokens (bg-primary, text-profit …) or brand scales.
 */

const LOGICAL = [
  [/^(-?)(scroll-)?m([lr])-/, (m) => `${m[1]}${m[2] ?? ''}m${m[3] === 'l' ? 's' : 'e'}-`],
  [/^(-?)(scroll-)?p([lr])-/, (m) => `${m[1]}${m[2] ?? ''}p${m[3] === 'l' ? 's' : 'e'}-`],
  [/^(-?)(left|right)-/, (m) => `${m[1]}${m[2] === 'left' ? 'start' : 'end'}-`],
  [/^text-(left|right)$/, (m) => `text-${m[1] === 'left' ? 'start' : 'end'}`],
  [/^border-([lr])(-|$)/, (m) => `border-${m[1] === 'l' ? 's' : 'e'}${m[2]}`],
  [/^rounded-([lr])(-|$)/, (m) => `rounded-${m[1] === 'l' ? 's' : 'e'}${m[2]}`],
  [
    /^rounded-([tb])([lr])(-|$)/,
    (m) => `rounded-${m[1] === 't' ? 's' : 'e'}${m[2] === 'l' ? 's' : 'e'}${m[3]}`,
  ],
  [/^(float|clear)-(left|right)$/, (m) => `${m[1]}-${m[2] === 'left' ? 'start' : 'end'}`],
];

const PALETTE =
  /^(?:bg|text|border(?:-[xytrblse])?|ring|ring-offset|outline|fill|stroke|from|via|to|decoration|divide|placeholder|caret|accent|shadow|inset-shadow)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/;
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(\s*[\d.]/;

/** Splits a class token into its variants and its base utility, ignoring ":" inside [..]. */
function splitVariants(token) {
  let depth = 0;
  let last = -1;
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];
    if (char === '[' || char === '(') depth += 1;
    else if (char === ']' || char === ')') depth -= 1;
    else if (char === ':' && depth === 0) last = index;
  }
  const variants = last === -1 ? [] : token.slice(0, last).split(':');
  const base = token.slice(last + 1).replace(/^!|!$/g, '');
  return { variants, base };
}

function stringsOf(node) {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateElement') return node.value.cooked ?? node.value.raw;
  return null;
}

const noPhysicalDirectionClasses = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow physical (left/right) Tailwind classes; use logical ones for RTL.',
    },
    messages: {
      physical:
        'Physical direction class "{{token}}" breaks RTL. Use "{{suggestion}}" (see docs/design-usage.md).',
    },
    schema: [],
  },
  create(context) {
    function check(node) {
      const text = stringsOf(node);
      if (!text) return;
      for (const token of text.split(/\s+/)) {
        if (!token) continue;
        const { variants, base } = splitVariants(token);
        if (variants.includes('rtl') || variants.includes('ltr')) continue;
        for (const [pattern, fix] of LOGICAL) {
          const match = pattern.exec(base);
          if (match) {
            const suggestion = token.replace(match[0], fix(match));
            context.report({ node, messageId: 'physical', data: { token, suggestion } });
            break;
          }
        }
      }
    }
    return { Literal: check, TemplateElement: check };
  },
};

const noRawColors = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow raw colour values and Tailwind palette colours outside the tokens.',
    },
    messages: {
      raw: 'Raw colour "{{value}}": use a semantic token (bg-primary, text-profit, …), defined in globals.css.',
      palette:
        'Tailwind palette colour "{{value}}": use a semantic token (bg-success, text-loss, …) or a brand scale.',
    },
    schema: [],
  },
  create(context) {
    function check(node) {
      const text = stringsOf(node);
      if (!text) return;
      const raw = RAW_COLOR.exec(text);
      if (raw) {
        context.report({ node, messageId: 'raw', data: { value: raw[0] } });
        return;
      }
      for (const token of text.split(/\s+/)) {
        const { base } = splitVariants(token);
        if (PALETTE.test(base)) {
          context.report({ node, messageId: 'palette', data: { value: token } });
          return;
        }
      }
    }
    return { Literal: check, TemplateElement: check };
  },
};

export const designSystemPlugin = {
  meta: { name: 'fabric-design-system' },
  rules: {
    'no-physical-direction-classes': noPhysicalDirectionClasses,
    'no-raw-colors': noRawColors,
  },
};
