/**
 * Intercepts requests serving "public/embed.html" and:
 * - Checks for `archive-url` and `original-url` in search parameters
 * - Replace placeholders in "embed.html"'s template with them.
 * 
 * Notes:
 * - `archive-url` must end by either ".warc.gz" or ".wacz"
 * 
 * @param {Request} request
 * @param {object} context - See https://docs.netlify.com/netlify-labs/experimental-features/edge-functions/api/#netlify-specific-context-object
 * @return {Response}
 */
export default async (request, context) => { 
  const requestUrl = new URL(request.url);
  const returnHeaders = {"access-control-allow-origin": "*"};   
  let archiveUrl = null;
  let originalUrl = null;

  // Only allow `GET` and `HEAD` requests
  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response(null, {status: 405, returnHeaders}); 
  }

  //
  // Grab and validate `archive-url` and `original-url` from url search params.
  // Return HTTP 400 if not available or not valid.
  //
  try {
    archiveUrl = requestUrl.searchParams.get("archive-url");
    originalUrl = requestUrl.searchParams.get("original-url");
    new URL(archiveUrl); // Will throw if not a valid url
    new URL(originalUrl);
  }
  catch(err) {
    console.log(err);
    return new Response(null, {status: 400, returnHeaders});
  }

  //
  // Intercept response to `/embed` (embed.html) and replace placeholders with `original-url` and `archive-url`.
  //
  const response = await context.next();
  let page = await response.text();

  page = page.replaceAll("{{original-url}}", originalUrl);
  page = page.replaceAll("{{archive-url}}", archiveUrl);
  page = page.replaceAll("{{format}}", archiveUrl.includes("wacz") ? "wacz" : "warc.gz");

  // Add extra headers to response
  for (const [key, value] of Object.entries(returnHeaders)) {
    response.headers.set(key, value);
  }

  return new Response(page, response);
};