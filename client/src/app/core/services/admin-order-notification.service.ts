import { Injectable, inject, signal, computed, DestroyRef } from '@angular/core';
import { AdminService } from './admin.service';
import { ToastService } from './toast.service';
import { AdminOrder } from '../models/admin.model';

const POLL_INTERVAL_MS = 8_000;
const MUTE_STORAGE_KEY = 'gb_admin_order_chime_muted';
const REPEAT_CHIME_COUNT = 3;
const REPEAT_CHIME_DELAY_MS = 5_000;

@Injectable({ providedIn: 'root' })
export class AdminOrderNotificationService {
  private admin = inject(AdminService);
  private toast = inject(ToastService);

  /** Active alarm order that is currently ringing/demanding kitchen attention */
  readonly activeAlarmOrder = signal<AdminOrder | null>(null);

  /** Whether the kitchen order bell is muted */
  readonly isMuted = signal<boolean>(
    typeof localStorage !== 'undefined' && localStorage.getItem(MUTE_STORAGE_KEY) === 'true',
  );

  /** Desktop/PWA Web Notification permission status */
  readonly notificationPermission = signal<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied',
  );

  private pollTimer: any = null;
  private repeatTimer: any = null;
  private knownOrderIds = new Set<string>();
  private initialLoadDone = false;
  private audioCtx: AudioContext | null = null;
  private remainingRepeats = 0;

  constructor() {
    this.setupUserGestureUnlock();
  }

  /**
   * Automatically unlocks the Web Audio AudioContext on first user interaction with the app.
   */
  private setupUserGestureUnlock() {
    if (typeof window === 'undefined') return;

    const unlock = () => {
      this.ensureAudioContext();
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };

    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
  }

  private ensureAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) {
        this.audioCtx = new AudioCtxClass();
      }
    }
    return this.audioCtx;
  }

  /**
   * Starts periodic polling for new incoming orders across the admin workspace.
   */
  start() {
    if (this.pollTimer) return;
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  /**
   * Stops polling and cancels any pending alarms.
   */
  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.silenceAlarm();
  }

  /**
   * Requests desktop/PWA OS notification permissions.
   */
  async requestNotificationPermission() {
    if (typeof Notification === 'undefined') return;
    try {
      const res = await Notification.requestPermission();
      this.notificationPermission.set(res);
      if (res === 'granted') {
        this.toast.success('PWA order notifications enabled');
      }
    } catch {
      // Permission prompt failed or denied
    }
  }

  /**
   * Toggles mute state for the loud order bell.
   */
  toggleMute() {
    const next = !this.isMuted();
    this.isMuted.set(next);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MUTE_STORAGE_KEY, String(next));
    }
    if (next) {
      this.silenceAlarm();
      this.toast.info('Kitchen order bell muted');
    } else {
      this.toast.success('Kitchen order bell unmuted');
      this.testSound();
    }
  }

  /**
   * Test plays the loud order chime so kitchen staff can verify audio output and volume.
   */
  testSound() {
    this.ensureAudioContext();
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    this.synthesizeLoudKitchenChime();
    this.toast.info('🔔 Playing loud kitchen order chime test');
  }

  /**
   * Silences the active ringing alarm and closes the banner.
   */
  silenceAlarm() {
    if (this.repeatTimer) {
      clearTimeout(this.repeatTimer);
      this.repeatTimer = null;
    }
    this.remainingRepeats = 0;
    this.activeAlarmOrder.set(null);
  }

  /**
   * Polls the active orders API and triggers loud alerts if any new placed order is detected.
   */
  private poll() {
    this.admin.orders({ active: true, limit: 30 }).subscribe({
      next: (res) => {
        if (!this.initialLoadDone) {
          // Record current active order IDs on first fetch to prevent ringing for historical orders
          for (const o of res.orders) {
            this.knownOrderIds.add(o._id);
          }
          this.initialLoadDone = true;
          return;
        }

        // Detect new orders with status 'placed' that have not been seen yet
        const incoming = res.orders.filter(
          (o) => !this.knownOrderIds.has(o._id) && o.orderStatus === 'placed',
        );

        // Update known IDs
        for (const o of res.orders) {
          this.knownOrderIds.add(o._id);
        }

        if (incoming.length > 0) {
          const newest = incoming[0];
          this.triggerNewOrderAlert(newest);
        }
      },
      error: () => {
        // Suppress network poll errors to avoid toast spam in offline scenarios
      },
    });
  }

  /**
   * Triggers the full alert sequence: loud repeating chime, haptic vibration, and OS notification.
   */
  triggerNewOrderAlert(order: AdminOrder) {
    this.activeAlarmOrder.set(order);
    this.remainingRepeats = REPEAT_CHIME_COUNT;

    // 1. Play loud kitchen chime with repeats
    this.playChimeLoop();

    // 2. Trigger aggressive haptic vibration on mobile
    this.triggerHapticAlert();

    // 3. Trigger OS/PWA Web Notification
    this.sendOsNotification(order);
  }

  private playChimeLoop() {
    if (this.isMuted()) return;

    this.synthesizeLoudKitchenChime();
    this.remainingRepeats--;

    if (this.remainingRepeats > 0 && this.activeAlarmOrder()) {
      this.repeatTimer = setTimeout(() => {
        this.playChimeLoop();
      }, REPEAT_CHIME_DELAY_MS);
    }
  }

  /**
   * High-gain multi-harmonic acoustic restaurant service bell synthesized via Web Audio API.
   * Cuts through ambient kitchen noise with high volume and crisp harmonics.
   */
  private synthesizeLoudKitchenChime() {
    try {
      const ctx = this.ensureAudioContext();
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;

      // Master dynamics compressor to ensure punchy loud volume without clipping
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-14, now);
      compressor.knee.setValueAtTime(30, now);
      compressor.ratio.setValueAtTime(14, now);
      compressor.attack.setValueAtTime(0.003, now);
      compressor.release.setValueAtTime(0.2, now);
      compressor.connect(ctx.destination);

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.9, now);
      masterGain.connect(compressor);

      // Play a dual-tone brass bell strike: fundamental sine + octave harmonic triangle
      const playBellStrike = (fundamentalFreq: number, atOffset: number, duration: number, gainVol: number) => {
        const at = now + atOffset;

        // Fundamental tone (Sine wave)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(fundamentalFreq, at);
        gain1.gain.setValueAtTime(0.001, at);
        gain1.gain.exponentialRampToValueAtTime(gainVol, at + 0.015);
        gain1.gain.exponentialRampToValueAtTime(0.001, at + duration);
        osc1.connect(gain1).connect(masterGain);
        osc1.start(at);
        osc1.stop(at + duration + 0.05);

        // Harmonic overtone (Triangle wave, 1 octave higher for brassy ring)
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(fundamentalFreq * 2, at);
        gain2.gain.setValueAtTime(0.001, at);
        gain2.gain.exponentialRampToValueAtTime(gainVol * 0.45, at + 0.01);
        gain2.gain.exponentialRampToValueAtTime(0.001, at + (duration * 0.7));
        osc2.connect(gain2).connect(masterGain);
        osc2.start(at);
        osc2.stop(at + duration + 0.05);
      };

      // 4-strike escalating kitchen order chime sequence
      // Strike 1 (A5, 880Hz)
      playBellStrike(880, 0, 0.45, 0.85);
      // Strike 2 (D6, 1175Hz - bright fourth)
      playBellStrike(1175, 0.16, 0.55, 0.95);

      // Strike 3 (A5, 880Hz)
      playBellStrike(880, 0.65, 0.45, 0.85);
      // Strike 4 (E6, 1318Hz - high fifth, resonant ring)
      playBellStrike(1318, 0.82, 0.95, 1.0);
    } catch {
      // AudioContext unavailable or blocked by browser policy
    }
  }

  /**
   * Triggers loud patterned vibration on mobile devices.
   */
  private triggerHapticAlert() {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([300, 120, 300, 120, 500, 150, 500]);
      } catch {}
    }
  }

  /**
   * Fires a native OS notification if granted.
   */
  private sendOsNotification(order: AdminOrder) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

    try {
      const typeLabel = order.orderType ? order.orderType.toUpperCase() : 'ORDER';
      const itemsCount = order.items?.length || 1;
      const totalAmount = order.pricing?.total ? `₹${order.pricing.total}` : '';

      new Notification(`🚨 New Order #${order.orderNumber}`, {
        body: `${typeLabel} • ${totalAmount} • ${itemsCount} ${itemsCount === 1 ? 'item' : 'items'}`,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: `order-${order._id}`,
        requireInteraction: true,
      });
    } catch {}
  }
}
