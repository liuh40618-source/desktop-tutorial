import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "职途 · 大学生岗位匹配与技能规划",
  description:
    "不靠 LLM 的岗位匹配工具：输入专业与技能，按岗位必备技能的覆盖率算出匹配分、技能差距与学习路径，每个数字都能拆开看依据。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
