import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/ui/auth-form';
import { getSession } from '@/lib/auth';

export const metadata = { title: 'Create an account · ReLoop' };

export default async function RegisterPage() {
  if (await getSession()) redirect('/dashboard');

  return (
    <main className="mx-auto max-w-sm px-5 py-12 sm:py-20">
      <Link href="/" className="text-clay-ink text-sm font-medium tracking-wide uppercase">
        ReLoop
      </Link>
      <h1 className="mt-3 text-2xl font-semibold">Create an account</h1>
      <p className="text-slate mt-2 text-sm">
        You will set your location next — every agent decision depends on where you are.
      </p>

      <AuthForm mode="register" />

      <p className="text-slate mt-6 text-sm">
        Already registered?{' '}
        <Link href="/login" className="text-clay-ink underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
