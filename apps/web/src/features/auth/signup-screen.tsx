'use client';

import { normalizeSetupCode, SETUP_CODE_TYPED_MAX, SHOP_NAME_MAX } from '@fabric/contracts';
import { CheckIcon, LockIcon, WifiOffIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { checkLogoFile, LogoField, logoSrcOf, SellingUnitToggles } from '@/features/settings';
import { messages } from '@/i18n';
import { ApiError, NetworkError, useRegistrationOpen, useSession } from '@/local-db';
import { BrandMark, EmptyState, LoadingState } from '@/shared/brand';
import { compressImage, ImageError } from '@/shared/lib/image';
import { cn } from '@/shared/lib/utils';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldTitle,
} from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { AuthLayout } from './auth-layout';
import { PasswordField } from './password-field';
import {
  type AccountField,
  accountProblems,
  emptyDraft,
  firstInvalidStep,
  type MoneyUnitChoice,
  type PasswordStrength,
  passwordStrength,
  registrationFailureOf,
  registrationRequestOf,
  SIGNUP_STEPS,
  type SignupDraft,
  type SignupStep,
  shopProblem,
  stepIsValid,
  unitsProblem,
} from './registration-model';

const MONEY_UNITS = ['rial', 'dirham'] as const satisfies readonly MoneyUnitChoice[];
const STRENGTH_LEVEL: Record<PasswordStrength, number> = { weak: 1, fair: 2, good: 3, strong: 4 };

/**
 * The first owner sets the shop up (ADR 0023): four steps (the owner's account, the shop's name
 * and logo, the units and currency, a review), then one request that creates the account and the
 * shop's settings together. Open only while the server has no owner: afterwards the page says it
 * is closed. Everything is held in memory until the last step, so leaving the page saves nothing.
 * On a server with many shops the first step also asks for the setup code of the shop (ADR 0029).
 */
export function SignupScreen() {
  const registration = useRegistrationOpen();
  const s = messages.signup;

  let body: ReactNode;
  if (registration.state === 'closed') {
    body = (
      <EmptyState
        icon={LockIcon}
        title={s.closed.title}
        description={s.closed.description}
        titleAs="h1"
        action={
          <Button variant="accent" asChild>
            <Link href="/login">{s.closed.signIn}</Link>
          </Button>
        }
      />
    );
  } else if (registration.state === 'unknown' && registration.asking) {
    body = <LoadingState variant="spinner" label={s.checking} />;
  } else if (registration.state === 'unknown') {
    body = (
      <EmptyState
        icon={WifiOffIcon}
        title={s.offline.title}
        description={s.offline.description}
        titleAs="h1"
        action={
          <Button variant="accent" onClick={registration.retry}>
            {s.offline.retry}
          </Button>
        }
      />
    );
  } else {
    body = (
      <SignupWizard
        setupCodeRequired={registration.setupCodeRequired}
        onClosed={registration.retry}
      />
    );
  }

  return <AuthLayout wide>{body}</AuthLayout>;
}

