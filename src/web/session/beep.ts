// Aviso sonoro del fin del descanso con Web Audio: sin ficheros de audio, así que no hay nada que cachear
// ni que la CSP tenga que permitir.

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (context) return context;
  if (typeof AudioContext === "undefined") return null;
  try {
    context = new AudioContext();
  } catch {
    context = null;
  }
  return context;
}

/**
 * Prepara el audio. iOS solo deja sonar a un contexto creado o reanudado durante un toque del usuario, y el
 * aviso sonará mucho después: hay que llamarla en el gesto que arranca el descanso (marcar ✓).
 */
export function unlockAudio(): void {
  try {
    void audioContext()?.resume().catch(() => undefined);
  } catch {
    // Sin audio la cuenta atrás sigue funcionando.
  }
}

const BEEPS = 3;
const BEEP_SECONDS = 0.18;
const GAP_SECONDS = 0.14;
const FREQUENCY_HZ = 880;

/** Tres pitidos cortos. Nunca lanza: un fallo de audio no puede romper la sesión. */
export function playBeep(): void {
  try {
    const audio = audioContext();
    if (!audio) return;
    void audio.resume().catch(() => undefined);
    const gain = audio.createGain();
    gain.connect(audio.destination);
    for (let index = 0; index < BEEPS; index++) {
      const start = audio.currentTime + index * (BEEP_SECONDS + GAP_SECONDS);
      const stop = start + BEEP_SECONDS;
      const oscillator = audio.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = FREQUENCY_HZ;
      oscillator.connect(gain);
      // Entrada y salida suaves: sin ellas cada pitido acaba con un chasquido.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.4, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, stop);
      oscillator.start(start);
      oscillator.stop(stop);
    }
  } catch {
    // Ídem.
  }
}
