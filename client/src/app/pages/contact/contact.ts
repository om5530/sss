import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ContactService } from '../../core/services/contact.service';
import { ToastService } from '../../core/services/toast.service';
import { RevealOnScroll } from '../../shared/directives/reveal.directive';
import { ShopService } from '../../core/services/shop.service';

@Component({
  selector: 'app-contact',
  imports: [FormsModule, RevealOnScroll],
  templateUrl: './contact.html',
  styleUrl: './contact.scss',
})
export class Contact {
  private contact = inject(ContactService);
  private toast = inject(ToastService);
  protected shop = inject(ShopService);
  protected readonly sending = signal(false);
  protected form = { name: '', email: '', message: '' };
  protected readonly fieldErrors = signal<Record<string, string>>({});
  protected readonly submitted = signal(false);
  constructor() { this.shop.load(); }

  validate() {
    const errors: Record<string, string> = {};
    const { name, email, message } = this.form;
    if (!name.trim()) errors['name'] = 'Please enter your name.';
    else if (name.trim().length > 100) errors['name'] = 'Name must be 100 characters or fewer.';
    if (!email.trim()) errors['email'] = 'Please enter your email address.';
    else if (email.trim().length > 254) errors['email'] = 'Email must be 254 characters or fewer.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors['email'] = 'Please enter a valid email address, such as name@example.com.';
    if (!message.trim()) errors['message'] = 'Please write a message.';
    else if (message.trim().length > 2000) errors['message'] = 'Message must be 2,000 characters or fewer.';
    this.fieldErrors.set(errors);
    return Object.keys(errors).length === 0;
  }

  updateValidation() {
    if (this.submitted()) this.validate();
  }

  submit() {
    if (this.sending()) return;
    this.submitted.set(true);
    if (!this.validate()) {
      this.toast.error('Please correct the highlighted fields.');
      return;
    }
    this.sending.set(true);
    this.contact.send(this.form).subscribe({
      next: () => {
        this.sending.set(false);
        this.toast.success('Thanks! We’ll get back to you soon.');
        this.form = { name: '', email: '', message: '' };
        this.submitted.set(false);
        this.fieldErrors.set({});
      },
      error: (err: HttpErrorResponse) => {
        this.sending.set(false);
        const details = err.error?.details;
        if (Array.isArray(details)) {
          const errors: Record<string, string> = {};
          for (const detail of details) {
            if (['name', 'email', 'message'].includes(detail.field) && typeof detail.message === 'string') {
              errors[detail.field] ??= detail.message;
            }
          }
          this.fieldErrors.set(errors);
        }
        this.toast.error(err.error?.message || 'Your message didn’t go through — please try again.');
      },
    });
  }
}
