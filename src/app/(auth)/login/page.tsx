import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/ui/auth-form';
import { getSession } from '@/lib/auth';

export const metadata = { title: 'Sign in · ReLoop' };

export default async function LoginPage() {
  if (await getSession()) redirect('/dashboard');

  return (
    <main className="mx-auto max-w-sm px-5 py-12 sm:py-20">
      <Link href="/" className="text-clay-ink text-sm font-medium tracking-wide uppercase">
        ReLoop
      </Link>
      <h1 className="mt-3 text-2xl font-semibold">Sign in</h1>

      <AuthForm mode="login" />

      <p className="text-slate mt-6 text-sm">
        No account yet?{' '}
        <Link href="/register" className="text-clay-ink underline">
          Create one
        </Link>
      </p>
    </main>
  );
}
