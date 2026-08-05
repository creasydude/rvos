import "@/app/globals.css";
import Providers from "@/components/providers";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="h-screen overflow-hidden bg-bg">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
