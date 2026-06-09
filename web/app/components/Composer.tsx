"use client";

import { useEffect, useRef } from "react";
import { LoaderCircle, Mic, Plus, Send, Sparkles } from "lucide-react";
import { IconButton } from "./IconButton";

interface ComposerProps {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
}

export function Composer({
  value,
  disabled,
  onChange,
  onSubmit,
  onStop,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "48px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [value]);

  return (
    <div className='shrink-0 px-4 pb-5'>
      <form
        className='mx-auto max-w-230 border border-hairline bg-surface-dark p-3 rounded-lg'
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit();
        }}
      >
        <textarea
          ref={textareaRef}
          value={value}
          disabled={disabled}
          rows={1}
          placeholder='How can I help you today?'
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void onSubmit();
            }
          }}
          className='block max-h-45 rounded-xl min-h-12 w-full resize-none bg-transparent px-2 py-2 text-[16px] leading-6 text-canvas outline-none placeholder:text-ash disabled:opacity-60'
        />
        <div className='mt-2 flex items-center justify-between'>
          <div className='flex items-center gap-1 text-ash'>
            <IconButton title='Attach context'>
              <Plus size={19} />
            </IconButton>
            <IconButton title='Tool picker'>
              <Sparkles size={18} />
            </IconButton>
          </div>
          <div className='flex items-center gap-2'>
            <IconButton title='Voice input'>
              <Mic size={18} />
            </IconButton>
            {disabled ? (
              <button
                type='button'
                onClick={onStop}
                className='flex h-10 items-center gap-2 rounded-sm border border-hairline bg-canvas px-4 text-[14px] font-medium text-ink'
              >
                <LoaderCircle className='animate-spin' size={16} />
                Stop
              </button>
            ) : (
              <button
                type='submit'
                disabled={!value.trim()}
                className='flex h-10 w-10 items-center justify-center rounded-full bg-canvas text-ink disabled:bg-surface-card disabled:text-ash'
                aria-label='Send message'
                title='Send message'
              >
                <Send className='mt-0.5 mr-0.5' size={18} />
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
