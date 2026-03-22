// src/content/config.ts
import { defineCollection } from "astro:content";
import { z } from "astro/zod"; // 注意：z 从 astro/zod 导入
import { glob } from "astro/loaders"; // 导入 glob loader

const subjects = defineCollection({
  loader: glob({ pattern: "**/[^_]*.json", base: "./src/content/subjects/" }),
  schema: z.object({
    name: z.string(), // 科目名称
    description: z.string(), // 科目描述
    icon: z.string(), // emoji 或图标
    theme: z.object({
      // 主题色，用于定制风格
      primary: z.string(), // 主色调（如 #3b82f6）
      accent: z.string(), // 强调色（可选）
    }),
    slug: z.string(), // URL slug（可选，默认使用文件名）
  }),
});

const blog = defineCollection({
  loader: glob({ pattern: "**/[^_]*.md", base: "./src/content/blog/" }), // 文章在根目录 blog/ 下
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.date(),
    updatedDate: z.date().optional(),
    author: z.string().default("Fenze"),
    tags: z.array(z.string()),
    image: z.string().optional(),
    subject: z.string(), // 关联的题目
  }),
});

export const collections = { blog, subjects };
