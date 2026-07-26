import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MERIDIAN — Private Travel Intelligence',
  description:
    'The world, mapped by where it is worth being. A live index of the events, seasons and openings that move people who move on their own schedule.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#04050a',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="h-full overflow-hidden antialiased">{children}</body>
    </html>
  );
}
