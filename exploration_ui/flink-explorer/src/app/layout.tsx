import type { Metadata } from 'next';
import '@carbon/styles/css/styles.css';
import './globals.css';
import Sidebar from '@/components/Sidebar';

export const metadata: Metadata = {
  title: 'Network Gap Infill',
  description: 'Real-time train movement gap detection and infill — Confluent ksqlDB on OpenShift',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="cds--white">
        <Sidebar />
        <main className="ngi-main">
          {children}
        </main>
      </body>
    </html>
  );
}
