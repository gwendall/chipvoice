import type { NextConfig } from "next";

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
