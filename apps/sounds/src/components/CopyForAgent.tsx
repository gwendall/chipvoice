"use client";
import { useState } from "react";

/** Copies the CLI command an agent runs to add this event to its game
 * (spec keyboard shortcut `c`, spec's "copy for my agent" row action). */
export function CopyForAgent({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="button"
      data-testid="copy-for-agent"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(command);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard access can be denied (permissions, non-secure context);
          // the command is still visible in the page, so this is not fatal.
        }
      }}
    >
      {copied ? "Copied" : "Copy for agent"}
    </button>
  );
}
