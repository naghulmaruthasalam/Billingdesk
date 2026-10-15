/** Short audio feedback for scanning, generated with WebAudio (no files, works offline). */
const KEY = 'skb.scanSound';
let ctx: AudioContext | null = null;

export function scanSoundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setScanSound(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}

export function beep(kind: 'ok' | 'error'): void {
  if (!scanSoundEnabled()) return;
  try {
    ctx ??= new AudioContext();
    const tones = kind === 'ok' ? [[1200, 0.07]] : [[320, 0.14], [240, 0.18]];
    let t = ctx.currentTime;
    for (const [freq, dur] of tones) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      o.type = 'square';
      g.gain.setValueAtTime(0.04, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + dur);
      t += dur + 0.03;
    }
  } catch {
    /* audio is optional */
  }
}
