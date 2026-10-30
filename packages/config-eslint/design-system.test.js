import { RuleTester } from 'eslint';
import { afterAll, describe, it } from 'vitest';
import { designSystemPlugin } from './design-system.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
});
const { rules } = designSystemPlugin;

tester.run('no-physical-direction-classes', rules['no-physical-direction-classes'], {
  valid: [
    'cn("ms-2 me-4 ps-3 pe-1 start-0 end-0 text-start text-end border-s rounded-e-lg")',
    '<div className="md:ms-2 hover:pe-3 inset-x-0" />',
    'cn("rtl:rotate-180 ltr:left-0 rtl:right-0")',
    'cn("slide-in-from-right-10 placement-right")',
    'const side = "right"',
    'cn("data-[side=right]:border-s")',
    'cn(`gap-2 ${x} ms-1`)',
  ],
  invalid: [
    {
      code: 'cn("ml-2")',
      errors: [{ messageId: 'physical', data: { token: 'ml-2', suggestion: 'ms-2' } }],
    },
    {
      code: 'cn("-mr-1")',
      errors: [{ messageId: 'physical', data: { token: '-mr-1', suggestion: '-me-1' } }],
    },
    {
      code: '<p className="md:pl-4" />',
      errors: [{ messageId: 'physical', data: { token: 'md:pl-4', suggestion: 'md:ps-4' } }],
    },
    {
      code: 'cn("pr-[3px]")',
      errors: [{ messageId: 'physical', data: { token: 'pr-[3px]', suggestion: 'pe-[3px]' } }],
    },
    {
      code: 'cn("left-0")',
      errors: [{ messageId: 'physical', data: { token: 'left-0', suggestion: 'start-0' } }],
    },
    { code: 'cn("data-[side=right]:right-0")', errors: [{ messageId: 'physical' }] },
    {
      code: 'cn("text-left")',
      errors: [{ messageId: 'physical', data: { token: 'text-left', suggestion: 'text-start' } }],
    },
    {
      code: 'cn("text-right")',
      errors: [{ messageId: 'physical', data: { token: 'text-right', suggestion: 'text-end' } }],
    },
    {
      code: 'cn("border-l")',
      errors: [{ messageId: 'physical', data: { token: 'border-l', suggestion: 'border-s' } }],
    },
    {
      code: 'cn("rounded-tr-lg")',
      errors: [
        { messageId: 'physical', data: { token: 'rounded-tr-lg', suggestion: 'rounded-se-lg' } },
      ],
    },
    { code: 'cn(`flex ${a} ml-auto`)', errors: [{ messageId: 'physical' }] },
  ],
});

tester.run('no-raw-colors', rules['no-raw-colors'], {
  valid: [
    'cn("bg-primary text-profit border-input bg-burgundy-800 text-gold-800 bg-black/50")',
    'const s = { color: "var(--primary)" }',
    'cn("hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]")',
    'const id = "#content"',
  ],
  invalid: [
    { code: 'cn("bg-[#491017]")', errors: [{ messageId: 'raw' }] },
    { code: 'const s = { color: "#fff" }', errors: [{ messageId: 'raw' }] },
    { code: 'const c = "rgb(73, 16, 23)"', errors: [{ messageId: 'raw' }] },
    { code: 'cn("bg-red-500")', errors: [{ messageId: 'palette' }] },
    { code: '<p className="dark:text-emerald-400" />', errors: [{ messageId: 'palette' }] },
  ],
});
