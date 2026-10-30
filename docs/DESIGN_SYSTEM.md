# نظام التصميم: غيث (GHAIT)

مرجع واحد للهوية البصرية ومكتبة الواجهة. الألوان **مأخوذة بالقياس من ملف الشعار** (عينات بكسل)، ثم بُنيت منها سلالم وتباينات تحقق WCAG AA.

---

## 1. مكتبة الواجهة: shadcn/ui

**القرار: shadcn/ui + Tailwind CSS v4 + Radix primitives + lucide-react.**

لماذا:

- **الكود يُنسخ إلى مشروعك** (`apps/web/src/shared/ui`)، فتملكه وتعدّله بحرية بدل أن تكون عبداً لمكتبة. مناسب لمشروع سيكبر.
- **الألوان كلها CSS variables**، فهوية "غيث" تُطبَّق في ملف واحد (`brand-tokens.css`) وتنعكس على كل المكونات والوضع الداكن.
- **دعم RTL رسمي** منذ يناير 2026: يضبط `rtl: true` في `components.json` فيحوّل الـ CLI الخصائص الفيزيائية (`left/right/ml/pr`) إلى منطقية (`start/end/ms/pe`) ويقلب الأيقونات المعروفة. [تفاصيل الإصدار](https://ui.shadcn.com/docs/changelog/2026-01-rtl)
- مبني على Radix: إمكانية وصول ممتازة (لوحة المفاتيح، قارئ الشاشة) بلا جهد.
- يتكامل مع Next.js وTailwind اللذين اخترناهما أصلاً، وله مكونات جداول ونماذج ورسوم بيانية جاهزة.

**حزم مساندة (لا تضف غيرها دون سبب):**

| الغرض                | الحزمة                                              |
| -------------------- | --------------------------------------------------- |
| أيقونات              | `lucide-react`                                      |
| نماذج + تحقق         | `react-hook-form` + `zod` (+ `@hookform/resolvers`) |
| جداول                | `@tanstack/react-table`                             |
| إشعارات              | `sonner`                                            |
| رسوم بيانية          | `recharts` (عبر مكون chart في shadcn)               |
| قائمة أوامر/بحث سريع | `cmdk` (command في shadcn)                          |
| أدراج الهاتف         | `vaul` (drawer في shadcn)                           |
| تواريخ               | `date-fns` + `Intl` (التقويم الهجري للزكاة)         |

**نتجنب:** مكتبتي UI معاً، وأي مكتبة CSS-in-JS، وثقل غير لازم. المكتبات البديلة المحترمة (Mantine، HeroUI) أثقل أو أقل تحكماً بالهوية.

---

## 2. الهوية البصرية

### 2.1 ألوان الشعار (مقيسة)

| الاسم                | HEX       | الاستعمال                                             |
| -------------------- | --------- | ----------------------------------------------------- |
| **Burgundy** (عنابي) | `#491017` | خلفية الهوية، اللون الأساسي (primary)، الشريط الجانبي |
| **Gold** (ذهبي)      | `#D8A123` | اللون المميز (accent)، الأزرار الأهم، أيقونات، الماسة |
| **Cream** (كريمي)    | `#F0DBC6` | النصوص على العنابي، الأسطح الثانوية                   |
| **Ink** (حبر)        | `#17140F` | ظل الشعار، نص على الذهبي                              |

الأرقام الكاملة للسلالم (50 إلى 950) في `brand-tokens.css`.

### 2.2 التباين المُتحقَّق منه

| الزوج                                    | النسبة  | الحكم                      |
| ---------------------------------------- | ------- | -------------------------- |
| كريمي على عنابي                          | 11.4    | ممتاز                      |
| ذهبي على عنابي                           | 6.6     | جيد للنص والأيقونات        |
| حبر على ذهبي                             | 7.9     | ممتاز (نص الأزرار الذهبية) |
| نص الجسم `#2B1A17` على الخلفية `#FBF5EC` | 15.3    | ممتاز                      |
| نص ثانوي `#6E5A50` على الخلفية           | 6.0     | جيد                        |
| **ذهبي `#D8A123` على الخلفية الفاتحة**   | **2.1** | **مرفوض كنص**              |
| ذهبي داكن `#7A5A0B` على البطاقة الفاتحة  | 6.3     | مقبول كنص                  |

**القاعدة الذهبية:** على الأسطح الفاتحة الذهبي `#D8A123` للتعبئة والحدود والأيقونات الكبيرة فقط، وإن احتجت **نصاً ذهبياً** استعمل `gold-800`. على الأسطح العنابية والداكنة يصلح الذهبي نصاً.

### 2.3 الوضعان

- **فاتح (الافتراضي):** خلفية كريمية دافئة `#FBF5EC`، بطاقات `#FFFDF9`، أساسي عنابي، مميز ذهبي. مناسب لإضاءة المحل نهاراً.
- **داكن:** خلفية عنابية عميقة `#2A0A0F`، الأساسي ذهبي، النص كريمي.
- **الشريط الجانبي عنابي في الوضعين** ليبقى الشعار (الذي لا يظهر إلا على العنابي) في مكانه الصحيح دائماً.
- يتبع النظام تفضيل الجهاز، مع مفتاح يدوي في الإعدادات.

### 2.4 الألوان الدلالية (لا تستعمل ألواناً خام في الميزات)

`success` أخضر، `warning` برتقالي، `destructive` أحمر، `info` أزرق. وللأعمال:

| الاسم       | المعنى                              | اللون     |
| ----------- | ----------------------------------- | --------- |
| `profit`    | ربح                                 | أخضر      |
| `loss`      | خسارة، بيع دون التكلفة              | أحمر      |
| `debt`      | دين مستحق                           | برتقالي   |
| `capital`   | رأس المال                           | أزرق      |
| `estimated` | رقم تقديري/مؤقت (الكيلو قبل القياس) | ذهبي داكن |

الأحمر مختلف عمداً عن العنابي حتى لا يختلط الخطر بالهوية؛ وفوق ذلك **لا يعتمد المعنى على اللون وحده**: أيقونة أو نص مرافق دائماً (مثلاً "خسارة" مع سهم).

### 2.5 الخطوط (Google Fonts عبر `next/font`)

- **العناوين:** `Noto Kufi Arabic` (500–700). هندسي كوفي قريب من روح الشعار.
- **النص والأرقام:** `IBM Plex Sans Arabic` (400–600). واضح في الجداول والأرقام الصغيرة ويحوي اللاتينية.
- الأرقام **غربية (0-9)** مع `tabular-nums` لتصطف في الجداول والفواتير.
- أحجام: 12 / 14 / 16 (أساس) / 18 / 20 / 24 / 30 / 36. تباعد الأسطر 1.7 للنص و1.35 للعناوين. حقول الإدخال لا تقل عن 16px.

### 2.6 الشكل واللمسة

- **الزوايا:** `--radius: 8px` (حقول 6، بطاقات 8، نوافذ 12). حادة نسبياً لتعكس هندسة الشعار، لا فقاعات مستديرة.
- **توقيع الهوية: الماسة الذهبية** (المربع المائل في الشعار): مؤشر العنصر النشط في القائمة، رموز القوائم، ومؤشر التحميل. صنف CSS جاهز `.diamond`.
- **الظلال:** دافئة خفيفة (عنابية الاتجاه)، بلا ظلال رمادية باردة.
- **الحركة:** 150ms ease-out، وتحترم `prefers-reduced-motion`.
- **التباعد:** شبكة 4px. الحد الأدنى لمنطقة اللمس 44px (48px في نقطة البيع).

### 2.7 استعمال الشعار

- يظهر **فقط على خلفية عنابية** (النسخة الحالية كريمية/ذهبية). في الشريط الجانبي، شاشة الدخول، شاشة البداية (splash).
- لا يُغيَّر لونه ولا يُمدَّد، ومساحة حول الشعار لا تقل عن ارتفاع الماسة الذهبية.
- **مهم:** الصورة المتوفرة PNG. اطلب من المصمم نسخة **SVG** ونسخة للخلفيات الفاتحة (حبر/عنابي) للفواتير والتقارير.
- الأيقونات المولَّدة جاهزة في `brand-assets.zip`: `icon-192`, `icon-512`, `icon-maskable-512`, `favicon-64`, `mark-on-burgundy`, `logo-full-on-burgundy`.
- PWA: `theme_color: #491017`، `background_color: #491017` (شاشة البداية)، أيقونة maskable بهامش آمن.

---

## 3. هيكل الواجهة (شاشات المحل)

### سطح المكتب

- **شريط جانبي على اليمين** (RTL)، عنابي، فيه الشعار في الأعلى: بيع، المخزون، شراء، الزبائن، المصروفات، الشركاء، التسوية، الزكاة، التقارير، الإعدادات. العنصر النشط له ماسة ذهبية وخلفية أفتح قليلاً.
- منطقة المحتوى كريمية. رأس الصفحة: العنوان، بحث سريع (`⌘K`/`Ctrl K`)، حالة الاتصال (متصل / دون اتصال + عدد العمليات المعلّقة).

### الهاتف

- **شريط تبويب سفلي** (5 عناصر): بيع، المخزون، شراء، الزبائن، المزيد.
- النوافذ تظهر كأدراج من الأسفل، والحقول كبيرة، وأزرار الإجراء الرئيسية ثابتة أسفل الشاشة.

### قواعد المكونات

- **زر الإجراء الرئيسي في الشاشة:** ذهبي (`variant="accent"`) مثل "إتمام البيع"، **زر واحد فقط** لكل شاشة. الأزرار العادية عنابية. ثانوية: كريمية. الخطرة: حمراء.
- **الأرقام المالية:** مكوّن `<Money cents={..} />` يعرض بحسب إعداد الريال/الدرهم مع `tabular-nums` ولون دلالي عند الحاجة. مكوّن `<Meters cm={..} />` للأطوال. **ممنوع تنسيق الأرقام يدوياً** في الصفحات.
- **الجداول:** صفوف 48px، رأس ثابت، أرقام محاذاة بالنهاية، حالة فارغة مصممة (رسالة + إجراء).
- **النماذج:** تسمية فوق الحقل، رسالة الخطأ تحته بأيقونة ونص، أرقام لوحة مفاتيح رقمية على الهاتف (`inputmode="decimal"`).
- **التنبيهات** (دون التكلفة، تحت الحد الأدنى): شريط ملوّن بأيقونة ونص، لا لون فقط.
- **كل شاشة لها 4 حالات:** تحميل، فارغة، خطأ، ودون اتصال.
- **RTL:** استعمل خصائص منطقية دائماً (`ms-`, `pe-`, `start-`, `text-start`)، وأيقونات الاتجاه (سهم رجوع/تقدم) تُقلب تلقائياً.

---

## 4. هيكل الملفات للتصميم داخل المشروع

```
apps/web/
├── public/brand/            # الأيقونات والشعار (من brand-assets.zip)
├── components.json          # shadcn (rtl: true, aliases → src/shared/ui)
└── src/
    ├── app/
    │   ├── globals.css      # يحوي brand-tokens.css
    │   ├── layout.tsx       # الخطوط، dir="rtl", ThemeProvider
    │   ├── manifest.ts      # PWA
    │   └── (dev)/design/    # معرض المكونات (للتطوير فقط)
    └── shared/
        ├── ui/              # مكونات shadcn (button, input, dialog, table …)
        ├── brand/           # Logo, DiamondBullet, AppShell, Sidebar, BottomNav
        ├── format/          # Money, Meters, DateAr (تستعمل @fabric/core)
        └── lib/utils.ts     # cn()
```

عند ظهور تطبيق ثانٍ (متجر/كتالوج للزبائن) تُستخرج `shared/ui` و`brand` إلى `packages/ui`.

---

## 5. Prompt 0.4 لـ Claude Code (بعد Prompt 0.3 وقبل أي شاشة)

ضع في المشروع قبل التنفيذ: `docs/DESIGN_SYSTEM.md` (هذا الملف)، `brand-tokens.css`، ومجلد الأيقونات في `apps/web/public/brand/`.

```
Implement the design system described in docs/DESIGN_SYSTEM.md. No feature screens yet.

1. shadcn/ui setup in apps/web with Tailwind v4: init with RTL enabled (rtl: true in components.json), components aliased to src/shared/ui. Run the RTL conversion so all generated components use logical properties.
2. Tokens: merge the provided brand-tokens.css into src/app/globals.css exactly (do NOT invent colors). Check that bg-primary, text-muted-foreground, bg-accent, text-profit, bg-burgundy-800, bg-sidebar etc. all resolve.
3. Fonts with next/font/google: Noto Kufi Arabic for headings (--font-heading) and IBM Plex Sans Arabic for body (--font-body), subsets arabic+latin, display swap. Root layout: <html lang="ar" dir="rtl">, ThemeProvider (system default + manual toggle, class strategy), Sonner Toaster positioned correctly for RTL.
4. Add shadcn components: button, input, textarea, label, form, select, combobox (command + popover), checkbox, switch, radio-group, tabs, card, badge, table, dialog, drawer (vaul), sheet, dropdown-menu, tooltip, alert, skeleton, separator, sonner, sidebar, chart, command, calendar, popover. Add an "accent" variant (gold) and "success"/"warning" badge variants to Button/Badge using tokens.
5. Brand components in src/shared/brand: Logo (uses /brand/logo-full-on-burgundy.png and mark; only rendered on burgundy surfaces), DiamondBullet, AppShell (desktop: right-hand burgundy sidebar with gold-diamond active indicator, header with search trigger + connectivity status slot; mobile: bottom tab bar with 5 items + "more" drawer), EmptyState, ErrorState, LoadingState.
6. Format components in src/shared/format using @fabric/core: <Money cents unit?/> (reads the money_display_unit setting; tabular-nums; optional tone: profit|loss|debt|capital|estimated), <Meters cm/>, <DateAr/>. Add a MoneyInput and MeterInput (decimal input, Arabic-Indic digits accepted, inputmode=decimal, returns integer cents/cm via core).
7. PWA: manifest.ts (name غيث, short_name غيث, theme_color #491017, background_color #491017, display standalone, dir rtl, lang ar), icons from /public/brand, favicon.
8. A dev-only gallery at /design (excluded from production build) that renders every component and token in light and dark, plus RTL checks (icons flip, spacing logical).
9. Accessibility checks: add an automated contrast test over the semantic token pairs (background/foreground, primary/primary-foreground, accent/accent-foreground, muted, destructive, success, warning, info, sidebar) in both themes asserting >= 4.5:1 for text pairs and >= 3:1 for input borders and focus ring. Fix tokens only with approval; never lower thresholds.
10. ESLint rule or CI grep: forbid physical Tailwind direction classes (ml-, mr-, pl-, pr-, left-, right-, text-left, text-right) and raw hex colors in features/ and shared/ (except tokens).
Verify: make check passes, /design renders in light and dark, Lighthouse accessibility >= 95 on /design, and screenshots at 375px and 1280px are sensible. Document usage in docs/design-usage.md.
```

**كيف تتأكد:** افتح `/design` على الحاسوب والهاتف، بدّل الوضعين، وتأكد أن الشريط الجانبي على اليمين وأن الأسهم مقلوبة والأرقام مصطفة.

---

## 6. تحديث لقاعدة CLAUDE.md

أضف هذه الأسطر إلى `CLAUDE.md`:

```
## UI rules
- Only use shadcn/ui components from src/shared/ui; colors only via semantic tokens (bg-primary, text-muted-foreground, text-profit…), never raw hex or Tailwind palette colors.
- Gold (#D8A123) is never used as text on light surfaces; use text-gold-800 there. Gold text is fine on burgundy/dark.
- One accent (gold) primary action per screen. Meaning is never conveyed by color alone.
- RTL: logical Tailwind classes only (ms-/me-/ps-/pe-/start-/end-/text-start/text-end).
- Always render money/lengths via <Money/>, <Meters/>, <MoneyInput/>, <MeterInput/>.
- Every screen implements loading, empty, error and offline states.
- The logo appears only on burgundy backgrounds.
```
