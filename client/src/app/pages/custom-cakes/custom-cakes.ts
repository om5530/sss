import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../core/services/auth.service';
import { CakeService } from '../../core/services/cake.service';
import { ToastService } from '../../core/services/toast.service';
import { RevealOnScroll } from '../../shared/directives/reveal.directive';

const OCCASIONS = ['Birthday', 'Anniversary', 'Wedding', 'Baby shower', 'Office party', 'Just because'];
const FLAVOURS = ['Chocolate truffle', 'Belgian chocolate', 'Vanilla berry', 'Red velvet', 'Pistachio rose', 'Salted caramel', 'Baker’s choice'];

@Component({
  selector: 'app-custom-cakes',
  imports: [FormsModule, RouterLink, RevealOnScroll],
  templateUrl: './custom-cakes.html',
  styleUrl: './custom-cakes.scss',
})
export class CustomCakes {
  private cakes = inject(CakeService);
  private toast = inject(ToastService);
  private auth = inject(AuthService);

  protected readonly occasions = OCCASIONS;
  protected readonly flavours = FLAVOURS;

  protected readonly sending = signal(false);
  protected readonly uploading = signal(false);
  protected readonly sent = signal(false);

  protected form = {
    name: '',
    phone: '',
    email: '',
    occasion: '',
    servings: null as number | null,
    flavour: '',
    messageOnCake: '',
    dateNeeded: '',
    details: '',
    referenceImage: '',
  };

  /** Tomorrow, for the date input's min — cakes need at least a day's notice. */
  protected readonly minDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  constructor() {
    const user = this.auth.user();
    if (user) {
      this.form.name = user.name ?? '';
      this.form.phone = user.phone ?? '';
      this.form.email = user.email ?? '';
    }
  }

  onReferenceChosen(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.uploading()) return;
    this.uploading.set(true);
    this.cakes.uploadReference(file).subscribe({
      next: (url) => {
        this.uploading.set(false);
        this.form.referenceImage = url;
        this.toast.success('Reference photo attached.');
      },
      error: (err: HttpErrorResponse) => {
        this.uploading.set(false);
        this.toast.error(err.error?.message || 'Upload failed — try a JPEG/PNG under 5 MB.');
      },
    });
  }

  submit() {
    const f = this.form;
    if (!f.name.trim() || !f.phone.trim() || !f.occasion || !f.servings || !f.flavour || !f.dateNeeded) {
      this.toast.error('Please fill the essentials — name, phone, occasion, servings, flavour and date.');
      return;
    }
    if (this.sending()) return;
    this.sending.set(true);

    this.cakes
      .submit({
        name: f.name.trim(),
        phone: f.phone.trim(),
        email: f.email.trim() || undefined,
        occasion: f.occasion,
        servings: Number(f.servings),
        flavour: f.flavour,
        messageOnCake: f.messageOnCake.trim() || undefined,
        dateNeeded: f.dateNeeded,
        details: f.details.trim() || undefined,
        referenceImage: f.referenceImage || undefined,
      })
      .subscribe({
        next: () => {
          this.sending.set(false);
          this.sent.set(true);
        },
        error: (err: HttpErrorResponse) => {
          this.sending.set(false);
          const detail = err.error?.details?.[0]?.message;
          this.toast.error(detail || err.error?.message || 'That didn’t go through — please try again.');
        },
      });
  }
}
