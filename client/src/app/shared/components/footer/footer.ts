import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ShopService } from '../../../core/services/shop.service';

@Component({
  selector: 'app-footer',
  imports: [RouterLink],
  templateUrl: './footer.html',
  styleUrl: './footer.scss',
})
export class Footer {
  protected readonly shop = inject(ShopService);
  protected readonly year = new Date().getFullYear();
  constructor() { this.shop.load(); }
}
