import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// Wiki collection — markdown files scraped into src/content/wiki/.
const wiki = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/wiki" }),
  schema: z.object({
    title: z.string(),
    original_url: z.string().optional(),
    scraped_at: z.string().optional(),
  }),
});

export const collections = { wiki };