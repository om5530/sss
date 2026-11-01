# Isolated local logo and product images

This module stores bounded image slots only in the guarded disposable loopback `saas_*` MongoDB database. It does not use legacy uploads, local upload directories, Cloudinary, existing catalogue images, external image URLs or production credentials. No production image/data was accessed or changed.

## Owner workflow

Open Menu settings → Bakery logo, or Products → Product photo beside a saved product. Choose a file, review its local preview, then confirm replacement. Removing an image also requires review. Slots load only when their editor is opened; the product list does not prefetch every full-size private image.

The file input accepts JPEG, PNG and WebP up to 512 KiB. The server validates encoding/signature, decodes the bytes, rejects malformed/truncated and animated images, bounds input to eight million pixels, applies orientation, resizes without enlargement and re-encodes to WebP. Logos fit within 512×512; product photos within 800×800. Saved outputs are at most 128 KiB. EXIF/ICC and other source metadata are not retained. Original filenames and input files are never stored. The browser's unsaved preview is local to the editor; only confirmed requests send pixels to the local API.

The normalizer uses pinned `sharp` 0.35.5 (Node ≥20.9.0 and a supported native platform). See the primary API documentation for [input safety limits](https://sharp.pixelplumbing.com/api-constructor/), [metadata inspection](https://sharp.pixelplumbing.com/api-input/) and [default output metadata removal](https://sharp.pixelplumbing.com/api-output/). Production deployment/install validation remains a later release step.

A published local menu displays its saved logo in place of the text initials and shows photos for visible products. Without a logo, the existing text mark/initials remain the fallback. Theme/mark editing and photo saving are independent reviewed changes.

## Tenant and storage boundaries

`saas_media` has a unique bakery/kind/target slot: one logo for the bakery itself and one image for each product. Every private lookup and mutation checks the active bakery and owner membership. Product targets must belong to that bakery. Staff cannot read private slots or change images. No caller-supplied bakery ID, asset URL, filename, MIME type, CSS or HTML is accepted in the mutation body.

Image changes run through the existing bakery/account/membership transaction checks. A save rechecks its target and expected image version; unrelated product/stock versions are not changed. Slots have their own increasing version. Removal deletes stored pixels but preserves a tombstone/version, so a stale version-0 replacement cannot resurrect a removed slot. Reload clears the selected file and review state. Late reads/saves cannot replace a different editor scope; file/password/account data is not added to browser storage.

The per-bakery local ceiling is 128 active slots and 16 MiB of normalized pixels. Archived products' saved images still count until explicitly removed. Quotas are checked under the bakery lock; simultaneous final-slot uploads cannot exceed capacity. Replacement subtracts the current image's size before checking the new size. Audit failure rolls back pixels, slot version and quota effects together. Audit records contain metadata only, never source bytes or filenames.

Source input is bounded before decoding, per-process decoding concurrency is two, and owner image mutation requests share ten per minute per account across bakeries. JSON stays within the app's existing 1 MiB parser limit. These are local controls, not distributed production abuse protection.

## API and publication

| Method and path | Purpose |
|---|---|
| GET `/api/saas/bakeries/:bakeryId/media/:kind/:targetId` | Owner-only slot/version and bounded WebP data preview |
| POST same path | `imageBase64`, `expectedVersion`, `confirmed:true`; use `imageBase64:null` to remove |
| GET `/api/saas/storefront/:slug/media/:mediaId/:version-:hash.webp` | Published, visible image bytes only |

`kind` is `logo` or `product`; a logo target must equal the verified bakery ID. Private requests retain cookie/expected-account/intent controls. Exact input fields and explicit versions are mandatory. Image bytes are excluded from default model selection. There is no media-listing, arbitrary download, remote fetch or legacy file-serving bridge.

The public menu includes only image path/width/height descriptors, with one bakery-scoped metadata query per page. No upload bytes, internal target IDs, owner identity, private image slots or storage usage are included. The client only constructs image URLs matching the resolved bakery's API path; external URLs and other tenant paths are rejected.

Every public byte request independently resolves an active bakery, published profile, active slot, exact image version/hash and current product visibility. Archiving a product, hiding an unavailable product, suspending the bakery, unpublishing, removal or replacement revoke subsequent access as applicable. Unavailable product images follow `showUnavailable`. Versioned URLs remain invalid after removal and re-upload of identical bytes. Already downloaded images cannot be withdrawn from recipients.

Responses use `image/webp`, `nosniff`, restrictive image CSP and `Cache-Control:no-store`; the application does not rely on permanent public file URLs or immutable caching. Development cross-port image requests use same-site resource policy. Images do not bypass publication or tenant state checks.

## Remaining release work

This is functional local storage, not the final production media service. Durable isolated object storage, upload/processing workers, shared rate limits, public host/CDN/cookie policy, privacy/retention/export/deletion rules, backup/restore and image migration must be reviewed before rollout. Existing production records/assets remain untouched. Browser/iPad visual and upload interaction QA remain pending; decoder/API/state tests and Angular compilation are separate evidence.
