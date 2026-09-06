import type { NextConfig } from "next";

const config: NextConfig = {
  // Preserve the real origin in locale rewrites. NextURL normalizes loopback
  // hosts to localhost, which otherwise turns a 127.0.0.1 rewrite into an
  // external request and recursively hits the /en canonical redirect.
  skipProxyUrlNormalize: true,
  // The renderer is a tight numeric loop over a million samples. It needs the
  // Node runtime, not Edge - there is no way around that and no reason to try.
  serverExternalPackages: ["@libsql/client"],
  outputFileTracingIncludes: { '/api/audio/*/*': ['./generated/audio-render.cjs'] },

  /*
   * `/s/{id}.mp3` is the URL that gets shared, so it is the URL that exists.
   * Next will not let a route handler and a page share a dynamic segment, so
   * the handler lives under /api and this maps the public shape onto it.
   */
  async rewrites() {
    return [
      { source: "/s/:id([0-9A-Za-z]{8}).:format(mp3|wav)", destination: "/api/audio/:id/:format" },
    ];
  },
};

export default config;
