"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "@/components/icon";
import { fetchSession, login, signup } from "@/lib/auth/client";
import { safeNext } from "@/lib/auth/next-path";

const INPUT =
  "w-full pl-11 pr-space-md py-space-md bg-surface-container text-on-surface font-body-md text-body-md rounded-lg focus:outline-none focus:bg-surface-container-highest transition-all duration-150 placeholder:text-outline-variant shadow-inner";
const SSO_BUTTON =
  "w-full flex items-center justify-between px-space-lg py-space-md bg-surface-container rounded-lg shadow-sm opacity-60 cursor-not-allowed";


export function LoginForm() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [signupOpen, setSignupOpen] = useState(false);
  const [firstRun, setFirstRun] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSession()
      .then((info) => {
        setSignupOpen(info.signupOpen);
        setFirstRun(info.firstRun);
        if (info.firstRun) setMode("signup");
      })
      .catch(() => setError("Couldn't reach the server."));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") await signup({ name, email, password, remember });
      else await login({ email, password, remember });
      // Full navigation so the session cookie applies to every server-rendered request.
      window.location.assign(next);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const signingUp = mode === "signup";

  return (
    <div className="bg-surface-container-low/90 backdrop-blur-xl p-space-2xl rounded-xl shadow-2xl flex flex-col gap-space-xl">
      <div>
        <div className="flex items-center justify-between">
          <span className="font-label-sm text-label-sm uppercase tracking-widest text-primary font-bold">Secure Access Gateway</span>
          <span className="font-body-sm text-body-sm text-on-surface-variant">Email &amp; password</span>
        </div>
        <h1 className="font-display-lg text-display-lg text-on-surface font-semibold tracking-tight mt-space-xs">
          {signingUp ? (firstRun ? "Create the Owner Account" : "Create Your Account") : "Sign In to Workspace"}
        </h1>
        <p className="font-body-md text-body-md text-on-surface-variant mt-space-xxs">
          {firstRun
            ? "No accounts exist yet. The first account you create here can access everything."
            : "Sign in to edit workflows, manage secrets and run flows."}
        </p>
      </div>

      {!signingUp && (
        <>
          <div className="flex flex-col gap-space-sm" title="Single sign-on isn't configured on this server">
            <button className={SSO_BUTTON} disabled type="button">
              <div className="flex items-center gap-space-md">
                <svg className="w-5 h-5 text-on-surface" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    clipRule="evenodd"
                    fillRule="evenodd"
                    d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                  />
                </svg>
                <span className="font-label-md text-label-md text-on-surface">Continue with GitHub</span>
              </div>
              <span className="font-label-sm text-label-sm text-outline px-space-xs py-0.5 rounded bg-surface-container-low">Not configured</span>
            </button>
            <button className={SSO_BUTTON} disabled type="button">
              <div className="flex items-center gap-space-md">
                <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.7 14.8 1 12 1 7.4 1 3.5 3.6 1.6 7.4l3.7 2.9C6.2 7.3 8.9 5 12 5z" fill="#EA4335" />
                  <path d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5.1 3.7-8.9z" fill="#4285F4" />
                  <path d="M5.3 14.7c-.2-.7-.4-1.5-.4-2.7s.1-2 .4-2.7L1.6 6.4C.6 8.3 0 10.1 0 12s.6 3.7 1.6 5.6l3.7-2.9z" fill="#FBBC05" />
                  <path d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3.1 0-5.8-2.3-6.7-5.3L1.6 16c1.9 3.8 5.8 7 10.4 7z" fill="#34A853" />
                </svg>
                <span className="font-label-md text-label-md text-on-surface">Continue with Google Workspace</span>
              </div>
              <span className="font-label-sm text-label-sm text-outline px-space-xs py-0.5 rounded bg-surface-container-low">Not configured</span>
            </button>
            <button className={SSO_BUTTON} disabled type="button">
              <div className="flex items-center gap-space-md">
                <Icon name="vpn_key" className="text-secondary text-headline-sm" />
                <span className="font-label-md text-label-md text-on-surface">Continue with Okta / SAML SSO</span>
              </div>
              <span className="font-label-sm text-label-sm text-outline px-space-xs py-0.5 rounded bg-surface-container-low">Not configured</span>
            </button>
          </div>
          <div className="relative flex items-center justify-center my-space-xs">
            <div className="w-full h-px bg-surface-variant" />
            <span className="absolute px-space-md bg-surface-container-low font-label-sm text-label-sm text-outline uppercase tracking-wider">
              Sign in with team credentials
            </span>
          </div>
        </>
      )}

      <form className="flex flex-col gap-space-lg" onSubmit={submit}>
        {signingUp && (
          <div className="flex flex-col gap-space-xs">
            <label className="font-label-md text-label-md text-on-surface" htmlFor="full-name">
              Full Name
            </label>
            <div className="relative flex items-center">
              <Icon name="badge" className="absolute left-space-md text-outline text-headline-sm pointer-events-none" />
              <input
                autoComplete="name"
                className={INPUT}
                id="full-name"
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alex Rivera"
                required
                value={name}
              />
            </div>
          </div>
        )}
        <div className="flex flex-col gap-space-xs">
          <label className="font-label-md text-label-md text-on-surface flex items-center justify-between" htmlFor="work-email">
            <span>Work Email</span>
          </label>
          <div className="relative flex items-center">
            <Icon name="alternate_email" className="absolute left-space-md text-outline text-headline-sm pointer-events-none" />
            <input
              autoComplete="email"
              className={INPUT}
              id="work-email"
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alex@company.com"
              required
              type="email"
              value={email}
            />
          </div>
        </div>
        <div className="flex flex-col gap-space-xs">
          <div className="flex items-center justify-between">
            <label className="font-label-md text-label-md text-on-surface" htmlFor="master-pwd">
              Password
            </label>
            {signingUp ? (
              <span className="font-label-sm text-label-sm text-outline">At least 10 characters</span>
            ) : (
              <span className="font-label-sm text-label-sm text-outline" title="An admin can run: npm run user -- reset-password <email>">
                Forgot it? An admin can reset it
              </span>
            )}
          </div>
          <div className="relative flex items-center">
            <Icon name="lock" className="absolute left-space-md text-outline text-headline-sm pointer-events-none" />
            <input
              autoComplete={signingUp ? "new-password" : "current-password"}
              className={`${INPUT} pr-11`}
              id="master-pwd"
              minLength={signingUp ? 10 : undefined}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              required
              type={showPassword ? "text" : "password"}
              value={password}
            />
            <button
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-space-md text-outline hover:text-on-surface transition-colors p-1 flex items-center justify-center rounded"
              onClick={() => setShowPassword((v) => !v)}
              type="button"
            >
              <Icon name={showPassword ? "visibility_off" : "visibility"} className="text-headline-sm" />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between pt-space-xxs">
          <label className="flex items-center gap-space-sm cursor-pointer select-none">
            <input
              checked={remember}
              className="w-4 h-4 rounded bg-surface-container accent-primary cursor-pointer"
              onChange={(e) => setRemember(e.target.checked)}
              type="checkbox"
            />
            <span className="font-body-sm text-body-sm text-on-surface-variant">Remember device for 30 days</span>
          </label>
        </div>

        {error && (
          <div role="alert" className="px-space-md py-space-xs rounded-lg bg-error-container/50 text-on-error-container font-body-sm text-body-sm">
            {error}
          </div>
        )}

        <button
          className="w-full py-space-md px-space-xl bg-primary text-on-primary font-headline-sm text-headline-sm font-semibold rounded-lg shadow-xl shadow-primary/25 hover:bg-primary-fixed hover:shadow-primary/40 active:scale-[0.99] transition-all duration-150 flex items-center justify-center gap-space-sm group mt-space-xs disabled:opacity-60"
          disabled={busy}
          type="submit"
        >
          <span>{busy ? "Please wait…" : signingUp ? "Create Account & Sign In" : "Sign In to Workspace"}</span>
          <Icon
            name={busy ? "progress_activity" : "arrow_forward"}
            className={`text-headline-sm transition-transform ${busy ? "animate-spin" : "group-hover:translate-x-1"}`}
          />
        </button>
      </form>

      <div className="flex items-center justify-between pt-space-xs font-body-sm text-body-sm text-on-surface-variant">
        {signingUp ? (
          !firstRun && (
            <>
              <span>Already have an account?</span>
              <button className="font-label-md text-label-md text-primary hover:underline" onClick={() => setMode("signin")} type="button">
                Sign in
              </button>
            </>
          )
        ) : signupOpen ? (
          <>
            <span>New to this workspace?</span>
            <button className="font-label-md text-label-md text-primary hover:underline" onClick={() => setMode("signup")} type="button">
              Create account
            </button>
          </>
        ) : (
          <span>Need access? An admin can add you with npm run user -- create.</span>
        )}
      </div>
    </div>
  );
}
