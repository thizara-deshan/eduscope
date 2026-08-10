import type { ReactNode } from 'react';
import { QuizAppProviders } from '../src/app/quiz-app-providers.js';
import './globals.css';

export const metadata = { title: 'Eduscope Quiz' };
export const viewport = { width: 'device-width', initialScale: 1, maximumScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QuizAppProviders>{children}</QuizAppProviders>
      </body>
    </html>
  );
}
