import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { categoryImage } from '../../core/utils/food-image';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  template: `
    <div class="nf grain">
      <div class="nf__inner">
        <figure class="nf__photo" aria-hidden="true">
          <img [src]="photo" alt="" loading="eager" width="230" height="170" />
          <figcaption>fresh out, sorry</figcaption>
        </figure>
        <h1 class="nf__code" aria-hidden="true">404</h1>
        <h2 class="nf__title">This shelf is empty.</h2>
        <p class="nf__lead">The page you're after has been eaten — but the ovens are very much on.</p>
        <div class="nf__actions">
          <a routerLink="/" class="btn btn--gold btn--lg">Back home</a>
          <a routerLink="/menu" class="btn btn--ghost-dark btn--lg">See the menu</a>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
    .nf {
      position: relative;
      min-height: calc(100svh - 76px);
      display: grid;
      place-items: center;
      padding: 56px 20px;
      overflow: hidden;
      background:
        radial-gradient(55% 70% at 50% 115%, rgba(223, 167, 87, 0.18), transparent 60%),
        radial-gradient(40% 40% at 12% 12%, rgba(217, 79, 120, 0.09), transparent 60%),
        var(--night);
      text-align: center;
    }
    .nf__inner { position: relative; z-index: 2; display: grid; justify-items: center; gap: 0.5rem; }
    .nf__photo {
      margin: 0 0 0.8rem;
      padding: 0.55rem 0.55rem 0.8rem;
      background: rgba(30, 18, 11, 0.6);
      border: 1px solid var(--d-line);
      border-radius: var(--radius);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      box-shadow: var(--shadow-lg);
      transform: rotate(-4deg);
      transition: transform 0.6s var(--ease-out);
    }
    .nf__photo:hover { transform: rotate(2deg) scale(1.04); }
    .nf__photo img { width: 230px; aspect-ratio: 23 / 17; object-fit: cover; border-radius: calc(var(--radius) - 6px); }
    .nf__photo figcaption {
      padding-top: 0.55rem;
      font-family: var(--font-display);
      font-style: italic;
      font-size: 0.9rem;
      color: var(--d-muted);
    }
    .nf__code {
      margin: 0;
      font-size: clamp(5.5rem, 18vw, 10rem);
      font-weight: 700;
      line-height: 0.9;
      letter-spacing: -0.03em;
      background: linear-gradient(165deg, var(--gold-bright), rgba(223, 167, 87, 0.16));
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
    }
    .nf__title { color: var(--d-text); font-size: clamp(1.6rem, 4vw, 2.4rem); margin: 0.4rem 0 0; }
    .nf__lead { color: var(--d-muted); max-width: 42ch; margin: 0.4rem 0 1.6rem; }
    .nf__actions { display: flex; gap: 0.9rem; flex-wrap: wrap; justify-content: center; }
    `,
  ],
})
export class NotFound {
  protected readonly photo = categoryImage('Pastries');
}
