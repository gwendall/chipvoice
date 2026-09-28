import type { NextConfig } from "next";
import audioStore from "./audio-store.json";

const config: NextConfig = {
  skipProxyUrlNormalize: true,

  /*
   * A literal `.zip` suffix on a dynamic id cannot be a Next.js route
   * segment directly (mirrors apps/web's `/s/:id.:format` rewrite for the
   * same reason): the handler lives under /api and this maps the public,
   * shareable shape onto it.
   */
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [
        {
          source: "/api/v1/sounds/:id([a-z0-9-]+).zip",
          destination: "/api/v1/sounds/:id/zip",
        },
        {
          source: "/api/v1/packs/:id([a-z0-9-]+).zip",
          destination: "/api/v1/packs/:id/zip",
        },
        /*
         * Shipped audio lives in a Vercel Blob store, not in git (decision
         * 40's pattern, apps/sounds/scripts/audio-store.mjs). Every file
         * already names its own content (/f/<sha256>.<ext>), so this maps
         * one to one and never goes stale. `afterFiles` runs after public
         * files, so a local copy from `pnpm sounds:pull` (or a dev/test
         * build's own generated/public/f) is served first - the store is
         * only ever a fallback for a byte this checkout does not have on
         * disk.
         */
        {
          source: "/f/:file([0-9a-f]{64}).:ext(ogg|mp3|wav)",
          destination: `${audioStore.base}/f/:file.:ext`,
        },
      ],
      fallback: [],
    };
  },

  async headers() {
    return [
      {
        // /f/<sha256>.<ext> (decision 40's content-addressed pattern): the
        // sha256 in the path IS the content, so a byte can never change
        // under a given URL. A year-long immutable cache is safe by
        // construction, not by convention.
        source: "/f/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default config;
