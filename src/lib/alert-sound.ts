"use client";

import { useSyncExternalStore } from "react";

// Som de alerta do painel (pedido novo, chamado de mesa). Preferência por aparelho no
// localStorage, lida sem divergir da renderização no servidor. Bipe gerado no navegador.

const SOUND_KEY = "pedeae:order-sound";
const SOUND_EVENT = "pedeae:order-sound";

function readSound() {
  try {
    return localStorage.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
}

function subscribeSound(onChange: () => void) {
  window.addEventListener(SOUND_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(SOUND_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useSoundPreference() {
  return useSyncExternalStore(subscribeSound, readSound, () => false);
}

export function setSoundPreference(on: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {}
  window.dispatchEvent(new Event(SOUND_EVENT));
}

export function soundEnabled() {
  return readSound();
}

let ctx: AudioContext | null = null;

/** Bipe curto. `pattern` "order" = dois tons; "call" = três tons mais agudos (chamado de mesa). */
export function beep(pattern: "order" | "call" = "order") {
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
    const notes = pattern === "call" ? [[0, 1320], [0.15, 1320], [0.3, 1568]] : [[0, 880], [0.18, 1175]];
    for (const [start, freq] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + 0.15);
    }
  } catch {}
}
