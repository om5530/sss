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
  protected readonly editingAddressId = signal<string | null>(null);
  protected readonly savingAddress = signal(false);
  protected readonly addressError = signal('');

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
    if (this.auth.user()?.identityReadOnly || this.savingProfile()) return;
    if (!this.profileForm.name.trim() || (this.profileForm.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.profileForm.email.trim()))) {
      this.toast.error('Enter your name and a valid email address.');
      return;
    }
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

  startAddress(address?: Address) {
    this.editingAddressId.set(address?._id ?? null);
    this.newAddress = address ? { ...address } : { fullAddress: '', area: '', city: '', pincode: '', landmark: '', isDefault: false };
    this.addressError.set('');
    this.addingAddress.set(true);
  }

  saveAddress() {
    if (this.savingAddress()) return;
    if (!this.newAddress.fullAddress.trim() || !this.newAddress.area?.trim() || !this.newAddress.city?.trim()) {
      this.addressError.set('Full address, area and city are required.');
      return;
    }
    if (!/^[1-9][0-9]{5}$/.test(this.newAddress.pincode?.trim() ?? '')) {
      this.addressError.set('Enter a valid 6-digit pincode.');
      return;
    }
    this.addressError.set('');
    this.savingAddress.set(true);
    const id = this.editingAddressId();
    const request = id ? this.auth.updateAddress(id, this.newAddress) : this.auth.addAddress(this.newAddress);
    request.subscribe({
      next: () => {
        this.savingAddress.set(false);
        this.toast.success(id ? 'Address updated.' : 'Address added.');
        this.addingAddress.set(false);
        this.newAddress = { fullAddress: '', area: '', city: '', pincode: '', landmark: '', isDefault: false };
      },
      error: (err: HttpErrorResponse) => {
        this.savingAddress.set(false);
        this.addressError.set(err.error?.details?.[0]?.message || err.error?.message || 'Could not save address.');
      },
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
    if (!await this.auth.logout()) return;
    this.toast.info('Signed out.');
    this.router.navigateByUrl('/');
  }
}
