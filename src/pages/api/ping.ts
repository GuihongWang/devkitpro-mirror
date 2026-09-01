import type { APIRoute } from "astro";

// Absolute minimal SSR route: no imports of our lib, no child_process, no fs.
// Purpose: decide if the _render function itself is healthy on Vercel.
export const prerender = false;

export const GET: APIRoute = async () => {
  return new Response("pong", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
