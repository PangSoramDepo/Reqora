"use client";

import { createContext, useContext, useRef, type ComponentProps, type ReactNode } from "react";
import { useSuggestData, useSuggestMenu } from "@/components/flow/suggest-menu";

/** Where a token goes: inserts at that field's cursor; `alive` is false once the field left the page. */
export type TokenTarget = { insert: (token: string) => void; alive: () => boolean };
type TokenApi = { focus: (target: TokenTarget) => void; insert: (token: string) => void };

/** Token target for a plain <input> / <textarea>. */
function fieldTarget(el: HTMLInputElement | HTMLTextAreaElement, set: (value: string) => void): TokenTarget {
  return {
    alive: () => el.isConnected,
    insert: (token) => {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      set(el.value.slice(0, start) + token + el.value.slice(end));
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      });
    },
  };
}

const TokenContext = createContext<TokenApi | null>(null);

/** Tracks the last focused template field so "Suggested Tokens" chips can insert at its cursor. */
export function TokenProvider({ children }: { children: ReactNode }) {
  const last = useRef<TokenTarget | null>(null);
  const api: TokenApi = {
    focus: (target) => {
      last.current = target;
    },
    insert: (token) => {
      const target = last.current;
      if (target?.alive()) target.insert(token);
    },
  };
  return <TokenContext.Provider value={api}>{children}</TokenContext.Provider>;
}

export const useTokenInsert = () => useContext(TokenContext)?.insert;
/** For custom editors: call with a target when the editor gains focus. */
export const useTokenFocus = () => useContext(TokenContext)?.focus;

type InputProps = Omit<ComponentProps<"input">, "value" | "onChange"> & { value: string; onValue: (value: string) => void };

/** Text input that accepts token insertion, with `{{` suggestions (env, script variables, dynamic values). */
export function TemplateInput({ value, onValue, onFocus, onBlur, onKeyDown, ...rest }: InputProps) {
  const tokens = useContext(TokenContext);
  const ref = useRef<HTMLInputElement>(null);
  const menu = useSuggestMenu({ ref, value, onChange: onValue, data: useSuggestData(), disabled: rest.readOnly });
  return (
    <>
      <input
        {...rest}
        ref={ref}
        value={value}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          onValue(e.target.value);
          menu.onInput(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onKeyDown={(e) => {
          menu.onKeyDown(e);
          if (!e.defaultPrevented) onKeyDown?.(e);
        }}
        onKeyUp={menu.onKeyUp}
        onFocus={(e) => {
          tokens?.focus(fieldTarget(e.currentTarget, onValue));
          onFocus?.(e);
        }}
        onBlur={(e) => {
          menu.onBlur();
          onBlur?.(e);
        }}
      />
      {menu.popup}
    </>
  );
}

type TextareaProps = Omit<ComponentProps<"textarea">, "value" | "onChange"> & { value: string; onValue: (value: string) => void };

export function TemplateTextarea({ value, onValue, onFocus, onBlur, onKeyDown, ...rest }: TextareaProps) {
  const tokens = useContext(TokenContext);
  const ref = useRef<HTMLTextAreaElement>(null);
  const menu = useSuggestMenu({ ref, value, onChange: onValue, data: useSuggestData(), disabled: rest.readOnly });
  return (
    <>
      <textarea
        {...rest}
        ref={ref}
        value={value}
        spellCheck={false}
        onChange={(e) => {
          onValue(e.target.value);
          menu.onInput(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onKeyDown={(e) => {
          menu.onKeyDown(e);
          if (!e.defaultPrevented) onKeyDown?.(e);
        }}
        onKeyUp={menu.onKeyUp}
        onFocus={(e) => {
          tokens?.focus(fieldTarget(e.currentTarget, onValue));
          onFocus?.(e);
        }}
        onBlur={(e) => {
          menu.onBlur();
          onBlur?.(e);
        }}
      />
      {menu.popup}
    </>
  );
}
