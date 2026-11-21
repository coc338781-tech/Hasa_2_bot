import test from "node:test";
import assert from "node:assert/strict";
import {
  commands,
  commandOf,
  findQuotedViewOnceMedia,
  handleViewOnceCommand
} from "../plugins/media-tools.js";
import {
  getCategoryCommandLines,
  appendCatalogToHelp,
  appendCatalogToList
} from "../lib/command-catalog.js";

function replyTo(quotedMessage, text = ".vv") {
  return {
    key: { remoteJid: "test@s.whatsapp.net" },
    message: {
      extendedTextMessage: {
        text,
        contextInfo: { quotedMessage }
      }
    }
  };
}

const baseList = [
  "│📜 MEDIA DOWNLOADS & STATUS SAVER*",
  "*│►* .dl <url>",
  "╰────────"
].join("\n");

const baseHelp = [
  "MEDIA DOWNLOADS 〕",
  "┃ .dl <url>",
  "┗━━━━━━━━"
].join("\n");

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

test(".vv appears in the numbered Media Downloads menu, .list and .help", () => {
  assert.deepEqual(getCategoryCommandLines(commands, "3", "."), [
    ".vv (reply to View Once photo/video) — Save View Once media as a normal photo or video"
  ]);
  assert.match(appendCatalogToList(baseList, commands), /\.vv \(reply to View Once photo\/video\)/);
  assert.match(appendCatalogToHelp(baseHelp, commands), /\.vv \(reply to View Once photo\/video\)/);
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

test("recovers full View Once media from cache when quoted copy has no URL or directPath", () => {
  const quotedMedia = { mimetype: "image/jpeg", mediaKey: Buffer.from("quoted") };
  const originalMedia = {
    mimetype: "image/jpeg",
    mediaKey: Buffer.from("original"),
    url: "https://mmg.whatsapp.net/test",
    directPath: "/v/t62.7118-24/test"
  };
  const message = replyTo({
    viewOnceMessageV2: { message: { imageMessage: quotedMedia } }
  });
  message.message.extendedTextMessage.contextInfo.stanzaId = "original-view-once-id";
  const cache = new Map([[
    "test@s.whatsapp.net:original-view-once-id",
    {
      key: { remoteJid: "test@s.whatsapp.net", id: "original-view-once-id" },
      message: { viewOnceMessageV2: { message: { imageMessage: originalMedia } } }
    }
  ]]);

  const found = findQuotedViewOnceMedia(message, cache);
  assert.equal(found.kind, "image");
  assert.equal(found.media, originalMedia);
  assert.ok(found.media.url || found.media.directPath);
});

test("recovers cached View Once media when quoted JID format differs", () => {
  const quotedMedia = { mimetype: "image/jpeg", mediaKey: Buffer.from("quoted") };
  const originalMedia = {
    mimetype: "image/jpeg",
    mediaKey: Buffer.from("original"),
    url: "https://mmg.whatsapp.net/test",
    directPath: "/v/t62.7118-24/test"
  };
  const message = replyTo({
    viewOnceMessageV2: { message: { imageMessage: quotedMedia } }
  });
  message.message.extendedTextMessage.contextInfo.stanzaId = "jid-format-mismatch-id";
  message.message.extendedTextMessage.contextInfo.remoteJid = "12345@lid";
  const cache = new Map([[
    "test@s.whatsapp.net:jid-format-mismatch-id",
    {
      key: { remoteJid: "test@s.whatsapp.net", id: "jid-format-mismatch-id" },
      message: { viewOnceMessageV2: { message: { imageMessage: originalMedia } } }
    }
  ]]);
  const found = findQuotedViewOnceMedia(message, cache);
  assert.equal(found.media, originalMedia);
  assert.ok(found.media.url || found.media.directPath);
});

test("does not return a reduced quoted media payload without download location", () => {
  const found = findQuotedViewOnceMedia(replyTo({
    viewOnceMessageV2: {
      message: { imageMessage: { mimetype: "image/jpeg", mediaKey: Buffer.from("quoted") } }
    }
  }));
  assert.equal(found, null);
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

for (const kind of ["image", "video"]) {
  test("sends downloaded View Once " + kind + " back as ordinary media", async () => {
    const media = { mimetype: kind === "image" ? "image/jpeg" : "video/mp4" };
    const found = { media, kind };
    const message = replyTo({});
    const sent = [];
    const sock = {
      async sendMessage(jid, payload, options) {
        sent.push({ jid, payload, options });
      }
    };
    const bytes = Buffer.from("test-media-bytes");
    await handleViewOnceCommand({
      sock,
      message,
      jid: "test@s.whatsapp.net",
      found,
      downloadMedia: async (_media, _kind, destination) => {
        const fs = await import("node:fs");
        fs.writeFileSync(destination, bytes);
      }
    });
    const output = sent.find(item => item.payload.image || item.payload.video);
    assert.ok(output, "ordinary media message should be sent");
    assert.deepEqual(output.payload[kind], bytes);
    assert.equal(output.payload.mimetype, media.mimetype);
    assert.equal(output.options.quoted, message);
  });
}
