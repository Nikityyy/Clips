import type { Metadata, Viewport } from 'next';
import '@fontsource/mukta-mahee/latin-400.css';
import '@fontsource/mukta-mahee/latin-ext-400.css';
import '@fontsource/mukta-mahee/latin-500.css';
import '@fontsource/mukta-mahee/latin-ext-500.css';
import '@fontsource/mukta-mahee/latin-600.css';
import '@fontsource/mukta-mahee/latin-ext-600.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Clips',
  description: 'A local-first visual creation studio.',
  applicationName: 'Clips',
  authors: [{ name: 'Nikita Berger' }],
  creator: 'Nikita Berger',
  openGraph: { title: 'Clips', description: 'A local-first visual creation studio.', type: 'website' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#111110',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
