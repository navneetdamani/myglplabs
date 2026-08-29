import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://myglplabs.com'),
  title: 'My GLP Labs | Weight loss care without the runaround',
  description: 'Transparent online GLP-1 weight care with licensed providers, medication delivery, and ongoing support. No insurance needed.',
  openGraph: {
    title: 'Weight loss care. Without the runaround.',
    description: 'GLP-1 treatment, provider support, and delivery in one clear plan.',
    images: [{ url: '/og.png', width: 1730, height: 909, alt: 'My GLP Labs — Weight loss care without the runaround.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Weight loss care. Without the runaround.',
    description: 'GLP-1 treatment, provider support, and delivery in one clear plan.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
