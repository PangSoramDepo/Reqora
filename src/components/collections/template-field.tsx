"use client";

import { createContext, useContext, useRef, type ComponentProps, type ReactNode } from "react";

type Target = { el: HTMLInputElement | HTMLTextAreaElement; set: (value: string) => void };
type TokenApi = { focus: (target: Target) => void; insert: (token: string) => void };

const TokenContext = createContext<TokenApi | null>(null);

/** Tracks the last focused template field so "Suggested Tokens" chips can insert at its cursor. */
export function TokenProvider({ children }: { children: ReactNode }) {
  const last = useRef<Target | null>(null);
  const api: TokenApi = {
    focus: (target) => {
      last.current = target;
    },
    insert: (token) => {
      const target = last.current;
      if (!target || !target.el.isConnected) return;
      const { el } = target;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      target.set(el.value.slice(0, start) + token + el.value.slice(end));
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      });
    },
  };
  return <TokenContext.Provider value={api}>{children}</TokenContext.Provider>;
}

export const useTokenInsert = () => useContext(TokenContext)?.insert;

type InputProps = Omit<ComponentProps<"input">, "value" | "onChange"> & { value: string; onValue: (value: string) => void };

/** Text input that accepts token insertion. */
export function TemplateInput({ value, onValue, onFocus, ...rest }: InputProps) {
  const tokens = useContext(TokenContext);
  return (
    <input
      {...rest}
      value={value}
      spellCheck={false}
      onChange={(e) => onValue(e.target.value)}
      onFocus={(e) => {
        tokens?.focus({ el: e.currentTarget, set: onValue });
        onFocus?.(e);
      }}
    />
  );
}

type TextareaProps = Omit<ComponentProps<"textarea">, "value" | "onChange"> & { value: string; onValue: (value: string) => void };

export function TemplateTextarea({ value, onValue, onFocus, ...rest }: TextareaProps) {
  const tokens = useContext(TokenContext);
  return (
    <textarea
      {...rest}
      value={value}
      spellCheck={false}
      onChange={(e) => onValue(e.target.value)}
      onFocus={(e) => {
        tokens?.focus({ el: e.currentTarget, set: onValue });
        onFocus?.(e);
      }}
    />
  );
}
