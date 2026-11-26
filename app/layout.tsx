import type { Metadata, Viewport } from "next";
import { PwaRegister } from "@/components/pwa-register";
import "./globals.css";
import "./workspace.css";
import "./home.css";
import "./focus-reader.css";
import "./flashcard.css";
import "./management-pages.css";
import "./mobile.css";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.css";

export const metadata: Metadata = {
  title: "Interview Master — AI 技术面试知识库",
  description: "从知识专题到真正掌握。生成、阅读并复习你的技术知识。",
  appleWebApp: { capable: true, title: "Interview Master", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#1d6c56", viewportFit: "cover" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="zh-CN"><body>{children}<PwaRegister /></body></html>;
}
