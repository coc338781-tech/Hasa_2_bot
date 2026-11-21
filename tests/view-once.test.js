import test from "node:test";
import assert from "node:assert/strict";
import { commands, commandOf, findQuotedViewOnceMedia } from "../plugins/media-tools.js";

function replyTo(quotedMessage) {
  return {
    message: {
      extendedTextMessage: {
        text: ".vv",
        contextInfo: { quotedMessage }
      }
    }
  };
}

test(".vv is registered in the media downloads category, not settings", () => {
  assert.deepEqual(commands, [{
    name: "vv",
    category: "3",
    usage: "vv (reply to View Once photo/video)",
    description: "Save View Once media as a normal photo or video"
  }]);
});

test(".vv and .Vv resolve to the same command", () => {
  assert.equal(commandOf(".vv", "."), "vv");
  assert.equal(commandOf(".Vv", "."), "vv");
});

test("extracts a View Once photo from a V2 wrapper", () => {
  const media = { mimetype: "image/jpeg", mediaKey: Buffer.from("test") };
  const found = findQuotedViewOnceMedia(replyTo({
    viewOnceMessageV2: { message: { imageMessage: media } }
  }));
  assert.equal(found.kind, "image");
  assert.equal(found.media, media);
});

test("extracts a View Once video from a V1 wrapper", () => {
  const media = { mimetype: "video/mp4", mediaKey: Buffer.from("test") };
  const found = findQuotedViewOnceMedia(replyTo({
    viewOnceMessage: { message: { videoMessage: media } }
  }));
  assert.equal(found.kind, "video");
  assert.equal(found.media, media);
});

test("does not treat an ordinary photo as View Once", () => {
  const found = findQuotedViewOnceMedia(replyTo({
    imageMessage: { mimetype: "image/jpeg" }
  }));
  assert.equal(found, null);
});

test("supports an ephemeral wrapper around View Once media", () => {
  const media = { mimetype: "image/jpeg", mediaKey: Buffer.from("test") };
  const found = findQuotedViewOnceMedia(replyTo({
    ephemeralMessage: {
      message: { viewOnceMessageV2: { message: { imageMessage: media } } }
    }
  }));
  assert.equal(found.kind, "image");
  assert.equal(found.media, media);
});
