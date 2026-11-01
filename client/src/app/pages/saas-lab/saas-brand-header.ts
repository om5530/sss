import { Component, Input } from '@angular/core';
import { brandTheme, brandMark } from '../../core/utils/saas-branding';
@Component({ selector: 'app-saas-brand-header', template: `<header class="brand-header" [attr.data-theme]="themeOf(theme)">@if (logoUrl) { <img class="brand-logo" [src]="logoUrl" [alt]="bakeryName + ' logo'"> } @else { <span class="brand-mark" aria-hidden="true">{{ markOf(mark, bakeryName) }}</span> }<div>@if (primary) { <h1>{{ bakeryName }}</h1> } @else { <h3>{{ bakeryName }}</h3> }@if (tagline) { <p class="tagline">{{ tagline }}</p> }@if (description) { <p>{{ description }}</p> }</div></header>`, styleUrl: './saas-brand-header.scss' })
export class SaasBrandHeader {
 @Input() logoUrl: string | null = null; @Input() primary = false; @Input() bakeryName = ''; @Input() theme: unknown = 'gold'; @Input() mark: unknown = ''; @Input() tagline = ''; @Input() description = '';
 protected readonly themeOf = brandTheme; protected readonly markOf = brandMark;
}
