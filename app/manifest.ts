import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Interview Master",
    short_name: "IM",
    description: "随时学一点技术知识。",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f9f6",
    theme_color: "#1d6c56",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcuts: [
      { name: "随机卡片", short_name: "卡片", url: "/?mode=cards", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "继续阅读", short_name: "继续阅读", url: "/?mode=continue", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
