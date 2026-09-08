import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ReLoop — surplus, handled before it becomes waste',
  description:
    'A network of cooperating agents that notices surplus food, works out how urgently it must move, negotiates a handoff with a recovery partner, schedules the pickup, and quantifies what was saved.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f7f4ef',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
