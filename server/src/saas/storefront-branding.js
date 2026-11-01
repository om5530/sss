const THEMES = Object.freeze(['gold', 'rose', 'sage']);
const defaults = Object.freeze({ brandTheme: 'gold', brandMark: '' });
function brandingOf(value) {
 return { brandTheme: THEMES.includes(value?.brandTheme) ? value.brandTheme : defaults.brandTheme,
  brandMark: typeof value?.brandMark === 'string' && /^[A-Z0-9]{1,4}$/.test(value.brandMark) ? value.brandMark : '' };
}
module.exports = { THEMES, defaults, brandingOf };
