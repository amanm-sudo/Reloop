import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { SignOutButton } from '@/components/ui/sign-out-button';

/**
 * Signed-in shell. Bottom navigation on phones and a top row from `sm` up — the primary users are
 * on phones, so the thumb-reachable position is the default rather than the adaptation.
 */

const TABS = [
  { href: '/dashboard', label: 'Pantry' },
  { href: '/map', label: 'Map' },
  { href: '/impact', label: 'Impact' },
] as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <div className="min-h-dvh pb-16 sm:pb-0">
      <header className="border-line bg-paper/90 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-3">
          <Link href="/dashboard" className="text-clay-ink text-sm font-semibold tracking-wide uppercase">
            ReLoop
          </Link>

          <nav aria-label="Sections" className="hidden sm:block">
            <ul className="flex items-center gap-1">
              {TABS.map((tab) => (
                <li key={tab.href}>
                  <Link
                    href={tab.href}
                    className="rounded-card hover:bg-paper-sunken px-3 py-1.5 text-sm font-medium"
                  >
                    {tab.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <SignOutButton />
        </div>
      </header>

      {children}

      {/* Bottom bar on phones. */}
      <nav
        aria-label="Sections"
        className="border-line bg-paper/95 fixed inset-x-0 bottom-0 z-10 border-t backdrop-blur sm:hidden"
      >
        <ul className="mx-auto flex max-w-3xl">
          {TABS.map((tab) => (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                className="block px-3 py-3.5 text-center text-sm font-medium"
              >
                {tab.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
