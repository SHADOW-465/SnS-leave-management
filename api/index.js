/** Placeholder so Vercel CLI sees a Serverless Function before `vercel-bundle.mjs` overwrites this file. */
module.exports = async function handler(_req, res) {
  res.statusCode = 503;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end('Leave OS API bundle has not been built.');
};
