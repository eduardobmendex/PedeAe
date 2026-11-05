import type { Metadata } from "next";
import { Geist, Geist_Mono, Lora, Nunito } from "next/font/google";
import { themeInitScript } from "@/components/theme-scope";
import { identitiesCss } from "@/lib/themes";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Fontes alternativas do cardápio (opções aprovadas); sem preload para não pesar o painel.
const lora = Lora({ variable: "--font-lora", subsets: ["latin"], preload: false });
const nunito = Nunito({ variable: "--font-nunito", subsets: ["latin"], preload: false });

export const metadata: Metadata = {
  title: { default: "PedeAe", template: "%s · PedeAe" },
  description: "Cardápio digital e pedidos por QR Code para estabelecimentos de alimentação.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${lora.variable} ${nunito.variable} h-full antialiased`}
    >
      <head>
        <style dangerouslySetInnerHTML={{ __html: identitiesCss }} />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      {/* Extensões do navegador costumam adicionar atributos ao body antes da hidratação. */}
      <body suppressHydrationWarning className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
