import React from 'react';
import './globals.css';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <title>RAG Ops Console // v5.1</title>
        <meta name="description" content="Professional RAG observability and gated deployment console." />
      </head>
      <body className="h-full w-full overflow-hidden bg-[#020617]">
        {children}
      </body>
    </html>
  );
}
