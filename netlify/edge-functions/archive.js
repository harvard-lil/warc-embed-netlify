import allowlist from "../allowlist.js";

/**
 * Intercepts requests trying to serve "public/archive.[warc.gz|wac.gz]" and:
 * - Checks and validates `archive-url` in search parameters.
 * - Check if server behind `archive-url` supports range requests, which are needed here.
 * - If server supports range requests: proxy requests to it using them.
 * - Otherwise: split file and serve chunks as requested (MVP support for range requests).
 * 
 * Notes:
 * - `archive-url` must end with ".wacz" or ".warc.gz"
 * 
 * @param {Request} request
 * @return {Response}
 */
export default async (request) => { 
  const requestUrl = new URL(request.url);

  const returnHeaders = {
    "access-control-allow-origin": "*",
    "accept-ranges": "bytes"
  };

  let archiveUrl = null;
  let archiveUrlSupportsRange = false;
  let archiveByteLength = null;
  let fileExtension = null; // Will be ".warc" or ".warc.gz"

  // Only allow `GET` and `HEAD` requests
  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response(null, {status: 405, returnHeaders}); 
  }

  //
  // Grab and validate "archive-url" from URL search params.
  // Return HTTP 400 if not available or not valid.
  //
  try {
    archiveUrl = requestUrl.searchParams.get("archive-url");
    const parsedArchiveUrl = new URL(archiveUrl); // Will throw if not a valid url

    // Determine file extension
    if (parsedArchiveUrl.pathname.endsWith(".wacz")) {
      fileExtension = ".wacz";
    }

    if (parsedArchiveUrl.pathname.endsWith(".warc.gz")) {
      fileExtension = ".warc.gz";
    }

    if (!fileExtension) {
      throw new Error(`"archive-url" must end with ".wacz" or ".warc.gz.".`)
    }

    // Ensure protocol is either http or https
    if (!["http:", "https:"].includes(parsedArchiveUrl.protocol)) {
      throw new Error(`"archive-url" must start with http(s)://.`);
    }

    // Ensure remote host is in allow list
    if (!allowlist.includes(parsedArchiveUrl.host)) {
      throw new Error(`"archive-url" points to a domain that is not in the allow list.`);
    }

  }
  catch(err) {
    console.log(err);
    return new Response(null, {status: 400, returnHeaders});
  }

  //
  // Extension-specific headers
  //
  if (fileExtension === ".wacz") {
    returnHeaders["content-type"] = "binary/octet-stream";
    returnHeaders["content-disposition"] = `attachment; filename="archive.wacz"`;
  }
  else {
    returnHeaders["content-type"] = "application/x-gzip";
    returnHeaders["content-disposition"] = `attachment; filename="archive.warc.gz"`;
  }

  //
  // Send HEAD request to archive to determine:
  // - If it supports range requests
  // - If its content-length can be assessed
  //
  try {
    const response = await fetch(archiveUrl, {method: "HEAD"});

    // Range requests require both `Accept-Ranges` and `Content-Length`
    if (response.headers.get("accept-ranges") && response.headers.get("content-length")) {
      archiveUrlSupportsRange = true;
    }

    if (response.headers.get("content-length")) {
      archiveByteLength = response.headers.get("content-length");
    }

  }
  catch(err) {
    console.log(err);
    return new Response(null, {status: 404, returnHeaders});   
  }

  //
  // If range requests are supported by target: 
  // Fetch and return with range taken into account.
  //
  if (archiveUrlSupportsRange) {
    // TODO: Verify assumption that Netlify caches this efficiently.
    const response = await fetch(`${archiveUrl}`, {
      method: request.method,
      headers: request.headers,
    });

    const data = request.method === "HEAD" ? null : await response.arrayBuffer();

    returnHeaders["content-length"] = response.headers.get("content-length");

    if (response.headers.get("etag")) {
      returnHeaders["etag"] = response.headers.get("etag");
    }
  
    if (response.headers.get("content-range")) {
      returnHeaders["content-range"] = response.headers.get("content-range");
    }

    return new Response(data, {status: response.status, headers: returnHeaders});
  }
  //
  // If range request are not supported by target: Polyfill it.
  //
  else {
    // Force "GET" if we weren't able to pull a content-length from our initial "HEAD" request.
    const method = archiveByteLength ? request.method : "GET";
    const response = await fetch(`${archiveUrl}`, {method}); // TODO: Verify assumption that Netlify caches this efficiently.
    let data = request.method === "HEAD" ? null : await response.arrayBuffer();

    if (archiveByteLength === null && data) {
      archiveByteLength = data.byteLength;
    }

    const range = parseRangeHeader(request.headers.get("range"), archiveByteLength);

    if (data) {
      data = data.slice(range[0], range[1] + 1);
    }

    returnHeaders["content-range"] = `bytes ${range[0]}-${range[1]}/${archiveByteLength}`;
    returnHeaders["content-length"] = `${data ? data.byteLength : 0}`;

    if (response.headers.get("etag")) {
      returnHeaders["etag"] = response.headers.get("etag");
    }
    
    return new Response(data, {status: 206, headers: returnHeaders});
  }

};

/**
 * Simplistic "range" header parser. Will only handle basic ranges (i.e: "bytes=1274389-1355814").
 * @param {?string} range - Range header, as received with the request.
 * @param {number} fullContentLength - Content Length (in bytes) of the requested file. Used for capping out of bound requests.
 * @returns {Array} Range request boundaries. (example: [1274389, 1355814])
 */
function parseRangeHeader(range, fullContentLength) {
  let coord = null;

  // Defaults to [0, Content-Length -1] if unparseable.
  try {
    const parsedRange = range.replace("bytes=", "");
    coord = parsedRange.split("-");
  }
  catch(_err) {
    coord = [0, fullContentLength - 1];
  }

  coord[0] = parseInt(coord[0]);
  coord[1] = parseInt(coord[1]);

  if (isNaN(coord[1]) || coord[1] >= fullContentLength) {
    coord[1] = fullContentLength - 1;
  }

  return coord;
}