function SignupWizard({
  setupCodeRequired,
  onClosed,
}: {
  setupCodeRequired: boolean;
  onClosed: () => void;
}) {
  const s = messages.signup;
  const id = useId();
  const router = useRouter();
  const session = useSession();
  const [draft, setDraft] = useState<SignupDraft>(emptyDraft);
  const [step, setStep] = useState<SignupStep>('account');
  const [touched, setTouched] = useState<Partial<Record<AccountField | 'shopName', boolean>>>({});
  const [tried, setTried] = useState<Partial<Record<SignupStep, boolean>>>({});
  const [takenEmail, setTakenEmail] = useState<string | null>(null);
  /** The code the server did not take, as the server reads it; typing another one clears it. */
  const [refusedCode, setRefusedCode] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** A second tap before the first answer comes back must not send a second request. */
  const sendingRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRenderRef = useRef(true);

  useEffect(() => {
    // A step change moves reading to the new step; the first render keeps the page's own focus.
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const update = (patch: Partial<SignupDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };
  const touch = (field: AccountField | 'shopName') => {
    setTouched((current) => ({ ...current, [field]: true }));
  };

  const account = accountProblems(draft, setupCodeRequired);
  const emailIsTaken = takenEmail !== null && takenEmail === draft.email.trim().toLowerCase();
  const codeIsRefused =
    setupCodeRequired &&
    refusedCode !== null &&
    refusedCode === normalizeSetupCode(draft.setupCode);
  const a = s.account;
  const accountText = (field: AccountField): string | null => {
    if (!touched[field] && !tried.account) return null;
    if (field === 'email' && emailIsTaken) return a.email.taken;
    if (field === 'setupCode' && codeIsRefused) return a.setupCode.refused;
    const problem = account[field];
    if (problem === undefined) return null;
    switch (field) {
      case 'setupCode':
        return problem === 'required' ? a.setupCode.required : a.setupCode.invalid;
      case 'fullName':
        return a.fullName.required;
      case 'email':
        return problem === 'required'
          ? a.email.required
          : problem === 'characters'
            ? a.email.characters
            : a.email.invalid;
      case 'password':
        return problem === 'required' ? a.password.required : a.password.tooShort;
      case 'confirmPassword':
        return problem === 'required' ? a.confirmPassword.required : a.confirmPassword.mismatch;
    }
  };
  const shopError = touched.shopName || tried.shop ? shopProblem(draft) : null;
  const unitsError = tried.selling && unitsProblem(draft) !== null;

  const index = SIGNUP_STEPS.indexOf(step);
  const valid = (target: SignupStep) =>
    stepIsValid(target, draft, setupCodeRequired) &&
    !(target === 'account' && (emailIsTaken || codeIsRefused));

  const focusFirstInvalid = () => {
    requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    });
  };

  const next = () => {
    setTried((current) => ({ ...current, [step]: true }));
    if (!valid(step)) {
      focusFirstInvalid();
      return;
    }
    const target = SIGNUP_STEPS[index + 1];
    if (target !== undefined) setStep(target);
  };
  const back = () => {
    const target = SIGNUP_STEPS[index - 1];
    if (target !== undefined) setStep(target);
  };

  const pickLogo = (file: File) => {
    const p = messages.settings.profile.logo;
    setLogoError(null);
    const problem = checkLogoFile(file);
    if (problem !== null) {
      setLogoError(problem === 'not_image' ? p.errors.notImage : p.errors.tooBig);
      return;
    }
    setPreparing(true);
    compressImage(file)
      .then((image) => {
        update({ logo: image });
      })
      .catch((error: unknown) => {
        setLogoError(
          error instanceof ImageError && error.reason === 'too_large'
            ? p.errors.tooLarge
            : p.errors.unreadable,
        );
      })
      .finally(() => {
        setPreparing(false);
      });
  };

  const create = () => {
    if (sendingRef.current) return;
    const invalid = firstInvalidStep(draft, setupCodeRequired);
    if (invalid !== null || emailIsTaken || codeIsRefused) {
      setTried({ account: true, shop: true, selling: true });
      setStep(invalid ?? 'account');
      return;
    }
    sendingRef.current = true;
    setBusy(true);
    setFailure(null);
    session
      .register(registrationRequestOf(draft, setupCodeRequired))
      .then(() => {
        router.replace('/home');
      })
      .catch((caught: unknown) => {
        const api = caught instanceof ApiError ? caught : null;
        const reason = registrationFailureOf({
          network: caught instanceof NetworkError,
          code: api?.code,
          issues: api?.issues,
        });
        if (reason === 'email_taken') {
          setTakenEmail(draft.email.trim().toLowerCase());
          setStep('account');
          focusFirstInvalid();
        } else if (reason === 'registration_closed' && setupCodeRequired) {
          // The server answers a wrong, old or used code as it answers a closed sign-up, so ask
          // again, without leaving the form: closed for good ends the page, a refused code does not.
          setRefusedCode(normalizeSetupCode(draft.setupCode));
          setTried((current) => ({ ...current, account: true }));
          setStep('account');
          focusFirstInvalid();
          session
            .registrationOpen()
            .then((open) => {
              if (!open) onClosed();
            })
            .catch(() => {
              // Offline now: the code field already says what is known.
            });
        } else {
          setFailure(s.errors[reason]);
          // Another browser finished first: the page now says sign-up is closed.
          if (reason === 'registration_closed') onClosed();
        }
        setBusy(false);
        sendingRef.current = false;
      });
  };

  const strength = passwordStrength(draft.password);
  const logoSrc = logoSrcOf(draft.logo);
  const enabledUnits = (['piece', 'kg', 'meter'] as const).filter((unit) => draft.units[unit]);

  return (
    <form
      ref={formRef}
      noValidate
      className="grid gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (step === 'review') create();
        else next();
      }}
    >
      <header className="grid gap-1.5">
        <h1 className="font-heading text-2xl font-semibold">{s.title}</h1>
        <p className="text-sm text-muted-foreground">{s.description}</p>
      </header>

      <StepIndicator step={step} />

      {failure !== null && (
        <Alert variant="destructive" aria-live="assertive">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      )}

      <fieldset disabled={busy} className="grid min-w-0 gap-6 border-0 p-0">
        {step === 'account' && (
          <section aria-labelledby={`${id}-heading`} className="grid gap-5">
            <StepHeading
              ref={headingRef}
              id={`${id}-heading`}
              title={a.title}
              text={a.description}
            />
            {setupCodeRequired && (
              <Field data-invalid={accountText('setupCode') !== null}>
                <FieldLabel htmlFor={`${id}-code`}>{a.setupCode.label}</FieldLabel>
                <Input
                  id={`${id}-code`}
                  autoComplete="off"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  dir="ltr"
                  className="text-start font-mono tracking-wider uppercase"
                  maxLength={SETUP_CODE_TYPED_MAX}
                  placeholder={a.setupCode.placeholder}
                  value={draft.setupCode}
                  aria-invalid={accountText('setupCode') !== null}
                  aria-describedby={`${id}-code-note`}
                  onChange={(event) => {
                    update({ setupCode: event.target.value });
                  }}
                  onBlur={() => {
                    touch('setupCode');
                  }}
                />
                {accountText('setupCode') !== null ? (
                  <FieldError id={`${id}-code-note`}>{accountText('setupCode')}</FieldError>
                ) : (
                  <FieldDescription id={`${id}-code-note`}>{a.setupCode.hint}</FieldDescription>
                )}
              </Field>
            )}
            <Field data-invalid={accountText('fullName') !== null}>
              <FieldLabel htmlFor={`${id}-name`}>{a.fullName.label}</FieldLabel>
              <Input
                id={`${id}-name`}
                autoComplete="name"
                placeholder={a.fullName.placeholder}
                value={draft.fullName}
                aria-invalid={accountText('fullName') !== null}
                aria-describedby={`${id}-name-error`}
                onChange={(event) => {
                  update({ fullName: event.target.value });
                }}
                onBlur={() => {
                  touch('fullName');
                }}
              />
              {accountText('fullName') !== null && (
                <FieldError id={`${id}-name-error`}>{accountText('fullName')}</FieldError>
              )}
            </Field>
            <Field data-invalid={accountText('email') !== null}>
              <FieldLabel htmlFor={`${id}-email`}>{a.email.label}</FieldLabel>
              <Input
                id={`${id}-email`}
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                dir="ltr"
                className="text-start"
                placeholder={a.email.placeholder}
                value={draft.email}
                aria-invalid={accountText('email') !== null}
                aria-describedby={`${id}-email-error`}
                onChange={(event) => {
                  update({ email: event.target.value });
                }}
                onBlur={() => {
                  touch('email');
                }}
              />
              {accountText('email') !== null && (
                <FieldError id={`${id}-email-error`}>{accountText('email')}</FieldError>
              )}
            </Field>
            <PasswordField
              id={`${id}-password`}
              label={a.password.label}
              value={draft.password}
              autoComplete="new-password"
              hint={a.password.hint}
              error={accountText('password')}
              onChange={(password) => {
                update({ password });
              }}
              onBlur={() => {
                touch('password');
              }}
            >
              {draft.password !== '' && <StrengthMeter strength={strength} />}
            </PasswordField>
            <PasswordField
              id={`${id}-confirm`}
              label={a.confirmPassword.label}
              value={draft.confirmPassword}
              autoComplete="new-password"
              error={accountText('confirmPassword')}
              onChange={(confirmPassword) => {
                update({ confirmPassword });
              }}
              onBlur={() => {
                touch('confirmPassword');
              }}
            />
          </section>
        )}

        {step === 'shop' && (
          <section aria-labelledby={`${id}-heading`} className="grid gap-5">
            <StepHeading
              ref={headingRef}
              id={`${id}-heading`}
              title={s.shop.title}
              text={s.shop.description}
            />
            <Field data-invalid={shopError !== null}>
              <FieldLabel htmlFor={`${id}-shop`}>{s.shop.name.label}</FieldLabel>
              <Input
                id={`${id}-shop`}
                autoComplete="organization"
                maxLength={SHOP_NAME_MAX}
                placeholder={s.shop.name.placeholder}
                value={draft.shopName}
                aria-invalid={shopError !== null}
                aria-describedby={`${id}-shop-note`}
                onChange={(event) => {
                  update({ shopName: event.target.value });
                }}
                onBlur={() => {
                  touch('shopName');
                }}
              />
              {shopError !== null ? (
                <FieldError id={`${id}-shop-note`}>{s.shop.name.required}</FieldError>
              ) : (
                <FieldDescription id={`${id}-shop-note`}>
                  {s.shop.name.hint(SHOP_NAME_MAX)}
                </FieldDescription>
              )}
            </Field>
            <div className="grid gap-2">
              <span className="text-sm font-medium">{s.shop.logo.label}</span>
              <LogoField
                src={logoSrc}
                changed={false}
                hasLogo={logoSrc !== null}
                busy={preparing}
                disabled={false}
                error={logoError}
                note={logoSrc !== null ? s.shop.logo.ready : undefined}
                onFile={pickLogo}
                onRemove={() => {
                  setLogoError(null);
                  update({ logo: null });
                }}
              />
            </div>
          </section>
        )}

        {step === 'selling' && (
          <section aria-labelledby={`${id}-heading`} className="grid gap-6">
            <StepHeading
              ref={headingRef}
              id={`${id}-heading`}
              title={s.selling.title}
              text={s.selling.description}
            />
            <SellingUnitToggles
              value={draft.units}
              showError={unitsError}
              onChange={(units) => {
                update({ units });
              }}
            />
            <div className="grid gap-3">
              <div className="grid gap-0.5">
                <h3 className="font-heading text-base font-semibold">{s.selling.currency.title}</h3>
                <p className="text-sm text-muted-foreground">{s.selling.currency.description}</p>
              </div>
              <RadioGroup
                value={draft.currency}
                aria-label={s.selling.currency.title}
                className="grid gap-2 sm:grid-cols-2"
                onValueChange={(value) => {
                  update({ currency: value === 'dirham' ? 'dirham' : 'rial' });
                }}
              >
                {MONEY_UNITS.map((option) => (
                  <FieldLabel
                    key={option}
                    htmlFor={`${id}-${option}`}
                    className="has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                  >
                    <Field orientation="horizontal">
                      <FieldContent>
                        <FieldTitle>{messages.settings.regional.unit[option].title}</FieldTitle>
                        <FieldDescription>
                          {messages.settings.regional.unit[option].hint}
                        </FieldDescription>
                      </FieldContent>
                      <RadioGroupItem value={option} id={`${id}-${option}`} />
                    </Field>
                  </FieldLabel>
                ))}
              </RadioGroup>
              <p className="text-sm font-medium">{messages.settings.regional.rate}</p>
            </div>
          </section>
        )}

        {step === 'review' && (
          <section aria-labelledby={`${id}-heading`} className="grid gap-4">
            <StepHeading
              ref={headingRef}
              id={`${id}-heading`}
              title={s.review.title}
              text={s.review.description}
            />
            <ReviewGroup
              title={s.review.account}
              onEdit={() => {
                setStep('account');
              }}
              rows={[
                [s.review.fullName, draft.fullName.trim()],
                [s.review.email, draft.email.trim().toLowerCase()],
                [s.review.password, s.review.passwordHidden],
              ]}
            />
            <ReviewGroup
              title={s.review.shop}
              onEdit={() => {
                setStep('shop');
              }}
              rows={[
                [s.review.shopName, draft.shopName.trim()],
                [
                  s.review.logo,
                  <span key="logo" className="flex items-center gap-2">
                    {logoSrc !== null && <BrandMark logoSrc={logoSrc} className="h-8" />}
                    {logoSrc !== null ? s.review.logoSet : s.review.logoNone}
                  </span>,
                ],
              ]}
            />
            <ReviewGroup
              title={s.review.selling}
              onEdit={() => {
                setStep('selling');
              }}
              rows={[
                [
                  s.review.units,
                  enabledUnits.length === 0
                    ? s.review.unitsNone
                    : enabledUnits.map((unit) => messages.sellingUnits[unit].title).join(' · '),
                ],
                [s.review.currency, messages.settings.regional.unit[draft.currency].title],
              ]}
            />
          </section>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        {index > 0 ? (
          <Button type="button" variant="outline" size="lg" disabled={busy} onClick={back}>
            {s.nav.back}
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" variant="accent" size="lg" disabled={busy} aria-busy={busy}>
          {step === 'review' ? (busy ? s.review.creating : s.review.create) : s.nav.next}
        </Button>
      </div>

      <p className="text-center text-sm text-muted-foreground">
        {s.haveAccount}{' '}
        <Link
          href="/login"
          className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
        >
          {s.signIn}
        </Link>
      </p>
    </form>
  );
}

function StepHeading({
  ref,
  id,
  title,
  text,
}: {
  ref: React.Ref<HTMLHeadingElement>;
  id: string;
  title: string;
  text: string;
}) {
  return (
    <div className="grid gap-0.5">
      <h2
        ref={ref}
        id={id}
        tabIndex={-1}
        className="font-heading text-lg font-semibold outline-none"
      >
        {title}
      </h2>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function StepIndicator({ step }: { step: SignupStep }) {
  const s = messages.signup;
  const index = SIGNUP_STEPS.indexOf(step);
  return (
    <nav aria-label={s.stepsLabel} className="grid gap-2">
      <ol className="flex items-center gap-2">
        {SIGNUP_STEPS.map((name, position) => {
          const done = position < index;
          const current = position === index;
          return (
            <li
              key={name}
              aria-current={current ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2',
                position < SIGNUP_STEPS.length - 1 && 'flex-1',
              )}
            >
              <span
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold',
                  current && 'border-primary bg-primary text-primary-foreground',
                  done && 'border-primary bg-primary/10 text-primary',
                  !current && !done && 'border-input text-muted-foreground',
                )}
              >
                {done ? <CheckIcon className="size-4" aria-hidden /> : position + 1}
              </span>
              <span
                className={cn(
                  'text-sm whitespace-nowrap',
                  current ? 'font-medium' : 'hidden text-muted-foreground sm:inline',
                )}
              >
                {s.steps[name]}
              </span>
              {position < SIGNUP_STEPS.length - 1 && (
                <span
                  aria-hidden
                  className={cn('h-px flex-1', done ? 'bg-primary' : 'bg-border')}
                />
              )}
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-muted-foreground">{s.stepOf(index + 1, SIGNUP_STEPS.length)}</p>
    </nav>
  );
}

/** Four bars and a word: how strong the password looks. It is a hint; only the length is a rule. */
function StrengthMeter({ strength }: { strength: PasswordStrength }) {
  const label = messages.signup.account.strength;
  const level = STRENGTH_LEVEL[strength];
  return (
    <div className="flex items-center gap-3">
      <div
        role="meter"
        aria-label={label.label}
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={level}
        aria-valuetext={label[strength]}
        className="flex flex-1 gap-1"
      >
        {[1, 2, 3, 4].map((bar) => (
          <span
            key={bar}
            className={cn(
              'h-1.5 flex-1 rounded-full',
              bar > level
                ? 'bg-muted'
                : level <= 1
                  ? 'bg-destructive'
                  : level === 2
                    ? 'bg-warning'
                    : 'bg-success',
            )}
          />
        ))}
      </div>
      <span className="w-14 text-xs font-medium text-muted-foreground">{label[strength]}</span>
    </div>
  );
}

function ReviewGroup({
  title,
  rows,
  onEdit,
}: {
  title: string;
  rows: readonly (readonly [string, ReactNode])[];
  onEdit: () => void;
}) {
  return (
    <div className="grid gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-heading text-base font-semibold">{title}</h3>
        <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
          {messages.signup.review.edit}
        </Button>
      </div>
      <dl className="grid gap-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-0.5 sm:grid-cols-[8rem_1fr] sm:gap-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 font-medium break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
