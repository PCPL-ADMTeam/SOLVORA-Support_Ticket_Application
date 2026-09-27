const crypto = require("crypto");
const path = require("path");
const { BlobServiceClient } = require("@azure/storage-blob");
const env = require("../config/env");

function isConfigured() {
  return Boolean(env.azure.storageConnectionString && env.azure.storageContainerName);
}

// Built lazily (and only once credentials are actually present) so the app
// can boot fine with Azure unconfigured — every caller must check
// isConfigured() or handle the thrown error, same convention as
// entra.service.js's getClient(). Never logs env.azure.storageConnectionString
// (it embeds the storage account key).
let containerClientPromise = null;

function getContainerClient() {
  if (!isConfigured()) {
    throw new Error("Azure Blob Storage is not configured (missing AZURE_STORAGE_CONNECTION_STRING/AZURE_STORAGE_CONTAINER_NAME)");
  }
  if (!containerClientPromise) {
    const blobServiceClient = BlobServiceClient.fromConnectionString(env.azure.storageConnectionString);
    const containerClient = blobServiceClient.getContainerClient(env.azure.storageContainerName);
    // createIfNotExists() with no `access` option creates (or leaves) the
    // container PRIVATE — no anonymous read access to the container or its
    // blobs. Never pass { access: "container" } or { access: "blob" } here.
    containerClientPromise = containerClient
      .createIfNotExists()
      .then(() => containerClient)
      .catch((err) => {
        containerClientPromise = null; // allow a retry on the next call
        throw err;
      });
  }
  return containerClientPromise;
}

// Original filenames are untrusted input — strip anything that isn't a
// safe filename character before it becomes part of a blob path.
function sanitizeFilename(originalName) {
  const ext = path.extname(originalName || "").slice(0, 20);
  const base = path.basename(originalName || "file", ext).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "file";
  return `${base}${ext}`;
}

// attachments/<blobFolder>/<unique-id>-<sanitized-original-filename> —
// never the raw original filename alone, so two uploads of "invoice.pdf"
// (by different users, or the same user twice) can never collide or
// overwrite each other. `blobFolder` is caller-provided — ticket.service.js
// passes the ticket's human-readable ticketNumber (e.g. "BI-001") for new
// uploads so the Blob folder is meaningful in the Azure portal, without
// this function having any opinion on what the folder represents or
// touching what TicketAttachment.ticketId stores in Postgres (still always
// the internal Ticket.id — see ticket.service.js#addAttachment). Existing
// blobs already stored under their old <ticketId> folder are unaffected:
// download/delete never reconstruct a path, they just reuse whatever
// filePath was recorded on the attachment row at upload time.
function buildBlobName(blobFolder, originalName) {
  const uniqueId = crypto.randomUUID();
  return `attachments/${blobFolder}/${uniqueId}-${sanitizeFilename(originalName)}`;
}

async function uploadBuffer({ blobFolder, buffer, originalName, mimeType }) {
  const containerClient = await getContainerClient();
  const blobName = buildBlobName(blobFolder, originalName);
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: mimeType || "application/octet-stream" },
  });
  return blobName;
}

// Idempotent — deleting a blob that's already gone is not an error, so
// cleanup calls (e.g. after a failed DB write) never need their own
// existence check first.
async function deleteBlob(blobName) {
  const containerClient = await getContainerClient();
  await containerClient.getBlockBlobClient(blobName).deleteIfExists();
}

// Returns the raw Azure download response ({ readableStreamBody,
// contentType, contentLength, ... }) — the caller (ticket.service.js)
// pipes readableStreamBody straight to the HTTP response after its own
// authorization check, so the blob's bytes never pass through anything
// that isn't already verifying the requester can see this ticket.
async function downloadBlobStream(blobName) {
  const containerClient = await getContainerClient();
  return containerClient.getBlockBlobClient(blobName).download();
}

// Returns the blob's full contents as an in-memory Buffer — used only where
// the whole file is needed at once (e.g. building a Microsoft Graph email
// file attachment payload, which takes a single base64 blob rather than a
// stream; see notification.service.js). Never used for the normal
// authenticated download path (streamAttachment), which still streams to
// avoid buffering large files in memory unnecessarily.
async function downloadBlobBuffer(blobName) {
  const containerClient = await getContainerClient();
  return containerClient.getBlockBlobClient(blobName).downloadToBuffer();
}

module.exports = { isConfigured, uploadBuffer, deleteBlob, downloadBlobStream, downloadBlobBuffer };
