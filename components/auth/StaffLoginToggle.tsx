"use client";

import { useState } from "react";
import { StaffLoginView } from "@/components/auth/StaffLoginView";

export function StaffLoginToggle() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-body text-xs text-ink/40 underline underline-offset-2 transition hover:text-ink/60"
        >
          Я сотрудник — войти по email
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <StaffLoginView />
    </div>
  );
}
