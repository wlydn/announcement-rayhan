export const metadata = {
  title: 'IT Rayhan Hospital',
  description: 'Pemutar announcement dengan jadwal, backsound standby, dan jeda otomatis saat waktu sholat.',
};

import './globals.css';

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
