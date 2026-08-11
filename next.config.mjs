/** @type {import('next').NextConfig} */
// Storage is node:sqlite (a Node builtin), so no native package needs to be
// externalized from the server bundle anymore.
//
// pdfjs-dist ships an optional Node canvas backend (require("canvas")) that the
// bundler can't resolve and would otherwise trace into every route that imports
// the market sync/parse pipeline. We only ever extract TEXT, never render to a
// canvas, so leave the whole package external to the server bundle — it loads
// from node_modules at runtime.
const nextConfig = {
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
