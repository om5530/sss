import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ContactService } from '../../core/services/contact.service';
import { ToastService } from '../../core/services/toast.service';
import { RevealOnScroll } from '../../shared/directives/reveal.directive';

@Component({
  selector: 'app-contact',
  imports: [FormsModule, RevealOnScroll],
  templateUrl: './contact.html',
  styleUrl: './contact.scss',
})
export class Contact {
  private contact = inject(ContactService);
  private toast = inject(ToastService);
  protected readonly sending = signal(false);
  protected form = { name: '', email: '', message: '' };

  submit() {
    if (!this.form.name.trim() || !this.form.email.trim() || !this.form.message.trim()) {
      this.toast.error('Please fill in all fields.');
      return;
    }
    this.sending.set(true);
    this.contact.send(this.form).subscribe({
      next: () => {
        this.sending.set(false);
        this.toast.success('Thanks! We’ll get back to you soon.');
        this.form = { name: '', email: '', message: '' };
      },
      error: (err: HttpErrorResponse) => {
        this.sending.set(false);
        this.toast.error(err.error?.message || 'Your message didn’t go through — please try again.');
      },
    });
  }
}
