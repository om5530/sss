import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RevealOnScroll } from '../../shared/directives/reveal.directive';
import { Parallax } from '../../shared/directives/parallax.directive';
import { Counter } from '../../shared/directives/counter.directive';
import { Magnetic } from '../../shared/directives/magnetic.directive';
import { categoryImage } from '../../core/utils/food-image';

interface StoryPhoto {
  src: string;
  alt: string;
  caption: string;
}

interface Value {
  icon: 'wheat' | 'flame' | 'heart';
  title: string;
  copy: string;
}

@Component({
  selector: 'app-about',
  imports: [RouterLink, RevealOnScroll, Parallax, Counter, Magnetic],
  templateUrl: './about.html',
  styleUrl: './about.scss',
})
export class About {
  /** Overlapping editorial photo stack — curated category photography. */
  protected readonly storyPhotos: StoryPhoto[] = [
    { src: categoryImage('Pastries'), alt: 'Butter croissants fresh out of the oven', caption: 'Laminated by hand' },
    { src: categoryImage('Brownies'), alt: 'Fudge brownies with crackle tops', caption: 'Pulled while molten' },
    { src: categoryImage('Cakes'), alt: 'A layered chocolate cake, iced by hand', caption: 'Iced to order' },
  ];

  /** Values — real client copy (previously staged under REAL CLIENT DATA). */
  protected readonly values: Value[] = [
    { icon: 'wheat', title: 'Honest ingredients', copy: 'Real butter, real chocolate, no shortcuts. We bake the way you would at home.' },
    { icon: 'flame', title: 'Fresh every day', copy: 'Nothing sits overnight. Every batch is made the morning you order it.' },
    { icon: 'heart', title: 'Made for sharing', copy: 'From a solo cookie run to a full party platter — we’ve got the moment covered.' },
  ];
}
