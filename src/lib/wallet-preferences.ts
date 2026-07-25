import { useEffect, useState } from "react";

const KEY = "wallet.autoMarkReadOnDeepLink";
const EVENT = "wallet-prefs:change";
const DEFAULT = true;

function read(): boolean {
  if (typeof window === "undefined") return DEFAULT;
  const v = window.localStorage.getItem(KEY);
  if (v === null) return DEFAULT;
  return v === "1";
}

export function getAutoMarkReadOnDeepLink(): boolean {
  return read();
}

export function setAutoMarkReadOnDeepLink(value: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, value ? "1" : "0");
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function useAutoMarkReadOnDeepLink(): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => read());
  useEffect(() => {
    const sync = () => setValue(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return [value, (v: boolean) => setAutoMarkReadOnDeepLink(v)];
}
