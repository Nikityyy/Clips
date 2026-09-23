import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/manrope/wght.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Clips',
  description: 'A local-first visual creation studio.',
  applicationName: 'Clips',
  authors: [{ name: 'Nikita Berger' }],
  creator: 'Nikita Berger',
  openGraph: { title: 'Clips', description: 'A local-first visual creation studio.', type: 'website' },
  icons: { icon: [{ url: 'clips.png', type: 'image/png' }] },
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
