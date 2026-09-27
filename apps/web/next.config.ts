import type { NextConfig } from "next";
import audioStore from "./audio-store.json";

const config: NextConfig = {
  // Preserve the real origin in locale rewrites. NextURL normalizes loopback
  // hosts to localhost, which otherwise turns a 127.0.0.1 rewrite into an
  // external request and recursively hits the /en canonical redirect.
  skipProxyUrlNormalize: true,
  // The renderer is a tight numeric loop over a million samples. It needs the
  // Node runtime, not Edge - there is no way around that and no reason to try.
  serverExternalPackages: ["@libsql/client"],
  outputFileTracingIncludes: {
    "/api/v1/**": ["./generated/project-render.cjs"],
    "/api/audio/*/*": ["./generated/audio-render.cjs"],
  },

  /*
   * `/s/{id}.mp3` is the URL that gets shared, so it is the URL that exists.
   * Next will not let a route handler and a page share a dynamic segment, so
   * the handler lives under /api and this maps the public shape onto it.
   */
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [
        {
          source: "/s/:id([0-9A-Za-z]{8}).:format(mp3|wav)",
          destination: "/api/audio/:id/:format",
        },
        /*
         * The published recordings live in object storage (decision 40) under
         * their site paths, and each path names its content, so these map
         * one to one and never go stale. They come after public files, so a
         * local copy from `pnpm audio:pull` is served first.
         */
        {
          source: "/lab-data/:version([0-9a-f]{12})/:file([0-9a-f]{64}).flac",
          destination: `${audioStore.base}/lab-data/:version/:file.flac`,
        },
        {
          source: "/arrangement-data/:file([a-z0-9-]+-[0-9a-f]{12}).flac",
          destination: `${audioStore.base}/arrangement-data/:file.flac`,
        },
        {
          source: "/instrument-data/:file([a-z0-9-]+-[0-9a-f]{12}).flac",
          destination: `${audioStore.base}/instrument-data/:file.flac`,
        },
      ],
      fallback: [],
    };
  },

  /*
   * Nothing on the site is meant to be embedded by another origin - no
   * twitter:player card, no oEmbed document, no /embed route - so every
   * response, including the agent approval page at /connect, refuses framing
   * outright rather than opting each page in one at a time.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'",
          },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default config;
