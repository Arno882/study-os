import "./globals.css";

export const metadata = {
  title: "Study OS",
  description: "自律研讀系統",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "RF Study OS",
    statusBarStyle: "black-translucent",
  },
};

export const viewport = {
  themeColor: "#000000",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}