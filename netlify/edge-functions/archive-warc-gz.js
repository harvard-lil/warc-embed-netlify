import allowlist from "../allowlist.js";

/**
 * Intercepts requests trying to serve "public/archive.warc.gz" and:
 * - Checks and validates `archive-url` in search parameters.
 * - Pull and serve file with needed headers (CORS, Content-Type Content-Disposition).
 * 
 * Notes:
 * - `archive-url` must end with ".warc.gz"
 * 
 * @param {Request} request
 * @return {Response}
 */
export default async (request) => {    
  const returnHeaders = {"access-control-allow-origin": "*"};
  const requestUrl = new URL(request.url);
  let archiveUrl = null;

  // Only allow `GET` and `HEAD` requests
  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response(null, {status: 405, returnHeaders}); 
  }

  //
  // Grab and validate `archive-url` from URL search params.
  // Return HTTP 400 if not available or not valid.
  //
  try {
    archiveUrl = requestUrl.searchParams.get("archive-url");

    const parsedArchiveUrl = new URL(archiveUrl); // Will throw if not a valid url

    if (parsedArchiveUrl.pathname.endsWith(".warc.gz") !== true) {
      throw new Error(`"archive-url" must point to a "warc.gz" file.`);
    }

    if (!["http:", "https:"].includes(parsedArchiveUrl.protocol)) {
      throw new Error(`"archive-url" must start with http(s)://.`);
    }

    if (!allowlist.includes(parsedArchiveUrl.host)) {
      throw new Error(`"archive-url" points to a domain that is not in the allow list.`);
    }
  }
  catch(err) {
    console.log(err);
    return new Response(null, {status: 400, returnHeaders});
  }

  //
  // Pull and serve file with appropriate headers.
  //
  try {
    const response = await fetch(`${archiveUrl}`);
    const data = await response.arrayBuffer();

    returnHeaders["content-type"] = "application/x-gzip";
    returnHeaders["content-disposition"] = `attachment; filename="archive.warc.gz"`;

    if (response.headers.get("etag")) {
      returnHeaders["etag"] = response.headers.get("etag");
    }

    return new Response(data, {status: 200, returnHeaders});
  }
  catch(err) {
    console.log(err);
    return new Response(null, {status: 404, returnHeaders});
  }
};