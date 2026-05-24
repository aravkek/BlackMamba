"use client";

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import { SendHorizontal, Mic, MicOff, Loader2 } from "lucide-react";
import { Button } from "@/components/shadcn/button";
import { ModelSelector } from "./ModelSelector";

const MAX_ROWS = 6;

type ChatComposerProps = {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  model: string;
  onModelChange: (id: string) => void;
};

type MicState = "idle" | "recording" | "transcribing";

export function ChatComposer({
  onSend,
  disabled = false,
  placeholder,
  model,
  onModelChange,
}: ChatComposerProps) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [micState, setMicState] = useState<MicState>("idle");
  const [micError, setMicError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseInt(getComputedStyle(el).lineHeight, 10) || 24;
    const maxHeight = lineHeight * MAX_ROWS;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, []);

  const appendTranscript = useCallback(
    (transcript: string) => {
      if (!transcript) return;
      setValue((prev) => {
        const sep = prev.length === 0 || prev.endsWith(" ") ? "" : " ";
        return prev + sep + transcript;
      });
      // Resize after state flush.
      requestAnimationFrame(resizeTextarea);
      textareaRef.current?.focus();
    },
    [resizeTextarea],
  );

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }, []);

  const startRecording = useCallback(async () => {
    setMicError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError("Microphone not supported in this browser.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const msg =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Microphone permission denied."
          : "Could not access microphone.";
      setMicError(msg);
      return;
    }

    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      // Stop the underlying tracks so the browser mic indicator goes away.
      stream.getTracks().forEach((t) => t.stop());

      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      chunksRef.current = [];
      recorderRef.current = null;

      if (blob.size === 0) {
        setMicState("idle");
        return;
      }

      setMicState("transcribing");
      try {
        const form = new FormData();
        form.append("audio", blob, "speech.webm");
        const res = await fetch("/api/transcribe", {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          setMicError(`Transcription failed (${res.status}).`);
          setMicState("idle");
          return;
        }
        const data = (await res.json()) as { transcript?: string };
        appendTranscript((data.transcript ?? "").trim());
      } catch (err) {
        setMicError(
          err instanceof Error ? err.message : "Transcription failed.",
        );
      } finally {
        setMicState("idle");
      }
    };

    recorder.start();
    setMicState("recording");
  }, [appendTranscript]);

  const toggleMic = useCallback(() => {
    if (micState === "recording") {
      stopRecording();
    } else if (micState === "idle") {
      void startRecording();
    }
  }, [micState, startRecording, stopRecording]);

  // Clean up an active recording if the component unmounts.
  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
    };
  }, []);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      setValue(e.target.value);
      resizeTextarea();
    },
    [resizeTextarea],
  );

  const submit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  const hasContent = value.trim().length > 0;
  const sendDisabled = disabled || !hasContent || micState !== "idle";

  return (
    <div className="px-8 md:px-12 pb-8 pt-6">
      <div
        className={[
          "glass rounded-2xl max-w-3xl mx-auto transition-shadow duration-200",
          focused
            ? "shadow-[0_0_0_1px_rgba(243,139,0,0.10),0_8px_32px_-8px_rgba(0,0,0,0.6)]"
            : "shadow-[0_4px_24px_-8px_rgba(0,0,0,0.5)]",
        ].join(" ")}
      >
        <div className="px-4 pt-4 pb-3">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            disabled={disabled}
            placeholder={
              micState === "recording"
                ? "Listening…"
                : micState === "transcribing"
                  ? "Transcribing…"
                  : (placeholder ?? "Message Aria…")
            }
            rows={1}
            aria-label="Message input"
            className="
              w-full resize-none bg-transparent
              text-[15px] text-[color:var(--fg)] placeholder:text-[color:var(--fg-dim)]
              leading-relaxed outline-none border-none
              disabled:opacity-40
              overflow-y-auto no-scrollbar
            "
          />
          {micError && (
            <p className="mono text-[11px] text-[#ef4444] mt-2" role="alert">
              {micError}
            </p>
          )}
        </div>

        {/* Bottom action row */}
        <div className="flex items-center justify-between px-4 pb-3">
          <ModelSelector value={model} onChange={onModelChange} />
          <div className="flex items-center gap-2">
            {hasContent && micState === "idle" && (
              <span
                className="mono text-[11px] text-[color:var(--fg-dim)] select-none"
                aria-hidden="true"
              >
                &#8629;
              </span>
            )}
            <button
              type="button"
              onClick={toggleMic}
              disabled={disabled || micState === "transcribing"}
              aria-label={
                micState === "recording"
                  ? "Stop recording"
                  : micState === "transcribing"
                    ? "Transcribing"
                    : "Record voice message"
              }
              className={[
                "inline-flex items-center justify-center size-8 rounded-md border transition-colors shrink-0",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--tangerine)]/50",
                "disabled:opacity-40 disabled:cursor-not-allowed",
                micState === "recording"
                  ? "border-[#ef4444] text-[#ef4444] animate-pulse"
                  : "border-[color:var(--border)] text-[color:var(--fg-muted)] hover:text-[color:var(--fg)] hover:border-[color:var(--border-strong)]",
              ].join(" ")}
            >
              {micState === "transcribing" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : micState === "recording" ? (
                <MicOff className="size-4" />
              ) : (
                <Mic className="size-4" />
              )}
            </button>
            <Button
              onClick={submit}
              disabled={sendDisabled}
              aria-label={disabled ? "Sending message" : "Send message"}
              size="sm"
              className="bg-[#F38B00] hover:bg-[#ff9a14] text-black border-0 shrink-0"
            >
              <SendHorizontal className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
