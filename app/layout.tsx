import type { Metadata } from "next";
import "./globals.css";


export const metadata: Metadata = {
  title: "职途 · 从经历出发的职业试选",
  description:
    "从一段真实经历出发，核对能力、比较职业选择，再用一项有交付物的行动检验方向。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
    >
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
