import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Facture Impec",
  description:
    "Assistant de pré-vol pour la facturation électronique française (EN 16931) — démo de validation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
