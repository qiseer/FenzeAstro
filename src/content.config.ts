// src/content/config.ts
import { defineCollection } from "astro:content";
import { z } from "astro/zod"; // 注意：z 从 astro/zod 导入
import { glob } from "astro/loaders"; // 导入 glob loader

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
  }),
});

export const collections = { blog };
