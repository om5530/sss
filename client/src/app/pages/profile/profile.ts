import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import { Address } from '../../core/models/user.model';
import { RevealOnScroll } from '../../shared/directives/reveal.directive';

@Component({
  selector: 'app-profile',
  imports: [FormsModule, RevealOnScroll],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class Profile {
  protected auth = inject(AuthService);
  private toast = inject(ToastService);
  private router = inject(Router);

  protected readonly editing = signal(false);
  protected readonly savingProfile = signal(false);
  protected readonly addingAddress = signal(false);

  protected profileForm = { name: '', email: '' };
  protected newAddress: Address = { fullAddress: '', area: '', city: '', pincode: '', landmark: '', isDefault: false };

  /** Presentation only — picks the work/home glyph on address cards. */
  protected isWorkAddress(addr: Address): boolean {
    const label = (addr.label ?? '').toLowerCase();
    return label.includes('work') || label.includes('office');
  }

  startEdit() {
    const user = this.auth.user();
    this.profileForm = { name: user?.name ?? '', email: user?.email ?? '' };
    this.editing.set(true);
  }

  saveProfile() {
    this.savingProfile.set(true);
    this.auth.updateProfile(this.profileForm).subscribe({
      next: () => {
        this.savingProfile.set(false);
        this.editing.set(false);
        this.toast.success('Profile updated.');
      },
      error: (err: HttpErrorResponse) => {
        this.savingProfile.set(false);
        this.toast.error(err.error?.message || 'Could not update profile.');
      },
    });
  }

  saveAddress() {
    if (!this.newAddress.fullAddress.trim()) {
      this.toast.error('Full address is required.');
      return;
    }
    this.auth.addAddress(this.newAddress).subscribe({
      next: () => {
        this.toast.success('Address added.');
        this.addingAddress.set(false);
        this.newAddress = { fullAddress: '', area: '', city: '', pincode: '', landmark: '', isDefault: false };
      },
      error: (err: HttpErrorResponse) => this.toast.error(err.error?.message || 'Could not add address.'),
    });
  }

  deleteAddress(id?: string) {
    if (!id) return;
    this.auth.deleteAddress(id).subscribe({
      next: () => this.toast.info('Address removed.'),
      error: () => this.toast.error('Could not remove address.'),
    });
  }

  async logout() {
    await this.auth.logout();
    this.toast.info('Signed out.');
    this.router.navigateByUrl('/');
  }
}
