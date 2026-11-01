const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function localAuthority(value) {
 const match = typeof value === 'string' && /^(localhost|127\.0\.0\.1|\[::1\])(?::([1-9][0-9]{0,4}))?$/i.exec(value);
 return Boolean(match && (!match[2] || Number(match[2]) <= 65535));
}
function localOrigin(value) {
 const match = typeof value === 'string' && value.length <= 256 && /^(https?):\/\/([^/]+)\/?$/i.exec(value);
 if (!match || !localAuthority(match[2])) throw new Error('Use an explicit loopback HTTP(S) origin');
 return new URL(value).origin;
}
function menuLink(slug, origin) {
 if (typeof slug !== 'string' || slug.length < 3 || slug.length > 60 || !SLUG.test(slug)) throw new Error('Invalid bakery slug');
 const path = `/b/${slug}`; return { path, url: `${localOrigin(origin)}${path}` };
}
module.exports = { localAuthority, localOrigin, menuLink };
