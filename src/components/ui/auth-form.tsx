'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Mode = 'login' | 'register';

type ApiResponse = { ok: true; data: unknown } | { ok: false; error: { message: string } };

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const isRegister = mode === 'register';

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const payload: Record<string, string> = {
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
    };
    if (isRegister) {
      payload.displayName = String(form.get('displayName') ?? '');
      payload.role = String(form.get('role') ?? 'DONOR');
    }

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as ApiResponse;

      if (!body.ok) {
        setError(body.error.message);
        setPending(false);
        return;
      }

      router.push('/dashboard');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4">
      {isRegister && (
        <Field label="Name" name="displayName" type="text" autoComplete="name" required />
      )}

      <Field label="Email" name="email" type="email" autoComplete="email" required />

      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete={isRegister ? 'new-password' : 'current-password'}
        required
        hint={isRegister ? 'At least 10 characters.' : undefined}
      />

      {isRegister && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">I am signing up as</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="role" value="DONOR" defaultChecked className="accent-clay" />
            Someone with surplus food or goods
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="role" value="RECIPIENT" className="accent-clay" />
            An organisation that receives surplus
          </label>
        </fieldset>
      )}

      {error !== null && (
        <p role="alert" className="text-urgency-critical-ink text-sm">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="bg-clay rounded-card w-full px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? 'Working…' : isRegister ? 'Create account' : 'Sign in'}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  type,
  autoComplete,
  required,
  hint,
}: {
  label: string;
  name: string;
  type: string;
  autoComplete: string;
  required?: boolean;
  hint?: string;
}) {
  const hintId = hint ? `${name}-hint` : undefined;

  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        aria-describedby={hintId}
        className="border-line bg-paper-raised rounded-card mt-1.5 w-full border px-3 py-2.5 text-base"
      />
      {hint && (
        <p id={hintId} className="text-slate mt-1 text-xs">
          {hint}
        </p>
      )}
    </div>
  );
}
